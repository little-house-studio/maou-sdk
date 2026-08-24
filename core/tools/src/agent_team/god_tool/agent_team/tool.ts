/**
 * agent_team — 团队领域统一入口。
 * agent_message / agent_manage 仍是独立上帝工具；本工具按 action 转调它们。
 */

import { Tool, toolDir, createToolResponse } from "../../../base.js";
import type { ToolContext, ToolDefinition, ToolResponse } from "../../../base.js";
import { SubagentTool } from "../../agent_message/tool.js";
import { TeamManageTool } from "../../agent_manage/tool.js";

const MESSAGE_ACTIONS = new Set(["fork", "create_subagent"]);
const MANAGE_ACTIONS = new Set([
  "list",
  "create",
  "dispatch",
  "stop",
  "message",
  "interrupt",
  "insert",
  "remove",
]);

export class AgentTeamGodTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);
  readonly definition: ToolDefinition = {
    name: "agent_team",
    aliases: ["god_agent_team"],
    description:
      "团队领域统一入口。fork/create_subagent 转 agent_message；" +
      "list/create/dispatch/stop/message/interrupt/insert/remove 转 agent_manage。" +
      "派活/插话/中断/停止也可直接用 agent_send。todo 并行层由 harness 自动调度。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "fork",
            "create_subagent",
            "list",
            "create",
            "dispatch",
            "stop",
            "message",
            "interrupt",
            "insert",
            "remove",
          ],
          description:
            "fork/create_subagent=派生子 Agent；其余为团队管理（create=建队友）。",
        },
      },
      required: ["action"],
      additionalProperties: true,
    },
    allowedModes: ["execute"],
  };

  private readonly message = new SubagentTool();
  private readonly manage = new TeamManageTool();

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    const action = String(params.action ?? "").trim().toLowerCase();
    if (MESSAGE_ACTIONS.has(action)) {
      const mapped = action === "create_subagent" ? "create" : action;
      return this.message.execute({ ...params, action: mapped }, ctx);
    }
    if (MANAGE_ACTIONS.has(action)) {
      return this.manage.execute(params, ctx);
    }
    return createToolResponse(
      false,
      `不支持的 action: ${action}。fork/create_subagent 走子 Agent；` +
        `list/create/dispatch/stop/message/interrupt/insert/remove 走团队管理。` +
        (action === "fork_layer" ? " todo 并行层由 harness 自动调度，不是工具。" : ""),
    );
  }
}
