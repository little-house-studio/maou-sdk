/**
 * Task Management 工具 — 任务管理与调度
 * 对应 Python: core/tools/impls/task_manager.py
 *
 * TaskScheduler: 纯程序化调度器，根据 task_finish 自动推进下一步
 * TaskManager: Per-session 任务状态管理
 */

import { Tool, toolDir } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { createToolResponse } from "../../base.js";

export interface Task {
  id: string;
  desc: string;
  deps: string[];
  status: "pending" | "in_progress" | "completed";
  summary: string;
  /** 关联的归档 task 块 ID 列表（压缩时由系统自动追加） */
  relatedBlockIds?: string[];
}

export class TaskScheduler {
  /** 选出下一个应执行的任务 ID（向后兼容：返回 ready 中 id 最小的一个） */
  static selectNext(tasks: Task[]): string | null {
    const layer = TaskScheduler.selectLayer(tasks);
    return layer.length > 0 ? layer.sort((a, b) => a.id.localeCompare(b.id))[0].id : null;
  }

  /**
   * 选出当前**可并行执行**的一层 task（#4：同层多 in_progress）。
   *
   * ready 的定义：deps 全部 completed + 自身未 completed 未 in_progress。
   * 同层 task 互无依赖，可并行 fork 执行。
   *
   * @returns ready 的 task 数组（可能为空、可能 1 个、可能多个）
   */
  static selectLayer(tasks: Task[]): Task[] {
    const completedIds = new Set(tasks.filter((t) => t.status === "completed").map((t) => t.id));
    return tasks.filter(
      (t) =>
        t.status === "pending" &&
        (t.deps.length === 0 || t.deps.every((d) => completedIds.has(d))),
    );
  }

  /**
   * 生成执行计划（#3：依赖锁管理 + 并行分层）。
   *
   * 按 deps 拓扑排序，返回执行层级：每层内的 task 互无依赖，可并行执行。
   * 已完成的 task 跳过；检测到循环依赖时截断（防止死锁）。
   *
   * @returns 层级数组，每层是可并行执行的 task 数组
   */
  static getExecutionPlan(tasks: Task[]): Task[][] {
    const completed = new Set(tasks.filter((t) => t.status === "completed").map((t) => t.id));
    const done = new Set(completed);
    const remaining = tasks.filter((t) => t.status !== "completed");
    const result: Task[][] = [];

    while (remaining.length > 0) {
      const layer = remaining.filter((t) =>
        t.deps.every((d) => done.has(d)) && !done.has(t.id),
      );
      if (layer.length === 0) break; // 循环依赖保护
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
   *
   * #4 改造：不再清其他 in_progress（保留同层并行状态），也不再自动选 selectNext。
   * 新 in_progress 的补充由 TaskManager.finish() 调 selectLayer 完成。
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

    // #4：不清其他 in_progress（保留同层并行状态）
    // 新 in_progress 的补充由 TaskManager.finish() 调 selectLayer 完成

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
   * 解耦设计：TaskManager 不直接依赖 TaskSessionStore（context 包），
   * 而是由调用方（runtime）注入回调。回调内部调 taskStore.saveTaskPlan()。
   */
  setPersistCallback(cb: (sessionId: string, tasks: Task[]) => void): void {
    this.persistCallback = cb;
  }

  /**
   * 从持久化数据恢复内存状态（进程启动时调用）
   *
   * @param sessionId - 会话 ID
   * @param tasks - 从 task_plan.json 加载的任务清单（通常只含未完成项）
   */
  restore(sessionId: string, tasks: Task[]): void {
    if (tasks.length > 0) {
      this.state.set(sessionId, tasks);
    }
  }

  manage(sessionId: string, action: string, tasks: Record<string, unknown>[] | null): string {
    if (action === "delete") {
      this.state.delete(sessionId);
      this.persistCallback?.(sessionId, []);
      return "任务表已清空。";
    }
    if (!tasks || tasks.length === 0) return "当前没有任务。";
    if (tasks.length > 50) throw new Error("最多允许 50 个任务");

    const validated: Task[] = [];
    const taskIds = new Set<string>();

    for (const item of tasks) {
      const taskId = String(item.id ?? "").trim();
      const desc = String(item.desc ?? "").trim();
      const depsRaw = item.deps ?? [];
      const status = String(item.status ?? "pending").toLowerCase();

      if (!taskId) throw new Error("每个任务必须有 id");
      if (!desc) throw new Error(`任务 ${taskId}: desc 不能为空`);
      if (!["pending", "in_progress", "completed"].includes(status)) {
        throw new Error(`任务 ${taskId}: 无效状态 '${status}'`);
      }
      if (taskIds.has(taskId)) throw new Error(`任务 ${taskId}: 重复的 id`);
      taskIds.add(taskId);

      const deps = (Array.isArray(depsRaw) ? depsRaw : [])
        .map((d: unknown) => String(d).trim())
        .filter(Boolean);
      for (const dep of deps) {
        if (!taskIds.has(dep) && !validated.some((v) => v.id === dep)) {
          throw new Error(`任务 ${taskId}: 依赖 ${dep} 不存在`);
        }
      }

      validated.push({
        id: taskId,
        desc,
        deps,
        status: status as Task["status"],
        summary: String(item.summary ?? ""),
      });
    }

    this.state.set(sessionId, validated);

    // 自动选第一层（#4：同层多 in_progress，可并行 fork 执行）
    const layer = TaskScheduler.selectLayer(validated);
    for (const t of layer) {
      t.status = "in_progress";
    }
    this.state.set(sessionId, validated);

    // 同步持久化到 task_plan.json（若已注入回调）
    this.persistCallback?.(sessionId, validated);

    return this.render(sessionId);
  }

  finish(sessionId: string, taskId: string, summary: string): string {
    const tasks = this.state.get(sessionId) ?? [];
    if (tasks.length === 0) return "当前没有任务。";

    let found = false;
    for (const t of tasks) {
      if (t.id === taskId) {
        if (t.status === "completed") return `任务 ${taskId} 已经完成过了。\n\n${this.render(sessionId)}`;
        t.summary = summary.slice(0, 200);
        found = true;
        break;
      }
    }
    if (!found) return `未找到任务 ${taskId}。`;

    TaskScheduler.onTaskFinished(tasks, taskId);

    // #4：完成后自动补充新的 in_progress（同层剩余 task + 新解锁的下层 task）
    const newReady = TaskScheduler.selectLayer(tasks);
    for (const t of newReady) {
      t.status = "in_progress";
    }
    this.state.set(sessionId, tasks);
    this.persistCallback?.(sessionId, tasks);

    // #3：明确下一步该执行的 task（依赖锁解锁后自动推进）
    const next = TaskScheduler.selectNext(tasks);
    const allDone = tasks.length > 0 && tasks.every((t) => t.status === "completed");
    const inProgressCount = tasks.filter((t) => t.status === "in_progress").length;
    const nextHint = allDone
      ? "\n\n🎉 全部任务完成，可回复用户收尾"
      : inProgressCount > 1
        ? `\n\n⚡ 当前 ${inProgressCount} 个 task 并行执行中（可 fork 子 agent 加速）`
        : next
          ? `\n\n▶ 下一步执行: ${next}（依赖已解锁，可继续）`
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
    if (tasks.length === 0) return "当前没有任务。\n📋 已完成: 0/0";

    const completedIds = new Set(tasks.filter((t) => t.status === "completed").map((t) => t.id));
    const current = tasks.find((t) => t.status === "in_progress")?.id ?? null;
    const total = tasks.length;
    const done = completedIds.size;

    const lines: string[] = ["| # | 任务 | 状态 | 依赖 |", "|---|------|------|------|"];
    for (const t of tasks) {
      let icon = { completed: "[x]", in_progress: "[>]", pending: "[ ]" }[t.status] ?? "[ ]";
      if (t.status === "pending" && t.deps.some((d) => !completedIds.has(d))) {
        icon = "⏳";
      }
      const depsStr = t.deps.length > 0 ? t.deps.join(", ") : "—";
      lines.push(`| ${t.id} | ${t.desc} | ${icon} | ${depsStr} |`);
    }

    if (current) {
      const curTask = tasks.find((t) => t.id === current);
      if (curTask) lines.push(`\n▶ 当前执行: ${current} — ${curTask.desc}`);
    }

    // #4：显示所有 in_progress（同层并行执行中）
    const inProgress = tasks.filter((t) => t.status === "in_progress");
    if (inProgress.length > 1) {
      lines.push(`⚡ 并行执行中 (${inProgress.length}): ${inProgress.map((t) => t.id).join(", ")}`);
    }

    const blocked = tasks.filter((t) => t.status !== "completed" && t.deps.some((d) => !completedIds.has(d)));
    const ready = tasks.filter((t) => t.status === "pending" && (t.deps.length === 0 || t.deps.every((d) => completedIds.has(d))));

    if (ready.length > 0) lines.push(`📋 就绪: ${ready.map((r) => r.id).join(", ")}`);
    if (blocked.length > 0) lines.push(`⏳ 阻塞: ${blocked.map((b) => b.id).join(", ")}`);
    lines.push(`📋 已完成: ${done}/${total}`);

    // #3：显示执行计划（可并行的 task 分层，同层可并行执行）
    const plan = TaskScheduler.getExecutionPlan(tasks);
    if (plan.length > 0) {
      lines.push("\n📊 执行计划（同层可并行）:");
      plan.forEach((layer, idx) => {
        const ids = layer.map((t) => t.id).join(", ");
        lines.push(`  L${idx + 1}: ${ids}`);
      });
    }

    if (total === done) lines.push("\n🎉 全部任务已完成！");

    return lines.join("\n");
  }
}

// 单例
export const TASK_MANAGER = new TaskManager();

/**
 * TaskManageTool — 任务管理工具（Tool 子类）
 * 包装 TaskManager，供 ToolRegistry 注册使用。
 */
export class TaskManageTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);
  readonly definition: ToolDefinition = {
    name: "task_manage",
    aliases: [],
    description:
      "管理任务表。仅在用户给出明确的多步骤复杂任务时使用，用于规划和跟踪进度。" +
      "简单对话、问候、闲聊、单步操作不需要使用。" +
      "提示：尽可能设计可并行的任务（无 deps 依赖），系统自动管理依赖锁，同层 task 自动标记为 in_progress 可并行执行。" +
      "调用 fork_layer 可查询当前可并行的一层 task（系统会返回 ready 的 task 列表，可配合 agent_message 工具 fork 子 Agent 加速）。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["create", "replace", "delete", "fork_layer"],
          description: "create: 新建 | replace: 替换 | delete: 清空 | fork_layer: 查询当前可并行执行的一层 task",
        },
        reason: { type: "string", description: "为什么必须调用此工具而不是直接回复用户？" },
        tasks: {
          type: "array",
          description: "任务列表（delete 时忽略）。",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "任务唯一标识" },
              desc: { type: "string", description: "任务描述" },
              deps: { type: "array", items: { type: "string" }, description: "依赖的任务 ID 列表。空数组=无依赖。" },
              status: { type: "string", enum: ["pending", "in_progress", "completed"], description: "状态" },
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

    // fork_layer：查询当前可并行执行的一层 task（不修改状态）
    if (action === "fork_layer") {
      const tasks = TASK_MANAGER.getTasks(ctx.sessionId);
      const ready = TaskScheduler.selectLayer(tasks);
      if (ready.length === 0) {
        return createToolResponse(true, "当前没有可并行执行的 task（可能全部完成、或下层被依赖阻塞）。", {
          displayEvents: [{ type: "terminal", stream: "info", text: `[任务管理] fork_layer: 无可并行 task` }],
        });
      }
      const lines: string[] = [
        `⚡ 当前可并行执行 ${ready.length} 个 task:`,
        ...ready.map((t) => `- ${t.id}: ${t.desc}`),
        "",
        "提示：可用 agent_message 工具为每个 task fork 子 Agent 并行执行；",
        "或串行逐个完成（每完成一个调 task_finish，系统会自动解锁下一层）。",
      ];
      return createToolResponse(true, lines.join("\n"), {
        payload: { ready_tasks: ready.map((t) => ({ id: t.id, desc: t.desc })) },
        displayEvents: [{ type: "terminal", stream: "info", text: `[任务管理] fork_layer: ${ready.length} 个可并行` }],
      });
    }

    try {
      const rendered = TASK_MANAGER.manage(ctx.sessionId, action, tasksRaw);
      return createToolResponse(true, rendered, {
        displayEvents: [
          { type: "terminal", stream: "info", text: `[任务管理] ${action}` },
        ],
      });
    } catch (err) {
      return createToolResponse(false, `任务管理失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
