/**
 * project_send — 只向已注册项目的 Coding Agent 派任务（从 project_agent.send 抽出）。
 */

import { Tool, toolDir } from "../../base.js";
import type { ToolContext, ToolDefinition, ToolResponse } from "../../base.js";
import { ProjectAgentTool } from "../project_agent/tool.js";

export class ProjectSendTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);
  readonly definition: ToolDefinition = {
    name: "project_send",
    aliases: ["send_project_message"],
    description:
      "向已注册项目的 Coding Agent 派发完整任务。不绑定路径。" +
      "失效时按返回提示用 project_agent create 重新挂上。",
    parameters: {
      type: "object",
      properties: {
        project: { type: "string", description: "项目绝对路径或唯一项目名" },
        task: { type: "string", description: "发给项目 Agent 的完整任务说明" },
      },
      required: ["project", "task"],
      additionalProperties: false,
    },
    allowedModes: ["execute"],
  };

  private readonly agent = new ProjectAgentTool();

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    return this.agent.execute({ ...params, action: "send" }, ctx);
  }
}
