/**
 * Subagent 工具 — 创建克隆子 Agent
 * 对应 Python: core/tools/impls/subagent_creat_tool.py
 *
 * 创建克隆子 Agent 处理独立任务。继承 ROLE 模板，注册为项目专属 Agent。
 */

import { Tool } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { createToolResponse } from "../../base.js";
import { TASK_MANAGER, TaskScheduler } from "../../task/task_manage/tool.js";

const STATUS_EMOJI: Record<string, string> = {
  idle: "💤", busy: "🔵", working: "🟢", stopped: "🔴", error: "💥",
};

export class SubagentTool extends Tool {
  readonly definition: ToolDefinition = {
    name: "agent_message",
    aliases: ["subagent_creat", "subagent-create", "clone-agent"],
    description:
      "fork 子 Agent 真并行执行独立任务。子 Agent 是主 Agent 的轻量克隆，继承 ROLE 模板。" +
      "适用场景：并行任务拆分、独立搜索/分析/写报告等。" +
      "与 task_manage fork_layer 配合：先 task_manage fork_layer 拿 ready task 列表，再 agent_message fork_layer 并发执行。" +
      "依赖 runtime.setSubagentExecutor() 注入执行器（harness 提供 runFn）。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["fork", "create", "fork_layer"],
          description:
            'fork/create: fork 单个子 Agent 执行 task | fork_layer: 并发 fork 当前 ready 的 task 层（与 task_manage fork_layer 配合）',
        },
        name: { type: "string", description: "子 Agent 唯一名称（fork 时作为 taskId，可省略自动生成）" },
        task: { type: "string", description: "分配给子 Agent 的任务描述（fork 必填）" },
        description: { type: "string", description: "子 Agent 角色说明（可选）" },
      },
      required: ["action"],
      additionalProperties: false,
    },
    allowedModes: ["execute"],
  };

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    const action = String(params.action ?? "").trim().toLowerCase();
    const name = String(params.name ?? "").trim();
    const task = String(params.task ?? "").trim();
    const description = String(params.description ?? "").trim();

    // fork：真并行执行子 Agent（依赖 ctx.subagentExecutor 由 runtime 注入）
    if (action === "fork" || action === "create") {
      return this.doFork(name || undefined, task, description, ctx);
    }
    if (action === "fork_layer") {
      return this.doForkLayer(ctx);
    }

    // 兼容旧 API（list/status/output/update-task/stop）——这些依赖 harness HTTP 路由，
    // 在纯 SDK 场景下不可用；保留 stub 提示
    const legacyActions = ["list", "status", "output", "update-task", "stop"];
    if (legacyActions.includes(action)) {
      return createToolResponse(
        false,
        `${action} 操作依赖 harness HTTP 路由，纯 SDK 场景下不可用。` +
          `真并行 fork 请用 action: "fork"（单任务）或 "fork_layer"（同层并发）。`,
      );
    }

    return createToolResponse(
      false,
      `不支持的操作: ${action}。支持: fork（fork 单个子 Agent 执行任务）/ fork_layer（并发 fork 当前 ready 的 task 层）`,
    );
  }

  /**
   * fork 单个子 Agent 执行独立任务（真并行）。
   * 依赖 ctx.subagentExecutor —— 由 AgentRuntime 注入 SubagentExecutor 实例。
   */
  private async doFork(
    name: string | undefined,
    task: string,
    _description: string,
    ctx: ToolContext,
  ): Promise<ToolResponse> {
    if (!task) return createToolResponse(false, "请提供 task（分配给子 Agent 的任务描述）。");
    if (!ctx.subagentExecutor) {
      return createToolResponse(
        false,
        "子 Agent 执行器未注入。harness 需通过 runtime.setSubagentExecutor() 注入。" +
          "如未配置，请改用 task_manage + task_finish 串行执行。",
      );
    }

    const taskId = name || `task-${Date.now().toString(36)}`;
    try {
      const result = await ctx.subagentExecutor.fork(taskId, task);
      const status = result.ok ? "✅" : "❌";
      const lines = [
        `${status} 子 Agent 执行完成（${result.elapsedMs}ms）`,
        `taskId: ${result.taskId}`,
        `subSessionId: ${result.subSessionId}`,
        result.error ? `error: ${result.error}` : "",
        "── 输出 ──",
        result.output || "(无输出)",
      ].filter(Boolean);
      return createToolResponse(result.ok, lines.join("\n"), {
        payload: { result },
        displayEvents: [{ type: "terminal", stream: "info", text: `[子 Agent] ${taskId} 完成: ok=${result.ok}` }],
      });
    } catch (err) {
      return createToolResponse(false, `fork 失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * fork_layer：并发 fork 当前 ready 的 task 层（真并行）。
   * 与 task_manage fork_layer action 配合：
   *   1. LLM 调 task_manage fork_layer → 拿到 ready task 列表
   *   2. LLM 调 agent_message fork_layer → 真正并发 fork 这一层的所有 task
   */
  private async doForkLayer(ctx: ToolContext): Promise<ToolResponse> {
    if (!ctx.subagentExecutor) {
      return createToolResponse(
        false,
        "子 Agent 执行器未注入。harness 需通过 runtime.setSubagentExecutor() 注入。",
      );
    }

    // 从 TaskManager 拿当前 ready 的 task 层
    const allTasks = TASK_MANAGER.getTasks(ctx.sessionId);
    const ready = TaskScheduler.selectLayer(allTasks);
    if (ready.length === 0) {
      return createToolResponse(true, "当前没有可并行执行的 task（可能全部完成、或下层被依赖阻塞）。");
    }

    try {
      const results = await ctx.subagentExecutor.forkLayer(
        ready.map((t) => ({ id: t.id, desc: t.desc })),
      );
      const lines: string[] = [
        `⚡ 并发 fork ${ready.length} 个子 Agent 完成：`,
        "",
      ];
      for (const r of results) {
        const status = r.ok ? "✅" : "❌";
        lines.push(`${status} ${r.taskId} (${r.elapsedMs}ms)${r.error ? ` — ${r.error}` : ""}`);
        if (r.output) {
          const preview = r.output.length > 200 ? r.output.slice(0, 200) + "..." : r.output;
          lines.push(`   输出预览: ${preview}`);
        }
      }
      const okCount = results.filter((r) => r.ok).length;
      lines.push("", `成功 ${okCount}/${results.length}`);
      return createToolResponse(okCount === results.length, lines.join("\n"), {
        payload: { results, total: results.length, ok: okCount },
        displayEvents: [{ type: "terminal", stream: "info", text: `[子 Agent] fork_layer 完成: ${okCount}/${results.length}` }],
      });
    } catch (err) {
      return createToolResponse(false, `fork_layer 失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
