/**
 * TodoOrchestrator — 会话级 todo 全自动调度（agent 层权威实现）
 *
 * 职责：
 *   - plan create / 禁热 replace / list / archive-delete
 *   - 依赖锁（仅 completed 解锁；failed 不解锁）
 *   - Lane 分配：R3 root 占 1 + 其余 fork；R4-C 动态 exclusive 链合并
 *   - 事件流 + system_notice 队列
 *   - 可选真 fork（setForkRunner）
 *
 * 设计文档：core/agent/docs/TODO_ORCHESTRATOR.md
 *
 * 所有权：agent 包。tools 侧通过 bindTodoOrchestratorHost 挂接同一单例，
 * 避免 tools → agent 包循环依赖。
 */

import { TASK_MANAGER, TaskScheduler } from "@little-house-studio/tools";
import type { Task } from "@little-house-studio/tools";
import type {
  TodoEvent,
  TodoEventType,
  TodoFinishInput,
  TodoLane,
  TodoNotice,
  TodoPlanMeta,
} from "@little-house-studio/tools";

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const TERMINAL: ReadonlySet<string> = new Set(["completed", "failed", "cancelled"]);

/** 真 fork 回调：runtime 注入 SubagentExecutor */
export type TodoForkRunner = (args: {
  rootSessionId: string;
  planId: string;
  lane: TodoLane;
  node: Task;
  /** 已排队、目标为该 fork session 的 notice */
  notices: TodoNotice[];
}) => void | Promise<void>;

export class TodoOrchestrator {
  private plans = new Map<string, TodoPlanMeta>();
  private lanes = new Map<string, TodoLane[]>(); // rootSessionId → lanes
  private events = new Map<string, TodoEvent[]>();
  private pendingNotices = new Map<string, TodoNotice[]>();
  private eventListeners: Array<(ev: TodoEvent) => void> = [];
  /** fork/sub sessionId → rootSessionId */
  private sessionParent = new Map<string, string>();
  private forkRunner?: TodoForkRunner;
  /** 是否启用真 fork（有 runner 时默认 true） */
  private realForkEnabled = true;

  /** 注入真 fork 执行器（P1+） */
  setForkRunner(runner: TodoForkRunner | undefined): void {
    this.forkRunner = runner;
  }

  setRealForkEnabled(enabled: boolean): void {
    this.realForkEnabled = enabled;
  }

  /** 订阅事件（调试 SSE / 测试） */
  onEvent(fn: (ev: TodoEvent) => void): () => void {
    this.eventListeners.push(fn);
    return () => {
      this.eventListeners = this.eventListeners.filter((f) => f !== fn);
    };
  }

  /** 将任意 session（含 fork）解析为 root plan session */
  resolveRootSession(sessionId: string): string {
    return this.sessionParent.get(sessionId) ?? sessionId;
  }

  bindForkSession(forkSessionId: string, rootSessionId: string): void {
    this.sessionParent.set(forkSessionId, rootSessionId);
  }

  getPlan(rootSessionId: string): TodoPlanMeta | undefined {
    return this.plans.get(this.resolveRootSession(rootSessionId));
  }

  getLanes(rootSessionId: string): TodoLane[] {
    return [...(this.lanes.get(this.resolveRootSession(rootSessionId)) ?? [])];
  }

  getEvents(rootSessionId: string): TodoEvent[] {
    return [...(this.events.get(this.resolveRootSession(rootSessionId)) ?? [])];
  }

  /** 取出并清空待投递 notice（runtime 追加 user 消息用） */
  drainNotices(sessionId: string): TodoNotice[] {
    const root = this.resolveRootSession(sessionId);
    const list = this.pendingNotices.get(root) ?? [];
    this.pendingNotices.set(root, []);
    return list;
  }

  /** 将未投递的 notice 放回队列（flush 时 target 不匹配当前 session） */
  requeueNotices(sessionId: string, notices: TodoNotice[]): void {
    if (notices.length === 0) return;
    const root = this.resolveRootSession(sessionId);
    const list = this.pendingNotices.get(root) ?? [];
    list.push(...notices);
    this.pendingNotices.set(root, list);
  }

  getTasks(sessionId: string): Task[] {
    return TASK_MANAGER.getTasks(this.resolveRootSession(sessionId));
  }

  /** 调试：列出所有 active plan 的 root session */
  listActiveRootSessions(): string[] {
    return [...this.plans.entries()]
      .filter(([, p]) => p.status === "active")
      .map(([sid]) => sid);
  }

  /** 完整调试快照 */
  debugSnapshot(sessionId: string): {
    rootSessionId: string;
    plan?: TodoPlanMeta;
    tasks: Task[];
    lanes: TodoLane[];
    events: TodoEvent[];
  } {
    const rootSessionId = this.resolveRootSession(sessionId);
    return {
      rootSessionId,
      plan: this.plans.get(rootSessionId),
      tasks: this.getTasks(rootSessionId),
      lanes: this.getLanes(rootSessionId),
      events: this.getEvents(rootSessionId),
    };
  }

  // ── manage ─────────────────────────────────────────────────────────────

  /**
   * todo_manage 入口
   * @returns 人类可读渲染 + 调度摘要
   */
  manage(
    sessionId: string,
    action: string,
    tasksRaw: Record<string, unknown>[] | null,
  ): string {
    const rootSessionId = this.resolveRootSession(sessionId);
    const act = action.trim().toLowerCase();

    if (act === "list") {
      return this.renderWithLanes(rootSessionId);
    }

    if (act === "delete") {
      return this.archiveAndClear(rootSessionId, "delete");
    }

    if (act !== "create" && act !== "replace") {
      throw new Error(`未知 action '${action}'，支持: create | replace | delete | list`);
    }

    if (act === "replace") {
      const existing = TASK_MANAGER.getTasks(rootSessionId);
      const openNodes = existing.some(
        (t) => t.status === "pending" || t.status === "in_progress",
      );
      if (this.hasActiveExecution(rootSessionId) || openNodes) {
        this.emit(rootSessionId, "manage_rejected", {
          payload: { action: "replace", reason: "active_or_open_nodes" },
        });
        throw new Error(
          "禁止 replace：仍有 pending/in_progress 节点或活跃 fork。请全部终态后 replace，或 delete 归档后 create 新计划。",
        );
      }
    }

    if (act === "create") {
      const existing = TASK_MANAGER.getTasks(rootSessionId);
      if (existing.length > 0) {
        const stillOpen = existing.some(
          (t) => t.status === "pending" || t.status === "in_progress",
        );
        if (stillOpen || this.hasActiveExecution(rootSessionId)) {
          throw new Error(
            "当前会话已有未完成的 todo 清单。执行中禁止覆盖；全部终态后可 create（自动归档旧表）或先 delete。",
          );
        }
        // 旧 plan 已全部终态：自动归档再创建
        this.archiveAndClear(rootSessionId, "auto_archive_before_create");
      }
    }

    const renderedBase = this.loadPlanNodes(rootSessionId, tasksRaw);
    const planId = newId("plan");
    this.plans.set(rootSessionId, {
      planId,
      rootSessionId,
      status: "active",
      createdAt: nowIso(),
    });
    this.lanes.set(rootSessionId, [
      {
        laneId: `root:${rootSessionId}`,
        kind: "root",
        sessionId: rootSessionId,
        rootSessionId,
        planId,
        assignedNodeIds: [],
        status: "idle",
        nudgeCount: 0,
      },
    ]);
    this.emit(rootSessionId, "plan_submitted", { planId, payload: { nodeCount: this.getTasks(rootSessionId).length } });

    const scheduleSummary = this.scheduleReady(rootSessionId);
    this.enqueueNotice(rootSessionId, {
      kind: "todo_plan_submitted",
      planId,
      targetSessionId: rootSessionId,
      body: [
        "Todo 计划已提交，后端已开始自动调度。",
        "请只推进分配给你的 in_progress 节点；每完成一个节点调用一次 todo_finish（status=completed|failed）。",
        "不要手搓并行 fork 工具——分身由系统创建。",
        scheduleSummary,
      ].join("\n"),
    });

    return `${renderedBase}\n\n---\n[调度]\n${scheduleSummary}`;
  }

  // ── finish ─────────────────────────────────────────────────────────────

  finish(sessionId: string, input: TodoFinishInput): string {
    const rootSessionId = this.resolveRootSession(sessionId);
    const tasks = TASK_MANAGER.getTasks(rootSessionId);
    if (tasks.length === 0) {
      return "当前没有 todo。请先用 todo_manage action=create 建立清单。";
    }

    const taskId = input.taskId.trim();
    const status = input.status;
    if (status !== "completed" && status !== "failed") {
      throw new Error("status 必须是 completed 或 failed");
    }

    const node = tasks.find((t) => t.id === taskId);
    if (!node) {
      return `未找到 todo ${taskId}。\n\n${this.renderWithLanes(rootSessionId)}`;
    }
    if (node.status === "completed" || node.status === "failed") {
      return `Todo ${taskId} 已是终态（${node.status}）。\n\n${this.renderWithLanes(rootSessionId)}`;
    }
    if (node.status === "cancelled") {
      return `Todo ${taskId} 已取消，无法 finish。\n\n${this.renderWithLanes(rootSessionId)}`;
    }
    // 设计：一次 finish 只代表「当前负责的节点」——必须已是 in_progress（已分配）
    if (node.status !== "in_progress") {
      return (
        `Todo ${taskId} 尚未分配执行（status=${node.status}），不能 finish。` +
        `请只推进 in_progress 节点；可用 todo_manage action=list 查看。\n\n` +
        this.renderWithLanes(rootSessionId)
      );
    }

    const actor = input.actorSessionId ?? sessionId;
    const lanes = this.lanes.get(rootSessionId) ?? [];
    const boundLane = lanes.find((l) => l.currentNodeId === taskId && l.status !== "recycled");
    // root 可完成任意 in_progress；fork session 只能完成自己 lane 的节点
    if (boundLane && actor !== rootSessionId && actor !== boundLane.sessionId) {
      throw new Error(
        `节点 ${taskId} 绑定 lane ${boundLane.laneId}，当前 session 无权 finish。`,
      );
    }

    const summary = (input.summary ?? "").slice(0, 500);
    const reason = input.reason ?? (status === "failed" ? summary : undefined);
    node.summary = summary;
    if (status === "failed") {
      node.failReason = reason;
      node.status = "failed";
    } else {
      node.status = "completed";
    }
    if (input.report) {
      node.report = input.report;
      this.emit(rootSessionId, "report_stored", {
        nodeId: taskId,
        laneId: boundLane?.laneId,
        payload: { reportLen: input.report.length },
      });
    }

    // 同步进 TaskManager 存储
    this.persistTasks(rootSessionId, tasks);

    this.emit(rootSessionId, "node_finished", {
      nodeId: taskId,
      laneId: boundLane?.laneId,
      payload: { status, summary, hasReport: Boolean(input.report) },
    });

    if (boundLane) {
      boundLane.currentNodeId = undefined;
      // 尝试 exclusive 链延伸
      const extended = this.tryExtendChain(rootSessionId, boundLane, taskId);
      if (!extended) {
        this.endLaneIfIdle(rootSessionId, boundLane, input.report);
      }
    }

    const scheduleSummary = this.scheduleReady(rootSessionId);
    this.maybeCompletePlan(rootSessionId);

    const hint =
      status === "failed"
        ? `\n\n❌ 节点 ${taskId} 已标记 failed（不解锁下游）。其它节点不受自动级联影响。`
        : "";
    return `${this.renderWithLanes(rootSessionId)}${hint}\n\n---\n[调度]\n${scheduleSummary}`;
  }

  /**
   * 催促判定：线路未做到头 ∧ 非合法等依赖 ∧ 本轮无工具
   */
  evaluateNudge(
    sessionId: string,
    actorSessionId: string,
    hadToolCalls: boolean,
  ): TodoNotice | null {
    if (hadToolCalls) return null;
    const rootSessionId = this.resolveRootSession(sessionId);
    const plan = this.plans.get(rootSessionId);
    if (!plan || plan.status !== "active") return null;

    const lanes = this.lanes.get(rootSessionId) ?? [];
    const lane =
      lanes.find((l) => l.sessionId === actorSessionId && l.status !== "recycled") ??
      lanes.find((l) => l.kind === "root" && actorSessionId === rootSessionId);
    if (!lane || lane.status === "recycled") return null;

    const tasks = this.getTasks(rootSessionId);
    if (this.isWaitingDeps(lane, tasks)) {
      lane.status = "waiting_deps";
      return null;
    }

    const hasWork =
      Boolean(lane.currentNodeId) ||
      tasks.some(
        (t) =>
          t.laneId === lane.laneId &&
          (t.status === "in_progress" || t.status === "pending"),
      );
    // 仍有 in_progress 绑在此 lane，或 lane working 未结束
    const responsibleInProgress = tasks.some(
      (t) => t.laneId === lane.laneId && t.status === "in_progress",
    );
    if (!responsibleInProgress && lane.status !== "working") {
      if (!hasWork) return null;
    }
    if (!responsibleInProgress && !lane.currentNodeId) return null;

    lane.nudgeCount += 1;
    if (lane.nudgeCount > 5) {
      lane.status = "stuck";
      this.emit(rootSessionId, "stuck", {
        laneId: lane.laneId,
        payload: { nudgeCount: lane.nudgeCount },
      });
      return null;
    }

    const nodeId = lane.currentNodeId;
    const notice: TodoNotice = {
      kind: "todo_nudge",
      planId: plan.planId,
      laneId: lane.laneId,
      nodeId,
      targetSessionId: actorSessionId,
      body: [
        `你负责的 todo 线路尚未结束${nodeId ? `（当前节点 ${nodeId}）` : ""}。`,
        "请继续执行工具推进，或调用 todo_finish 汇报该节点（status=completed|failed）。",
        "一次 todo_finish 只代表当前这一个节点。",
      ].join("\n"),
    };
    this.emit(rootSessionId, "nudge", {
      laneId: lane.laneId,
      nodeId,
      payload: { nudgeCount: lane.nudgeCount },
    });
    this.enqueueNotice(rootSessionId, notice);
    return notice;
  }

  // ── 调度核心 ───────────────────────────────────────────────────────────

  /**
   * R4-C：exclusive successor = deps 恰好为 [u] 的唯一 pending 节点，且 ready。
   */
  private tryExtendChain(rootSessionId: string, lane: TodoLane, finishedId: string): boolean {
    if (lane.status === "recycled") return false;
    const tasks = this.getTasks(rootSessionId);
    const ready = TaskScheduler.selectLayer(tasks);
    const exclusive = ready.filter(
      (t) => t.deps.length === 1 && t.deps[0] === finishedId,
    );
    if (exclusive.length !== 1) return false;
    // 若还有其它 ready 与 finishedId 无关的并行，仍可 extend 这一条 exclusive
    const next = exclusive[0];
    this.assignNode(rootSessionId, next, lane);
    this.emit(rootSessionId, "lane_chain_extended", {
      laneId: lane.laneId,
      nodeId: next.id,
      payload: { from: finishedId },
    });
    return true;
  }

  private scheduleReady(rootSessionId: string): string {
    const lines: string[] = [];
    const tasks = this.getTasks(rootSessionId);
    let ready = TaskScheduler.selectLayer(tasks);
    if (ready.length === 0) {
      lines.push("无新的 ready 节点。");
      return lines.join("\n");
    }

    // 先尝试：任意刚空闲且 working 结束的 lane 不在此处理（extend 已在 finish 做）
    // 剩余 ready：R3 root 占 1，其余 fork
    ready = ready.sort((a, b) => a.id.localeCompare(b.id));
    const lanes = this.ensureLanes(rootSessionId);
    const root = lanes.find((l) => l.kind === "root")!;
    const rootBusy = Boolean(root.currentNodeId);

    const toAssign = [...ready];
    if (!rootBusy && toAssign.length > 0) {
      const first = toAssign.shift()!;
      this.assignNode(rootSessionId, first, root);
      lines.push(`root ← ${first.id} (${first.desc})`);
    }

    for (const node of toAssign) {
      // root 忙或剩余并行项 → fork
      if (!root.currentNodeId && node === toAssign[0] && !rootBusy) {
        // already handled
      }
      const fork = this.createForkLane(rootSessionId, root);
      this.assignNode(rootSessionId, node, fork);
      lines.push(`fork ${fork.laneId} ← ${node.id} (${node.desc})`);
    }

    if (lines.length === 0) lines.push("ready 节点均已分配或等待。");
    return lines.join("\n");
  }

  private assignNode(rootSessionId: string, node: Task, lane: TodoLane): void {
    const tasks = this.getTasks(rootSessionId);
    const n = tasks.find((t) => t.id === node.id);
    if (!n || n.status !== "pending") return;

    // 上游 report 注入（仅启动时）
    const reports: string[] = [];
    for (const depId of n.deps) {
      const dep = tasks.find((t) => t.id === depId);
      if (dep?.report) {
        reports.push(`[${depId}] ${dep.report}`);
        this.emit(rootSessionId, "report_injected", {
          nodeId: n.id,
          laneId: lane.laneId,
          payload: { from: depId },
        });
      } else if (dep?.summary) {
        reports.push(`[${depId}] ${dep.summary}`);
      }
    }

    n.status = "in_progress";
    n.laneId = lane.laneId;
    lane.currentNodeId = n.id;
    if (!lane.assignedNodeIds.includes(n.id)) lane.assignedNodeIds.push(n.id);
    lane.status = "working";
    lane.nudgeCount = 0;
    this.persistTasks(rootSessionId, tasks);

    this.emit(rootSessionId, "node_assigned", {
      nodeId: n.id,
      laneId: lane.laneId,
      payload: { kind: lane.kind },
    });

    const plan = this.plans.get(rootSessionId)!;
    this.enqueueNotice(rootSessionId, {
      kind: "todo_unlock",
      planId: plan.planId,
      laneId: lane.laneId,
      nodeId: n.id,
      targetSessionId: lane.sessionId,
      body: [
        `节点 ${n.id} 已分配给你：${n.desc}`,
        `deps=[${n.deps.join(",") || "—"}]`,
        reports.length ? `上游交接：\n${reports.join("\n")}` : "无上游 report。",
        "完成后调用 todo_finish(task_id, status, summary, report?)。一次只代表本节点。",
      ].join("\n"),
    });

    if (reports.length) {
      this.enqueueNotice(rootSessionId, {
        kind: "todo_inject_report",
        planId: plan.planId,
        laneId: lane.laneId,
        nodeId: n.id,
        targetSessionId: lane.sessionId,
        body: reports.join("\n\n"),
      });
    }

    // 真 fork：派发子 Agent（fire-and-forget）
    if (
      lane.kind === "fork" &&
      this.forkRunner &&
      this.realForkEnabled &&
      lane.sessionId !== rootSessionId
    ) {
      const noticesForFork = (this.pendingNotices.get(rootSessionId) ?? []).filter(
        (x) => x.targetSessionId === lane.sessionId,
      );
      try {
        void Promise.resolve(
          this.forkRunner({
            rootSessionId,
            planId: plan.planId,
            lane: { ...lane },
            node: { ...n },
            notices: noticesForFork,
          }),
        ).catch(() => {
          /* runner 内应自行打日志 */
        });
      } catch {
        /* ignore sync throw */
      }
    }
  }

  private createForkLane(rootSessionId: string, parent: TodoLane): TodoLane {
    const plan = this.plans.get(rootSessionId)!;
    const laneId = newId("fork");
    const useReal = Boolean(this.forkRunner) && this.realForkEnabled;
    const forkSessionId = useReal ? `todo-fork-${laneId}` : rootSessionId;
    const fork: TodoLane = {
      laneId,
      kind: "fork",
      parentLaneId: parent.laneId,
      sessionId: forkSessionId,
      rootSessionId,
      planId: plan.planId,
      assignedNodeIds: [],
      status: "idle",
      nudgeCount: 0,
    };
    if (useReal) {
      this.bindForkSession(forkSessionId, rootSessionId);
    }
    const lanes = this.ensureLanes(rootSessionId);
    lanes.push(fork);
    this.emit(rootSessionId, "fork_created", {
      laneId: fork.laneId,
      payload: {
        parentLaneId: parent.laneId,
        realFork: useReal,
        forkSessionId,
      },
    });

    // 父路 notice
    this.enqueueNotice(rootSessionId, {
      kind: "todo_fork",
      planId: plan.planId,
      laneId: fork.laneId,
      targetSessionId: rootSessionId,
      body: [
        `系统创建分身 lane=${fork.laneId}（父=${parent.laneId}）。`,
        useReal
          ? `分身 session=${forkSessionId}，将并行执行被分配节点；完成后汇合主路。`
          : `当前为逻辑分身（与主路同 session）；由主路依次推进各 in_progress 节点。`,
        "你（主路）继续只做分配给你的节点；不要抢 fork 的节点。",
      ].join("\n"),
    });
    // 子路 notice（真 fork 时 target 为子 session）
    this.enqueueNotice(rootSessionId, {
      kind: "todo_fork",
      planId: plan.planId,
      laneId: fork.laneId,
      targetSessionId: forkSessionId,
      body: [
        `你是主 Agent 的分身 lane=${fork.laneId}。`,
        `父 lane=${parent.laneId}，root session=${rootSessionId}。`,
        "只做系统随后分配给你的节点；每完成一个调用 todo_finish。",
        "链结束时在最后一次 finish 带上 report，然后停止。",
      ].join("\n"),
    });
    return fork;
  }

  private endLaneIfIdle(rootSessionId: string, lane: TodoLane, report?: string): void {
    if (lane.kind === "root") {
      lane.status = lane.currentNodeId ? "working" : "idle";
      return;
    }
    if (lane.currentNodeId) return;

    const plan = this.plans.get(rootSessionId);
    if (plan && !report) {
      this.enqueueNotice(rootSessionId, {
        kind: "todo_lane_end",
        planId: plan.planId,
        laneId: lane.laneId,
        targetSessionId: lane.sessionId,
        body: `分身 ${lane.laneId} 负责的链已无下一节点。若尚未提交完整 report，请在最后一次 todo_finish 中带上 report 字段。系统将回收该分身。`,
      });
    }

    lane.status = "recycled";
    this.emit(rootSessionId, "fork_recycled", { laneId: lane.laneId });
  }

  private isWaitingDeps(lane: TodoLane, tasks: Task[]): boolean {
    if (lane.currentNodeId) return false;
    // 若存在仅依赖本 lane 已完成节点、但其它 deps 未满足的 pending，视为等待
    const completed = new Set(tasks.filter((t) => t.status === "completed").map((t) => t.id));
    const mine = new Set(lane.assignedNodeIds);
    return tasks.some((t) => {
      if (t.status !== "pending") return false;
      if (t.deps.every((d) => completed.has(d))) return false; // ready 不是 wait
      // 部分 deps 完成且与 mine 有交集
      return t.deps.some((d) => mine.has(d) || completed.has(d)) && t.deps.some((d) => !completed.has(d));
    });
  }

  private hasActiveExecution(rootSessionId: string): boolean {
    const tasks = this.getTasks(rootSessionId);
    if (tasks.some((t) => t.status === "in_progress")) return true;
    const lanes = this.lanes.get(rootSessionId) ?? [];
    return lanes.some((l) => l.kind === "fork" && l.status !== "recycled" && l.status !== "idle");
  }

  private maybeCompletePlan(rootSessionId: string): void {
    const tasks = this.getTasks(rootSessionId);
    if (tasks.length === 0) return;
    const allTerminal = tasks.every((t) => TERMINAL.has(t.status));
    if (!allTerminal) return;
    const plan = this.plans.get(rootSessionId);
    if (plan && plan.status === "active") {
      plan.status = "completed";
      this.emit(rootSessionId, "plan_completed", { planId: plan.planId });
    }
  }

  private archiveAndClear(rootSessionId: string, reason: string): string {
    const plan = this.plans.get(rootSessionId);
    if (plan) {
      plan.status = "archived";
      plan.archivedAt = nowIso();
    }
    const tasks = this.getTasks(rootSessionId);
    for (const t of tasks) {
      if (!TERMINAL.has(t.status)) t.status = "cancelled";
    }
    if (tasks.length) this.persistTasks(rootSessionId, tasks);

    const lanes = this.lanes.get(rootSessionId) ?? [];
    for (const l of lanes) {
      if (l.kind === "fork") l.status = "recycled";
      else {
        l.status = "idle";
        l.currentNodeId = undefined;
      }
    }

    TASK_MANAGER.manage(rootSessionId, "delete", null);
    this.lanes.set(rootSessionId, []);
    this.emit(rootSessionId, "plan_archived", { payload: { reason } });
    if (plan) {
      this.enqueueNotice(rootSessionId, {
        kind: "todo_plan_archived",
        planId: plan.planId,
        targetSessionId: rootSessionId,
        body: `Todo plan ${plan.planId} 已归档（${reason}）。`,
      });
    }
    return "Todo 清单已归档并清空。";
  }

  /**
   * 校验并写入节点；全部先标 pending，由 scheduleReady assign。
   */
  private loadPlanNodes(
    rootSessionId: string,
    tasksRaw: Record<string, unknown>[] | null,
  ): string {
    if (!tasksRaw || tasksRaw.length === 0) {
      throw new Error("请在 tasks 中提供至少一项。");
    }
    if (tasksRaw.length > 50) throw new Error("最多允许 50 个 todo");

    // 允许任意顺序 deps 引用：两遍校验
    const ids = new Set<string>();
    const validated: Task[] = [];

    for (const item of tasksRaw) {
      const taskId = String(item.id ?? "").trim();
      const desc = String(item.desc ?? "").trim();
      if (!taskId) throw new Error("每个 todo 必须有 id");
      if (!desc) throw new Error(`todo ${taskId}: desc 不能为空`);
      if (ids.has(taskId)) throw new Error(`todo ${taskId}: 重复的 id`);
      ids.add(taskId);
      validated.push({
        id: taskId,
        desc,
        deps: [],
        status: "pending",
        summary: "",
      });
    }

    for (let i = 0; i < tasksRaw.length; i++) {
      const item = tasksRaw[i];
      const depsRaw = item.deps ?? [];
      const deps = (Array.isArray(depsRaw) ? depsRaw : [])
        .map((d: unknown) => String(d).trim())
        .filter(Boolean);
      for (const dep of deps) {
        if (!ids.has(dep)) throw new Error(`todo ${validated[i].id}: 依赖 ${dep} 不存在`);
        if (dep === validated[i].id) throw new Error(`todo ${validated[i].id}: 不能依赖自己`);
      }
      validated[i].deps = deps;
    }

    // 环检测
    if (this.hasCycle(validated)) {
      throw new Error("todo 依赖图存在环，请检查 deps");
    }

    // 写入：replace/create 都覆盖
    // 使用 TASK_MANAGER 内部：先 delete 再 manage create 路径会 auto in_progress——我们直接 set via restore + 手动
    TASK_MANAGER.manage(rootSessionId, "delete", null);
    // manage create 会 selectLayer；我们需要全部 pending。改用 restore + persist
    // 直接调用私有状态：通过 manage with a hack — 更好扩展 TaskManager.setTasks

    TASK_MANAGER.replaceTasks(rootSessionId, validated);

    return TASK_MANAGER.render(rootSessionId);
  }

  private hasCycle(tasks: Task[]): boolean {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const visiting = new Set<string>();
    const done = new Set<string>();
    const dfs = (id: string): boolean => {
      if (done.has(id)) return false;
      if (visiting.has(id)) return true;
      visiting.add(id);
      for (const d of byId.get(id)?.deps ?? []) {
        if (dfs(d)) return true;
      }
      visiting.delete(id);
      done.add(id);
      return false;
    };
    return tasks.some((t) => dfs(t.id));
  }

  private ensureLanes(rootSessionId: string): TodoLane[] {
    let lanes = this.lanes.get(rootSessionId);
    if (!lanes) {
      const plan = this.plans.get(rootSessionId);
      lanes = [
        {
          laneId: `root:${rootSessionId}`,
          kind: "root",
          sessionId: rootSessionId,
          rootSessionId,
          planId: plan?.planId ?? "none",
          assignedNodeIds: [],
          status: "idle",
          nudgeCount: 0,
        },
      ];
      this.lanes.set(rootSessionId, lanes);
    }
    return lanes;
  }

  private persistTasks(rootSessionId: string, tasks: Task[]): void {
    TASK_MANAGER.replaceTasks(rootSessionId, tasks);
  }

  private emit(
    rootSessionId: string,
    type: TodoEventType,
    extra?: Partial<TodoEvent>,
  ): void {
    const plan = this.plans.get(rootSessionId);
    const ev: TodoEvent = {
      ts: nowIso(),
      type,
      planId: extra?.planId ?? plan?.planId ?? "",
      rootSessionId,
      laneId: extra?.laneId,
      nodeId: extra?.nodeId,
      payload: extra?.payload,
    };
    const list = this.events.get(rootSessionId) ?? [];
    list.push(ev);
    this.events.set(rootSessionId, list);
    for (const fn of this.eventListeners) {
      try {
        fn(ev);
      } catch {
        /* ignore */
      }
    }
  }

  private enqueueNotice(rootSessionId: string, notice: TodoNotice): void {
    const list = this.pendingNotices.get(rootSessionId) ?? [];
    list.push(notice);
    this.pendingNotices.set(rootSessionId, list);
  }

  private renderWithLanes(rootSessionId: string): string {
    const base = TASK_MANAGER.render(rootSessionId);
    const lanes = this.getLanes(rootSessionId).filter((l) => l.status !== "recycled");
    if (lanes.length === 0) return base;
    const lines = ["", "## Lanes", "```", ...this.formatLaneTree(lanes), "```"];
    const plan = this.plans.get(rootSessionId);
    if (plan) lines.unshift(`plan=${plan.planId} status=${plan.status}`);
    return `${base}\n${lines.join("\n")}`;
  }

  private formatLaneTree(lanes: TodoLane[]): string[] {
    const lines: string[] = [];
    const root = lanes.find((l) => l.kind === "root");
    const forks = lanes.filter((l) => l.kind === "fork");
    if (root) {
      lines.push(
        `● ${root.laneId}  ${root.status}` +
          (root.currentNodeId ? `  · ${root.currentNodeId}` : ""),
      );
    }
    for (const f of forks) {
      lines.push(
        `  ├─ ${f.laneId}  ${f.status}` +
          (f.currentNodeId ? `  · ${f.currentNodeId}` : ""),
      );
    }
    return lines;
  }
}

// 全局单例见 register.ts（bind 到 tools 宿主桥）
