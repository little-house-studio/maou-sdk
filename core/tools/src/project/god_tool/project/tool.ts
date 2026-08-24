/**
 * project — 项目领域统一入口。
 * project_agent / project_manage 仍是独立上帝工具；本工具按 action 转调它们。
 */

import { Tool, toolDir, createToolResponse } from "../../../base.js";
import type { ToolContext, ToolDefinition, ToolResponse } from "../../../base.js";
import { ProjectAgentTool } from "../../project_agent/tool.js";
import { ProjectManageTool } from "../../project_manage/tool.js";

const AGENT_ACTIONS = new Set(["list", "create", "send"]);
const MANAGE_ACTIONS = new Set(["disband", "members", "message"]);

export class ProjectGodTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);
  readonly definition: ToolDefinition = {
    name: "project",
    aliases: ["god_project"],
    description:
      "项目领域统一入口。list/create/send 转 project_agent；" +
      "disband/members/message 转 project_manage。只派任务也可用 project_send。" +
      "失效项目用 create 重新绑定，不要 repair/rebind。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "list",
            "create",
            "send",
            "disband",
            "members",
            "message",
          ],
        },
      },
      required: ["action"],
      additionalProperties: true,
    },
    allowedModes: ["execute"],
  };

  private readonly agent = new ProjectAgentTool();
  private readonly manage = new ProjectManageTool();

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    const action = String(params.action ?? "").trim().toLowerCase();
    if (AGENT_ACTIONS.has(action)) {
      return this.agent.execute(params, ctx);
    }
    if (MANAGE_ACTIONS.has(action)) {
      return this.manage.execute(params, ctx);
    }
    return createToolResponse(
      false,
      `不支持的 action: ${action}。list/create/send 走项目代理；` +
        `disband/members/message 走项目管理。失效项目用 create 重新绑定。`,
    );
  }
}
