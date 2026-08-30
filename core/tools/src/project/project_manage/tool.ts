/**
 * Project Manage 工具 — 项目管理
 *
 * 全局 Agent 管理项目的核心工具。
 * 查看项目列表、新增项目、删除项目、查看项目成员、创建项目 Agent、和项目主 Agent 沟通。
 */

import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getProjectsList, removeProjectByPath } from "@little-house-studio/types";
import { Tool, toolDir } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { createToolResponse } from "../../base.js";
import { ProjectAgentTool } from "../project_agent/tool.js";

export class ProjectManageTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);
  readonly definition: ToolDefinition = {
    name: "project_manage",
    aliases: [],
    description:
      "全局 Agent 管理项目的核心工具。" +
      "查看项目列表、绑定项目、删除项目（需用户同意）、" +
      "查看项目成员、和项目主 Agent 沟通。" +
      "项目里再开角色由该项目 Agent 自己决定，不要在这里加角色。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "create", "disband", "members", "message"],
          description: "list: 查看项目 | create: 绑定项目 | disband: 删除项目 | members: 查看成员 | message: 沟通",
        },
        name: { type: "string", description: "项目名称" },
        project_path: { type: "string", description: "项目路径（可选）" },
        to: { type: "string", description: "目标 Agent 名称（message 用）" },
        content: { type: "string", description: "消息内容" },
        reason: { type: "string", description: "原因说明（disband 用）" },
        agent_name: { type: "string", description: "（已废弃，忽略）" },
        role: { type: "string", description: "Agent 职能描述" },
        preset: { type: "string", enum: ["default", "frontend", "backend", "tester"], description: "职业预设" },
        permission: { type: "string", enum: ["full", "restricted", "observer"], description: "权限预设" },
        personality: { type: "string", description: "性格描述" },
        team: { type: "string", description: "所属团队" },
        description: { type: "string", description: "详细说明" },
        notes: { type: "string", description: "备注" },
      },
      required: ["action"],
      additionalProperties: false,
    },
    allowedModes: ["plan", "execute"],
  };

  private readonly agent = new ProjectAgentTool();

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    const action = String(params.action ?? "").trim().toLowerCase();

    switch (action) {
      case "list":
        return this.agent.execute({ ...params, action: "list" }, ctx);
      case "create":
        return this.agent.execute({
          ...params,
          action: "create",
          path: params.path ?? params.project_path ?? params.project,
          name: params.name,
        }, ctx);
      case "disband":
        return this.doDisband(params, ctx);
      case "members":
        return this.doMembers(params, ctx);
      case "add-agent":
        return createToolResponse(
          false,
          "不要在这里给项目加角色。项目里再开谁，由管理该项目的 Agent 自己决定。",
        );
      case "message":
        return this.agent.execute({
          ...params,
          action: "send",
          project: params.project ?? params.name ?? params.path,
          task: params.task ?? params.content,
        }, ctx);
      default:
        return createToolResponse(false, `不支持的操作: ${action}`);
    }
  }

  private doDisband(params: Record<string, unknown>, ctx: ToolContext): ToolResponse {
    const name = String(params.name ?? params.project ?? "").trim();
    const reason = String(params.reason ?? "").trim();
    if (!name) return createToolResponse(false, "请提供 name 或 project（项目名称或路径）。");
    if (!reason) return createToolResponse(false, "请提供 reason（删除原因）。");
    const project = getProjectsList(ctx.maouRoot).find((item) => item.name === name || item.path === name);
    if (!project) return createToolResponse(false, `未找到项目「${name}」。`);
    if (!removeProjectByPath(project.path, ctx.maouRoot)) {
      return createToolResponse(false, `取消注册失败：${project.path}`);
    }
    return createToolResponse(true, `📁 已从清单移除「${project.name}」。原因: ${reason}\n路径仍保留在磁盘：${project.path}`);
  }

  private doMembers(params: Record<string, unknown>, ctx: ToolContext): ToolResponse {
    const name = String(params.name ?? params.project ?? "").trim();
    if (!name) return createToolResponse(false, "请提供 name 或 project（项目名称或路径）。");
    const project = getProjectsList(ctx.maouRoot).find((item) => item.name === name || item.path === name);
    if (!project) return createToolResponse(false, `未找到项目「${name}」。`);
    const agentsDir = join(project.path, ".maou", "agents");
    if (!existsSync(agentsDir)) {
      return createToolResponse(true, `项目「${project.name}」暂无驻扎 Agent。`, { payload: { members: [] } });
    }
    let names: string[] = [];
    try {
      names = readdirSync(agentsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => entry.name);
    } catch (err) {
      return createToolResponse(false, `读取成员失败: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (names.length === 0) {
      return createToolResponse(true, `项目「${project.name}」暂无驻扎 Agent。`, { payload: { members: [] } });
    }
    const lines = [`👥 项目「${project.name}」成员`, ...names.map((item) => `- ${item}`)];
    return createToolResponse(true, lines.join("\n"), { payload: { members: names, path: project.path } });
  }
}
