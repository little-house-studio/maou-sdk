/**
 * change_self — 将「改造当前 Agent」任务交给隔离的维护子 Agent。
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { Tool, createToolResponse, resolveToolRuntimePorts, toolDir } from "../../base.js";
import type { ToolContext, ToolDefinition, ToolResponse } from "../../base.js";

export class ChangeSelfTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);
  readonly definition: ToolDefinition = {
    name: "change_self",
    aliases: [],
    description:
      "Call this only when the user explicitly asks to modify, extend, or maintain the current Maou Agent itself, " +
      "such as writing a new tool/MCP integration, changing its template, or updating its capability configuration. " +
      "It delegates the work to an isolated self-maintenance subagent.",
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "要对当前 Agent 做的改造目标、约束和验收条件。",
        },
      },
      required: ["task"],
      additionalProperties: false,
    },
    allowedModes: ["plan", "execute"],
  };

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    const task = String(params.task ?? "").trim();
    if (!task) return createToolResponse(false, "请提供 task（改造 Agent 的完整需求）。");
    const executor = resolveToolRuntimePorts(ctx).subagentExecutor;
    if (!executor) return createToolResponse(false, "Self-maintenance 子 Agent 执行器未注入。");

    const packageRoot = process.env.MAOU_SDK_ROOT?.trim();
    const agentRoot = join(ctx.maouRoot ?? ctx.projectRoot, "agents", ctx.agentName || "ops");
    const path = packageRoot && existsSync(packageRoot) ? packageRoot : agentRoot;
    const target = path === agentRoot
      ? `当前 Agent 的全局实例目录：${agentRoot}`
      : `Maou SDK 源码目录：${path}；当前 Agent 实例：${agentRoot}`;
    const delegatedTask = [
      "你是 Maou Agent 的 self-maintainer。",
      target,
      "只实现用户明确要求的 Agent 自身改造；先读取现状，遵循现有工具/模板约定，完成后运行相关验证。",
      "不要改用户业务项目，也不要提交或推送代码，除非用户明确要求。",
      "",
      task,
    ].join("\n");

    try {
      const result = await executor.fork(`change-self-${Date.now().toString(36)}`, delegatedTask, {
        kind: "project",
        agentName: "coding",
        path,
        persistContext: true,
        enableLoop: true,
        toolPreset: "coding_scoped",
      });
      return createToolResponse(result.ok, [
        `${result.ok ? "✅" : "❌"} self-maintainer 执行完成`,
        `path: ${path}`,
        `session: ${result.subSessionId}`,
        result.error ? `error: ${result.error}` : "",
        "── 输出 ──",
        result.output || "(无输出)",
      ].filter(Boolean).join("\n"), { payload: { result, path } });
    } catch (error) {
      return createToolResponse(false, `self-maintainer 执行失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
