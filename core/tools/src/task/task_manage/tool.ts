/**
 * Todo Management 工具 — Agent 会话级 todo 清单（规划 / 依赖链 / 进度）
 *
 * 逻辑切割：
 *   - todo_*：当前会话内的 checklist（本模块）
 *   - agent_message / supervisor_task_control / project_manage：子 Agent / 监督 / 项目级「任务」
 *   - 飞书 lark-task 等：外部系统任务
 *
 * 内部仍用 TaskManager / task_plan.json 持久化字段名，避免破坏既有 session 数据。
 * 对外工具名：todo_manage（兼容别名 task_manage）。
 */

import { Tool, toolDir } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { createToolResponse } from "../../base.js";

export interface Task {
  id: string;
  desc: string;
  deps: string[];
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled";
  summary: string;
  /** 完整交接汇报（链终点 / todo_finish.report） */
  report?: string;
  /** failed 时原因 */
  failReason?: string;
  /** 当前绑定的编排 lane */
  laneId?: string;
  /** 关联的归档 task 块 ID 列表（压缩时由系统自动追加） */
  relatedBlockIds?: string[];
}

/** @deprecated 使用 Task；保留类型别名兼容旧 import */
export type TodoItem = Task;

export class TaskScheduler {
  /** 选出下一个应执行的 todo ID（向后兼容：返回 ready 中 id 最小的一个） */
  static selectNext(tasks: Task[]): string | null {
    const layer = TaskScheduler.selectLayer(tasks);
    return layer.length > 0 ? layer.sort((a, b) => a.id.localeCompare(b.id))[0].id : null;
  }

  /**
   * 选出当前**可并行执行**的一层 todo。
   *
   * ready 的定义：deps 全部 completed + 自身未 completed 未 in_progress。
   * 同层 todo 互无依赖，可并行 fork 执行。
   */
  static selectLayer(tasks: Task[]): Task[] {
    // 仅 completed 解锁；failed/cancelled 不解锁下游
    const completedIds = new Set(tasks.filter((t) => t.status === "completed").map((t) => t.id));
    return tasks.filter(
      (t) =>
        t.status === "pending" &&
        (t.deps.length === 0 || t.deps.every((d) => completedIds.has(d))),
    );
  }

  /**
   * 生成执行计划：按 deps 拓扑排序，每层内可并行。
   * 已完成的跳过；循环依赖时截断。
   */
  static getExecutionPlan(tasks: Task[]): Task[][] {
    const completed = new Set(tasks.filter((t) => t.status === "completed").map((t) => t.id));
    const done = new Set(completed);
    // failed/cancelled 视为终态，不再进入执行计划
    const remaining = tasks.filter(
      (t) => t.status === "pending" || t.status === "in_progress",
    );
    const result: Task[][] = [];

    while (remaining.length > 0) {
      const layer = remaining.filter((t) =>
        t.deps.every((d) => done.has(d)) && !done.has(t.id),
      );
      if (layer.length === 0) break;
      result.push(layer);
      for (const t of layer) done.add(t.id);
      for (const t of layer) {
        const idx = remaining.indexOf(t);
        if (idx >= 0) remaining.splice(idx, 1);
      }
    }
    return result;
  }

  /**
   * 标记完成 → 解锁依赖 → 返回状态摘要。
   * 不清其他 in_progress（保留同层并行）；新 in_progress 由 TaskManager.finish() 补。
   */
  static onTaskFinished(tasks: Task[], finishedId: string): {
    next: string | null;
    blocked: string[];
    done: number;
    total: number;
    allDone: boolean;
  } {
    for (const t of tasks) {
      if (t.id === finishedId) t.status = "completed";
    }

    const completedIds = new Set(tasks.filter((t) => t.status === "completed").map((t) => t.id));
    const blocked = tasks
      .filter((t) => t.status !== "completed" && t.deps.some((d) => !completedIds.has(d)))
      .map((t) => t.id);

    const nextId = TaskScheduler.selectNext(tasks);

    return {
      next: nextId,
      blocked,
      done: completedIds.size,
      total: tasks.length,
      allDone: completedIds.size === tasks.length,
    };
  }
}

export class TaskManager {
  private state: Map<string, Task[]> = new Map();
  /** 持久化回调（注入后，每次 CRUD 自动同步到 task_plan.json） */
  private persistCallback?: (sessionId: string, tasks: Task[]) => void;

  /**
   * 注入持久化回调
   *
   * 解耦：TaskManager 不直接依赖 TaskSessionStore（context 包），
   * 由 runtime 注入回调，内部调 taskStore.saveTaskPlan()。
   */
  setPersistCallback(cb: (sessionId: string, tasks: Task[]) => void): void {
    this.persistCallback = cb;
  }

  /**
   * 从持久化数据恢复内存状态（进程启动 / 会话恢复时）
   */
  restore(sessionId: string, tasks: Task[]): void {
    if (tasks.length > 0) {
      this.state.set(sessionId, tasks);
    }
  }

  /**
   * 整表写入（不自动 selectLayer）。供 TodoOrchestrator 调度后落盘。
   */
  replaceTasks(sessionId: string, tasks: Task[]): void {
    this.state.set(sessionId, tasks);
    this.persistCallback?.(sessionId, tasks);
  }

  /**
   * 低层 manage（无编排）。生产路径请走 TodoOrchestrator.manage。
   * @param action create | replace | delete | list
   */
  manage(sessionId: string, action: string, tasks: Record<string, unknown>[] | null): string {
    const act = action.trim().toLowerCase();

    if (act === "list") {
      return this.render(sessionId);
    }

    if (act === "delete") {
      this.state.delete(sessionId);
      this.persistCallback?.(sessionId, []);
      return "Todo 清单已清空。";
    }

    if (act !== "create" && act !== "replace") {
      throw new Error(`未知 action '${action}'，支持: create | replace | delete | list`);
    }

    if (act === "create") {
      const existing = this.state.get(sessionId) ?? [];
      if (existing.length > 0) {
        throw new Error(
          "当前会话已有 todo 清单。若要整表覆盖请用 action=replace；若只想查看请用 action=list。",
        );
      }
    }

    if (!tasks || tasks.length === 0) {
      if (act === "replace") {
        this.state.delete(sessionId);
        this.persistCallback?.(sessionId, []);
        return "Todo 清单已清空（replace 传入空列表）。";
      }
      return "当前没有 todo。请在 tasks 中提供至少一项。";
    }
    if (tasks.length > 50) throw new Error("最多允许 50 个 todo");

    const validated: Task[] = [];
    const taskIds = new Set<string>();

    for (const item of tasks) {
      const taskId = String(item.id ?? "").trim();
      const desc = String(item.desc ?? "").trim();
      const depsRaw = item.deps ?? [];
      const status = String(item.status ?? "pending").toLowerCase();

      if (!taskId) throw new Error("每个 todo 必须有 id");
      if (!desc) throw new Error(`todo ${taskId}: desc 不能为空`);
      if (!["pending", "in_progress", "completed", "failed", "cancelled"].includes(status)) {
        throw new Error(`todo ${taskId}: 无效状态 '${status}'`);
      }
      if (taskIds.has(taskId)) throw new Error(`todo ${taskId}: 重复的 id`);
      taskIds.add(taskId);

      const deps = (Array.isArray(depsRaw) ? depsRaw : [])
        .map((d: unknown) => String(d).trim())
        .filter(Boolean);
      for (const dep of deps) {
        if (!taskIds.has(dep) && !validated.some((v) => v.id === dep)) {
          // 允许后向引用：第二遍在 orchestrator；此处兼容旧路径要求先出现
          if (!tasks.some((x) => String((x as { id?: string }).id ?? "").trim() === dep)) {
            throw new Error(`todo ${taskId}: 依赖 ${dep} 不存在`);
          }
        }
      }

      validated.push({
        id: taskId,
        desc,
        deps,
        status: status as Task["status"],
        summary: String(item.summary ?? ""),
        report: item.report != null ? String(item.report) : undefined,
        failReason: item.failReason != null ? String(item.failReason) : undefined,
        laneId: item.laneId != null ? String(item.laneId) : undefined,
      });
    }

    // 校验 deps 均存在
    for (const t of validated) {
      for (const d of t.deps) {
        if (!taskIds.has(d)) throw new Error(`todo ${t.id}: 依赖 ${d} 不存在`);
      }
    }

    // 低层路径：自动 in_progress 第一层（兼容旧调用）；编排器会 replaceTasks 覆盖
    const layer = TaskScheduler.selectLayer(validated);
    for (const t of layer) {
      t.status = "in_progress";
    }
    this.state.set(sessionId, validated);
    this.persistCallback?.(sessionId, validated);

    return this.render(sessionId);
  }

  /**
   * 低层 finish（无 lane）。生产路径请走 TodoOrchestrator.finish。
   */
  finish(
    sessionId: string,
    taskId: string,
    summary: string,
    opts?: { status?: "completed" | "failed"; report?: string; reason?: string },
  ): string {
    const tasks = this.state.get(sessionId) ?? [];
    if (tasks.length === 0) return "当前没有 todo。请先用 todo_manage action=create 建立清单。";

    const status = opts?.status ?? "completed";
    let found = false;
    for (const t of tasks) {
      if (t.id === taskId) {
        if (t.status === "completed" || t.status === "failed") {
          return `Todo ${taskId} 已是终态（${t.status}）。\n\n${this.render(sessionId)}`;
        }
        t.summary = summary.slice(0, 500);
        if (opts?.report) t.report = opts.report;
        if (status === "failed") {
          t.status = "failed";
          t.failReason = opts?.reason ?? summary;
        } else {
          t.status = "completed";
        }
        found = true;
        break;
      }
    }
    if (!found) {
      return `未找到 todo ${taskId}。\n\n${this.render(sessionId)}\n（可用 todo_manage action=list 查看 id）`;
    }

    if (status === "completed") {
      TaskScheduler.onTaskFinished(tasks, taskId);
      const newReady = TaskScheduler.selectLayer(tasks);
      for (const t of newReady) {
        t.status = "in_progress";
      }
    }
    // failed：不解锁、不自动 in_progress 下游
    this.state.set(sessionId, tasks);
    this.persistCallback?.(sessionId, tasks);

    const next = TaskScheduler.selectNext(tasks);
    const allDone =
      tasks.length > 0 &&
      tasks.every((t) => t.status === "completed" || t.status === "failed" || t.status === "cancelled");
    const inProgressCount = tasks.filter((t) => t.status === "in_progress").length;
    const nextHint = allDone
      ? "\n\n🎉 全部 todo 已终态，可回复用户收尾"
      : status === "failed"
        ? `\n\n❌ ${taskId} failed（下游不会因此自动解锁）`
        : inProgressCount > 1
          ? `\n\n⚡ 当前 ${inProgressCount} 个 todo 并行执行中`
          : next
            ? `\n\n▶ 下一步: ${next}（依赖已解锁，可继续；完成后调用 todo_finish）`
            : "\n\n⏳ 下一步被阻塞，等待依赖完成";
    return this.render(sessionId) + nextHint;
  }

  getCurrent(sessionId: string): string | null {
    const tasks = this.state.get(sessionId) ?? [];
    for (const t of tasks) {
      if (t.status === "in_progress") return t.id;
    }
    return null;
  }

  getTasks(sessionId: string): Task[] {
    return this.state.get(sessionId) ?? [];
  }

  render(sessionId: string): string {
    const tasks = this.state.get(sessionId) ?? [];
    if (tasks.length === 0) return "当前没有 todo。\n📋 已完成: 0/0";

    const completedIds = new Set(tasks.filter((t) => t.status === "completed").map((t) => t.id));
    const total = tasks.length;
    const done = completedIds.size;

    const lines: string[] = ["| # | Todo | 状态 | 依赖 |", "|---|------|------|------|"];
    for (const t of tasks) {
      let icon =
        {
          completed: "[x]",
          in_progress: "[>]",
          pending: "[ ]",
          failed: "[!]",
          cancelled: "[-]",
        }[t.status] ?? "[ ]";
      if (t.status === "pending" && t.deps.some((d) => !completedIds.has(d))) {
        icon = "⏳";
      }
      const depsStr = t.deps.length > 0 ? t.deps.join(", ") : "—";
      const lane = t.laneId ? ` ·${t.laneId}` : "";
      lines.push(`| ${t.id} | ${t.desc} | ${icon}${lane} | ${depsStr} |`);
    }

    const inProgress = tasks.filter((t) => t.status === "in_progress");
    if (inProgress.length === 1) {
      lines.push(`\n▶ 当前执行: ${inProgress[0].id} — ${inProgress[0].desc}`);
    } else if (inProgress.length > 1) {
      lines.push(`⚡ 并行执行中 (${inProgress.length}): ${inProgress.map((t) => t.id).join(", ")}`);
    }

    const blocked = tasks.filter(
      (t) =>
        (t.status === "pending" || t.status === "in_progress") &&
        t.deps.some((d) => !completedIds.has(d)),
    );
    const ready = tasks.filter(
      (t) =>
        t.status === "pending" &&
        (t.deps.length === 0 || t.deps.every((d) => completedIds.has(d))),
    );
    const failed = tasks.filter((t) => t.status === "failed");

    if (ready.length > 0) lines.push(`📋 就绪: ${ready.map((r) => r.id).join(", ")}`);
    if (blocked.length > 0) lines.push(`⏳ 阻塞: ${blocked.map((b) => b.id).join(", ")}`);
    if (failed.length > 0) lines.push(`❌ 失败: ${failed.map((f) => f.id).join(", ")}`);
    lines.push(`📋 已完成: ${done}/${total}`);

    const plan = TaskScheduler.getExecutionPlan(tasks);
    if (plan.length > 0) {
      lines.push("\n📊 执行计划（同层可并行）:");
      plan.forEach((layer, idx) => {
        const ids = layer.map((t) => t.id).join(", ");
        lines.push(`  L${idx + 1}: ${ids}`);
      });
    }

    const allTerminal = tasks.every(
      (t) => t.status === "completed" || t.status === "failed" || t.status === "cancelled",
    );
    if (allTerminal) lines.push("\n🎉 全部 todo 已终态！");

    return lines.join("\n");
  }
}

/** 单例（内部名保留 TASK_MANAGER，兼容 runtime / agent_message 等既有 import） */
export const TASK_MANAGER = new TaskManager();
/** 语义别名：会话级 todo 清单 */
export const TODO_MANAGER = TASK_MANAGER;

/**
 * TodoManageTool — 会话级 todo 清单管理
 * 公开名 todo_manage；兼容别名 task_manage。
 */
export class TodoManageTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);
  readonly definition: ToolDefinition = {
    name: "todo_manage",
    aliases: ["task_manage"],
    description:
      "管理当前会话的 todo 清单（多步骤规划与进度跟踪）。" +
      "create 提交后由后端自动调度依赖锁与分身分配；不要手搓并行 fork。" +
      "执行中禁止 replace。与 agent_message / supervisor 任务无关。" +
      "每完成一项由负责该节点的 agent 调用 todo_finish（一次只代表一个节点）。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["create", "replace", "delete", "list"],
          description:
            "create: 新建并自动调度 | replace: 仅无执行中时整表替换 | delete: 归档清空 | list: 只读",
        },
        reason: { type: "string", description: "为什么必须调用此工具而不是直接回复用户？" },
        tasks: {
          type: "array",
          description: "todo 列表（list/delete 时忽略）。",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "唯一标识" },
              desc: { type: "string", description: "描述" },
              deps: {
                type: "array",
                items: { type: "string" },
                description: "依赖的 todo id；空数组=无依赖（可并行）",
              },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "completed", "failed", "cancelled"],
                description: "初始建议 pending",
              },
            },
            required: ["id", "desc", "deps", "status"],
            additionalProperties: false,
          },
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
    allowedModes: ["execute"],
  };

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    const action = String(params.action ?? "").trim().toLowerCase();
    const tasksRaw = params.tasks as Record<string, unknown>[] | null;

    try {
      // 延迟 import 宿主桥：编排实现在 agent，经 bindTodoOrchestratorHost 挂接
      const { getTodoOrchestrator } = await import("../todo-orchestrator-host.js");
      const orch = getTodoOrchestrator();
      const rendered = orch.manage(ctx.sessionId, action, tasksRaw);
      const notices = orch.drainNotices(ctx.sessionId);
      return createToolResponse(true, rendered, {
        payload: {
          todo_notices: notices,
          plan: orch.getPlan(ctx.sessionId) ?? null,
          lanes: orch.getLanes(ctx.sessionId),
        },
        displayEvents: [
          { type: "terminal", stream: "info", text: `[todo] ${action}` },
        ],
      });
    } catch (err) {
      return createToolResponse(false, `Todo 管理失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/** @deprecated 使用 TodoManageTool */
export const TaskManageTool = TodoManageTool;
