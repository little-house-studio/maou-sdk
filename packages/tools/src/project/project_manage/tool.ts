/**
 * Project Manage 工具 — 项目管理
 * 对应 Python: core/tools/impls/project_manage_tool.py
 *
 * 全局 Agent 管理项目的核心工具。
 * 查看项目列表、新增项目、删除项目、查看项目成员、创建项目 Agent、和项目主 Agent 沟通。
 */

import { Tool } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { createToolResponse } from "../../base.js";

export class ProjectManageTool extends Tool {
  readonly definition: ToolDefinition = {
    name: "project_manage",
    aliases: [],
    description:
      "全局 Agent 管理项目的核心工具。" +
      "查看项目列表、新增项目、删除项目（需用户同意）、" +
      "查看项目成员、创建项目 Agent、和项目主 Agent 沟通。" +
      "这是全局 Agent 和项目 Agent 之间的主要沟通渠道。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "create", "disband", "members", "add-agent", "message"],
          description: "list: 查看项目 | create: 新增项目 | disband: 删除项目 | members: 查看成员 | add-agent: 创建Agent | message: 沟通",
        },
        name: { type: "string", description: "项目名称" },
        project_path: { type: "string", description: "项目路径（可选）" },
        to: { type: "string", description: "目标 Agent 名称（message 用）" },
        content: { type: "string", description: "消息内容" },
        reason: { type: "string", description: "原因说明（disband 用）" },
        agent_name: { type: "string", description: "新 Agent 名称（add-agent 用）" },
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
    allowedModes: ["execute"],
  };

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    // 服务端尚未完整实现项目所需的全部路由（members/add-agent/message 都依赖 /api/agents 相关端点）。
    // 提前返回友好提示，避免模型陷入重试循环。
    // 待 server.ts 补齐端点后，删除这一行即可恢复完整功能。
    return createToolResponse(
      false,
      "project_manage 工具当前暂未开放，服务端正在接入中。如需管理多项目，请在 content 中描述项目结构；如需与项目 Agent 沟通，请稍后重试。",
    );

    const action = String(params.action ?? "").trim().toLowerCase();

    switch (action) {
      case "list":
        return this.doList();
      case "create":
        return this.doCreate(params, ctx);
      case "disband":
        return this.doDisband(params, ctx);
      case "members":
        return this.doMembers(params);
      case "add-agent":
        return this.doAddAgent(params, ctx);
      case "message":
        return this.doMessage(params, ctx);
      default:
        return createToolResponse(false, `不支持的操作: ${action}`);
    }
  }

  private async doList(): Promise<ToolResponse> {
    try {
      const baseUrl = `http://127.0.0.1:${process.env.MAOU_PORT || "8099"}`;
      const resp = await fetch(`${baseUrl}/api/projects`);
      if (!resp.ok) return createToolResponse(false, "获取项目列表失败");

      const body = (await resp.json()) as Record<string, unknown> | Array<Record<string, unknown>>;
      const projects = Array.isArray(body)
        ? body
        : Array.isArray((body as Record<string, unknown>).projects)
          ? ((body as Record<string, unknown>).projects as Array<Record<string, unknown>>)
          : [];

      if (projects.length === 0) return createToolResponse(true, "📁 暂无项目。用 project_manage create 创建第一个。");

      const lines = ["📁 项目列表", "| 名称 | 路径 | 状态 |", "|------|------|------|"];
      for (const p of projects) {
        lines.push(`| ${p.name} | ${p.path ?? "—"} | ${p.status ?? "active"} |`);
      }
      lines.push(`\n共 ${projects.length} 个项目`);
      return createToolResponse(true, lines.join("\n"));
    } catch (err) {
      return createToolResponse(false, `获取项目失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async doCreate(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    const name = String(params.name ?? "").trim();
    if (!name) return createToolResponse(false, "请提供 name（项目名称）。");

    const projectPath = String(params.project_path ?? "").trim();
    const role = String(params.role ?? "项目主 Agent").trim();
    const personality = String(params.personality ?? "").trim();
    const team = String(params.team ?? name).trim();
    const description = String(params.description ?? "").trim();
    const notes = String(params.notes ?? "").trim();
    const preset = String(params.preset ?? "default").trim();
    const permission = String(params.permission ?? "full").trim();

    try {
      const baseUrl = `http://127.0.0.1:${process.env.MAOU_PORT || "8099"}`;
      const resp = await fetch(`${baseUrl}/api/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          path: projectPath || undefined,
          agent: {
            role, personality, team, description, notes, preset, permission,
          },
          created_by: ctx.agentName || "main",
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        return createToolResponse(false, `创建项目失败: ${errText}`);
      }

      return createToolResponse(true, `📁 项目「${name}」已创建。\n主 Agent 职能: ${role}`, { payload: { name, role } });
    } catch (err) {
      return createToolResponse(false, `创建项目失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async doDisband(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResponse> {
    const name = String(params.name ?? "").trim();
    const reason = String(params.reason ?? "").trim();
    if (!name) return createToolResponse(false, "请提供 name（项目名称）。");
    if (!reason) return createToolResponse(false, "请提供 reason（删除原因）。");

    try {
      const baseUrl = `http://127.0.0.1:${process.env.MAOU_PORT || "8099"}`;
      const resp = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(name)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!resp.ok) {
        const errText = await resp.text();
        return createToolResponse(false, `删除项目失败: ${errText}`);
      }
      return createToolResponse(true, `📁 项目「${name}」已删除。原因: ${reason}`);
    } catch (err) {
      return createToolResponse(false, `删除项目失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async doMembers(params: Record<string, unknown>): Promise<ToolResponse> {
    const name = String(params.name ?? "").trim();
    if (!name) return createToolResponse(false, "请提供 name（项目名称）。");

    try {
      const baseUrl = `http://127.0.0.1:${process.env.MAOU_PORT || "8099"}`;
      const resp = await fetch(`${baseUrl}/api/agents`);
      if (!resp.ok) return createToolResponse(false, "获取成员列表失败");

      const body = (await resp.json()) as Record<string, unknown> | Array<Record<string, unknown>>;
      const agents = Array.isArray(body)
        ? body
        : Array.isArray((body as Record<string, unknown>).agents)
          ? ((body as Record<string, unknown>).agents as Array<Record<string, unknown>>)
          : [];

      // 严格限定到该项目：scope 是 project 且 project 字段匹配
      const members = agents.filter((a) => a.scope === "project" && a.project === name);

      if (members.length === 0) return createToolResponse(true, `项目「${name}」暂无成员。`);

      const lines = [`👥 项目「${name}」成员`, "| 名称 | 状态 | 职能 |", "|------|------|------|"];
      for (const m of members) {
        const emoji = { idle: "💤", busy: "🔵", working: "🟢", stopped: "🔴", error: "💥" }[String(m.status ?? "idle")] ?? "❓";
        lines.push(`| ${m.name} | ${emoji} ${m.status} | ${String(m.role ?? "—").slice(0, 40)} |`);
      }
      return createToolResponse(true, lines.join("\n"));
    } catch (err) {
      return createToolResponse(false, `获取成员失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async doAddAgent(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    const name = String(params.name ?? "").trim();
    const agentName = String(params.agent_name ?? "").trim();
    const role = String(params.role ?? "").trim();
    const targetName = agentName || name;
    if (!targetName) return createToolResponse(false, "请提供 agent_name 或 name。");
    if (!role) return createToolResponse(false, "请提供 role（Agent 职能描述）。");

    try {
      const baseUrl = `http://127.0.0.1:${process.env.MAOU_PORT || "8099"}`;
      const resp = await fetch(`${baseUrl}/api/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: targetName,
          display_name: targetName,
          role,
          scope: "project",
          parent: ctx.agentName || "main",
          preset: String(params.preset ?? "default"),
          permission: String(params.permission ?? "full"),
          personality: String(params.personality ?? ""),
          team: String(params.team ?? ""),
          description: String(params.description ?? ""),
          notes: String(params.notes ?? ""),
          created_by: ctx.agentName || "main",
        }),
      });
      if (!resp.ok) return createToolResponse(false, `创建 Agent 失败: ${await resp.text()}`);
      return createToolResponse(true, `🤖 项目 Agent「${targetName}」已创建。职能: ${role}`);
    } catch (err) {
      return createToolResponse(false, `创建 Agent 失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async doMessage(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    const name = String(params.name ?? "").trim();
    const to = String(params.to ?? "main").trim() || "main";
    const content = String(params.content ?? "").trim();
    if (!name) return createToolResponse(false, "请提供 name（项目名称）。");
    if (!content) return createToolResponse(false, "请提供 content（消息内容）。");

    try {
      const baseUrl = `http://127.0.0.1:${process.env.MAOU_PORT || "8099"}`;
      const resp = await fetch(`${baseUrl}/api/agents/${encodeURIComponent(to)}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, mode: "queue", from: ctx.agentName || "main" }),
      });
      if (!resp.ok) return createToolResponse(false, `发送消息失败: ${await resp.text()}`);
      return createToolResponse(true, `📨 消息已发送到项目「${name}」的 Agent「${to}」`);
    } catch (err) {
      return createToolResponse(false, `发送消息失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
