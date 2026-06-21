/**
 * Team Manage 工具 — 团队管理
 * 对应 Python: core/tools/impls/team_manage_tool.py
 *
 * 查看团队状态、创建队友、发送消息、停止任务、清除队友。
 * 主 Agent 用 scope=system 创建系统全局队友，Coding Agent 用 scope=project。
 */

import { Tool } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { createToolResponse } from "../../base.js";

const STATUS_EMOJI: Record<string, string> = {
  idle: "💤", busy: "🔵", working: "🟢", stopped: "🔴", error: "💥",
};

const STATUS_LABEL: Record<string, string> = {
  idle: "空闲", busy: "忙碌中", working: "执行中", stopped: "已停止", error: "异常",
};

export class TeamManageTool extends Tool {
  readonly definition: ToolDefinition = {
    name: "agent_manage",
    aliases: [],
    description:
      "团队管理工具。查看团队状态、创建队友、发送消息、停止任务、清除队友。" +
      "主 Agent 用 scope=system 创建系统全局队友，" +
      "Coding Agent 用 scope=project 创建项目专属队友。" +
      "清除队友仅主 Agent 可执行，需要队友同意。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "create", "stop", "message", "interrupt", "insert", "remove"],
          description: "list: 查看团队 | create: 创建队友 | stop: 停止任务 | message: 发送消息 | interrupt: 中断+发消息 | insert: 插入消息 | remove: 清除队友",
        },
        to: { type: "string", description: "目标 Agent 名称" },
        content: { type: "string", description: "消息内容" },
        reason: { type: "string", description: "清除原因" },
        name: { type: "string", description: "新 Agent 名称" },
        role: { type: "string", description: "新 Agent 职能描述" },
        description: { type: "string", description: "新 Agent 详细说明" },
        notes: { type: "string", description: "新 Agent 备注" },
        team: { type: "string", description: "所属团队" },
        personality: { type: "string", description: "性格描述" },
        scope: { type: "string", enum: ["system", "project"], description: "作用域（默认 project）" },
        preset: { type: "string", enum: ["default", "frontend", "backend", "tester"], description: "职业预设" },
        permission: { type: "string", enum: ["full", "restricted", "observer"], description: "权限预设" },
      },
      required: ["action"],
      additionalProperties: false,
    },
    allowedModes: ["execute"],
  };

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    // 服务端尚未实现 /api/agents/* 路由，调用必定失败。
    // 提前返回友好提示，避免模型陷入重试循环。
    // 待 server.ts 补齐端点后，删除这一行即可恢复完整功能。
    return createToolResponse(
      false,
      "team_manage 工具当前暂未开放，服务端正在接入中。如需拆分任务给多个角色，请在 content 中以文字形式模拟分工，或使用 subagent_create 创建子 Agent。",
    );

    const action = String(params.action ?? "").trim().toLowerCase();

    switch (action) {
      case "list":
        return this.doList(ctx);
      case "create":
        return this.doCreate(params, ctx);
      case "stop":
        return this.doStop(params, ctx);
      case "message":
      case "interrupt":
      case "insert":
        return this.doMessage(params, ctx, action);
      case "remove":
        return this.doRemove(params, ctx);
      default:
        return createToolResponse(false, `不支持的操作: ${action}。支持: list/create/stop/message/interrupt/insert/remove`);
    }
  }

  private async doList(ctx: ToolContext): Promise<ToolResponse> {
    try {
      const baseUrl = `http://127.0.0.1:${process.env.MAOU_PORT || "8099"}`;
      const resp = await fetch(`${baseUrl}/api/agents`);
      if (!resp.ok) return createToolResponse(false, "获取团队列表失败");

      const agents = (await resp.json()) as Array<Record<string, unknown>>;
      const myName = ctx.agentName || "main";
      const myAgent = agents.find((a) => a.name === myName);
      const myScope = (myAgent?.scope as string) ?? "project";
      const filtered = agents.filter((a) => (a.scope ?? "project") === myScope);

      if (filtered.length === 0) {
        const scopeLabel = myScope === "system" ? "系统全局" : "当前项目";
        return createToolResponse(true, `👥 ${scopeLabel}团队为空。没有队友。`);
      }

      const lines = ["👥 团队状态", "═══════════"];
      for (const a of filtered) {
        const name = String(a.name ?? "?");
        const isMe = name === myName;
        const status = String(a.status ?? "idle");
        const emoji = STATUS_EMOJI[status] ?? "❓";
        const label = STATUS_LABEL[status] ?? status;
        const roleDesc = String(a.role ?? a.description ?? "");
        const notes = String(a.notes ?? "");
        const prefix = isMe ? "👉 " : "   ";
        lines.push(`${prefix}${emoji} ${name} — ${label}`);
        if (roleDesc) lines.push(`     职能: ${roleDesc.slice(0, 60)}`);
        if (notes) lines.push(`     备注: ${notes.slice(0, 60)}`);
      }
      lines.push(`\n共 ${filtered.length} 名成员`);
      return createToolResponse(true, lines.join("\n"));
    } catch (err) {
      return createToolResponse(false, `获取团队失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async doCreate(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    const name = String(params.name ?? "").trim();
    const role = String(params.role ?? "").trim();
    if (!name) return createToolResponse(false, "请提供 name（新 Agent 名称）。");
    if (!role) return createToolResponse(false, "请提供 role（职能描述）。");

    const scope = String(params.scope ?? "project").trim();
    const personality = String(params.personality ?? "").trim();
    const team = String(params.team ?? "").trim();
    const description = String(params.description ?? "").trim();
    const notes = String(params.notes ?? "").trim();
    const preset = String(params.preset ?? "default").trim();
    const permission = String(params.permission ?? "full").trim();

    try {
      const baseUrl = `http://127.0.0.1:${process.env.MAOU_PORT || "8099"}`;
      const resp = await fetch(`${baseUrl}/api/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          display_name: name,
          role,
          parent: ctx.agentName || "main",
          scope,
          description,
          personality,
          team,
          notes,
          preset,
          permission,
          created_by: ctx.agentName || "main",
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        return createToolResponse(false, `创建失败: ${errText}`);
      }

      const scopeLabel = scope === "system" ? "系统全局" : "项目专属";
      return createToolResponse(
        true,
        `👥 队友「${name}」已创建（${scopeLabel}）\n职能: ${role}\n权限: ${permission}`,
        { payload: { name, role, scope } },
      );
    } catch (err) {
      return createToolResponse(false, `创建失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async doStop(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResponse> {
    const to = String(params.to ?? "").trim();
    if (!to) return createToolResponse(false, "请提供 to（目标 Agent 名称）。");

    try {
      const baseUrl = `http://127.0.0.1:${process.env.MAOU_PORT || "8099"}`;
      const resp = await fetch(`${baseUrl}/api/agents/${encodeURIComponent(to)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "stopped" }),
      });
      if (!resp.ok) return createToolResponse(false, `停止「${to}」失败`);
      return createToolResponse(true, `⏹ 已停止「${to}」的当前任务。`);
    } catch (err) {
      return createToolResponse(false, `停止失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async doMessage(params: Record<string, unknown>, _ctx: ToolContext, mode: string): Promise<ToolResponse> {
    const to = String(params.to ?? "").trim();
    const content = String(params.content ?? "").trim();
    if (!to) return createToolResponse(false, "请提供 to（目标 Agent 名称）。");
    if (!content) return createToolResponse(false, "请提供 content（消息内容）。");

    try {
      const baseUrl = `http://127.0.0.1:${process.env.MAOU_PORT || "8099"}`;
      const resp = await fetch(`${baseUrl}/api/agents/${encodeURIComponent(to)}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, mode }),
      });
      if (!resp.ok) {
        const errText = await resp.text();
        return createToolResponse(false, `发送失败: ${errText}`);
      }
      const modeLabel = mode === "queue" ? "队列消息" : mode === "interrupt" ? "中断消息" : "插入消息";
      return createToolResponse(true, `📨 ${modeLabel}已发送到「${to}」`);
    } catch (err) {
      return createToolResponse(false, `发送失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async doRemove(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResponse> {
    const to = String(params.to ?? "").trim();
    const reason = String(params.reason ?? "").trim();
    if (!to) return createToolResponse(false, "请提供 to（目标 Agent 名称）。");
    if (!reason) return createToolResponse(false, "请提供 reason（清除原因）。");

    try {
      const baseUrl = `http://127.0.0.1:${process.env.MAOU_PORT || "8099"}`;
      const resp = await fetch(`${baseUrl}/api/agents/${encodeURIComponent(to)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ removal_request: { reason, requested_by: _ctx.agentName || "main" } }),
      });
      if (!resp.ok) return createToolResponse(false, `申请清除「${to}」失败`);
      return createToolResponse(true, `🗑️ 已向「${to}」发送清除申请。原因: ${reason}`);
    } catch (err) {
      return createToolResponse(false, `清除失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
