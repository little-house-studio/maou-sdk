/**
 * Task Management 工具 — 任务管理与调度
 * 对应 Python: core/tools/impls/task_manager.py
 *
 * TaskScheduler: 纯程序化调度器，根据 task_finish 自动推进下一步
 * TaskManager: Per-session 任务状态管理
 */

import { Tool } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { createToolResponse } from "../../base.js";

export interface Task {
  id: string;
  desc: string;
  deps: string[];
  status: "pending" | "in_progress" | "completed";
  summary: string;
}

export class TaskScheduler {
  /** 选出下一个应执行的任务 ID */
  static selectNext(tasks: Task[]): string | null {
    const completedIds = new Set(tasks.filter((t) => t.status === "completed").map((t) => t.id));
    const ready: string[] = [];
    for (const t of tasks) {
      if (t.status !== "completed") {
        if (t.deps.length === 0 || t.deps.every((d) => completedIds.has(d))) {
          ready.push(t.id);
        }
      }
    }
    return ready.length > 0 ? ready.sort()[0] : null;
  }

  /** 标记完成 → 解锁依赖 → 选下一步 → 返回状态摘要 */
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

    // 清掉旧的 in_progress
    for (const t of tasks) {
      if (t.id !== finishedId && t.status === "in_progress") t.status = "pending";
    }

    const nextId = TaskScheduler.selectNext(tasks);
    if (nextId) {
      for (const t of tasks) {
        if (t.id === nextId) { t.status = "in_progress"; break; }
      }
    }

    const completedIds = new Set(tasks.filter((t) => t.status === "completed").map((t) => t.id));
    const blocked = tasks
      .filter((t) => t.status !== "completed" && t.deps.some((d) => !completedIds.has(d)))
      .map((t) => t.id);

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

  manage(sessionId: string, action: string, tasks: Record<string, unknown>[] | null): string {
    if (action === "delete") {
      this.state.delete(sessionId);
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

    // 自动选第一步
    const next = TaskScheduler.selectNext(validated);
    if (next) {
      for (const t of validated) {
        if (t.id === next) t.status = "in_progress";
      }
    }
    this.state.set(sessionId, validated);

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
    this.state.set(sessionId, tasks);
    return this.render(sessionId);
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

    const blocked = tasks.filter((t) => t.status !== "completed" && t.deps.some((d) => !completedIds.has(d)));
    const ready = tasks.filter((t) => t.status === "pending" && (t.deps.length === 0 || t.deps.every((d) => completedIds.has(d))));

    if (ready.length > 0) lines.push(`📋 就绪: ${ready.map((r) => r.id).join(", ")}`);
    if (blocked.length > 0) lines.push(`⏳ 阻塞: ${blocked.map((b) => b.id).join(", ")}`);
    lines.push(`📋 已完成: ${done}/${total}`);

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
  readonly definition: ToolDefinition = {
    name: "task_manage",
    aliases: [],
    description:
      "管理任务表。仅在用户给出明确的多步骤复杂任务时使用，用于规划和跟踪进度。" +
      "简单对话、问候、闲聊、单步操作不需要使用。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["create", "replace", "delete"],
          description: "create: 新建 | replace: 替换 | delete: 清空",
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
