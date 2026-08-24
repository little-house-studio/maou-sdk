/**
 * skill — 技能领域统一入口。use/search/install/create 转调已有独立工具。
 */

import { Tool, toolDir, createToolResponse } from "../../../base.js";
import type { ToolContext, ToolDefinition, ToolResponse } from "../../../base.js";
import { LoadSkillTool } from "../../use_skill/tool.js";
import { FindSkillTool } from "../../find_skill/tool.js";
import { CreateSkillTool } from "../../create_skill/tool.js";

export class SkillGodTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);
  readonly definition: ToolDefinition = {
    name: "skill",
    aliases: ["god_skill"],
    description:
      "技能领域统一入口。use=加载；search/find=检索 skills.sh；install=安装；create=新建模板。" +
      "也可直接调用 use_skill / search_skill / install_skill / create_skill。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["use", "search", "find", "install", "create"],
          description: "use=加载 | search/find=检索 | install=安装 | create=新建",
        },
        name: { type: "string", description: "skill 名称（use/create）" },
        query: { type: "string", description: "搜索词或安装源（search/install）" },
        skill_description: { type: "string", description: "create 时写入 SKILL.md 的短描述" },
        requirements: { type: "string", description: "create 的详细需求" },
      },
      required: ["action"],
      additionalProperties: true,
    },
    allowedModes: ["plan", "execute"],
  };

  private readonly load = new LoadSkillTool();
  private readonly find = new FindSkillTool();
  private readonly create = new CreateSkillTool();

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    const action = String(params.action ?? "").trim().toLowerCase();
    if (action === "use") {
      return this.load.execute({ ...params, name: params.name ?? params.query }, ctx);
    }
    if (action === "search" || action === "find") {
      return this.find.execute({ ...params, mode: "search", query: params.query ?? params.name }, ctx);
    }
    if (action === "install") {
      return this.find.execute({ ...params, mode: "install", query: params.query ?? params.name }, ctx);
    }
    if (action === "create") {
      return this.create.execute(params, ctx);
    }
    return createToolResponse(false, `不支持的 action: ${action}。支持: use / search / find / install / create`);
  }
}
