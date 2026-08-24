/**
 * agent_send — 向已有队友 / 子 Agent 派活、插话、中断或停止。
 */

import { Tool, toolDir, createToolResponse } from "../../base.js";
import type { ToolContext, ToolDefinition, ToolResponse } from "../../base.js";
import { TeamManageTool } from "../agent_manage/tool.js";

const SEND_MODES = new Set(["message", "interrupt", "insert", "stop"]);

export class AgentSendTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);
  readonly definition: ToolDefinition = {
    name: "agent_send",
    aliases: ["send_agent_message"],
    description:
      "向已有队友或子 Agent 说话：派活（message）、插话（insert）、中断（interrupt）、停止（stop）。" +
      "不创建、不 fork。要开新的子任务用 agent_message。",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "目标 Agent 名称" },
        content: { type: "string", description: "消息内容。stop 可不填。" },
        mode: {
          type: "string",
          enum: ["message", "interrupt", "insert", "stop"],
          description: "message=派活/补一句（默认）；insert=插队；interrupt=打断并带话；stop=停止当前任务",
        },
      },
      required: ["to"],
      additionalProperties: false,
    },
    allowedModes: ["execute"],
  };

  private readonly manage = new TeamManageTool();

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    const mode = String(params.mode ?? "message").trim().toLowerCase();
    if (!SEND_MODES.has(mode)) {
      return createToolResponse(false, `不支持的 mode: ${mode}。支持: message / insert / interrupt / stop`);
    }
    return this.manage.execute({ ...params, action: mode }, ctx);
  }
}
