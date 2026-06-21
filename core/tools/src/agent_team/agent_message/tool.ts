/**
 * Subagent 工具 — 创建克隆子 Agent
 * 对应 Python: core/tools/impls/subagent_creat_tool.py
 *
 * 创建克隆子 Agent 处理独立任务。继承 ROLE 模板，注册为项目专属 Agent。
 */

import { Tool } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { createToolResponse } from "../../base.js";

const STATUS_EMOJI: Record<string, string> = {
  idle: "💤", busy: "🔵", working: "🟢", stopped: "🔴", error: "💥",
};

export class SubagentTool extends Tool {
  readonly definition: ToolDefinition = {
    name: "agent_message",
    aliases: ["subagent_creat", "subagent-create", "clone-agent"],
    description:
      "创建克隆子 Agent 处理独立任务。根据 task 自动创建，新对象处理别的事情。" +
      "子 Agent 是主 Agent 的轻量克隆：继承 ROLE 模板、注册为项目专属 Agent。" +
      "创建后可读取其正在做的任务，或用 team_manage 发送任务消息。" +
      "适用场景：并行任务拆分、独立搜索/分析/写报告等。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "create", "status", "output", "update-task", "stop"],
          description: "list: 列出子Agent | create: 创建 | status: 读取状态 | output: 读取输出 | update-task: 更新任务 | stop: 停止",
        },
        name: { type: "string", description: "子 Agent 唯一名称（英文+连字符）" },
        task: { type: "string", description: "分配给子 Agent 的任务描述" },
        description: { type: "string", description: "子 Agent 角色说明" },
        limit: { type: "number", description: "output 时返回的最大消息数（默认5）" },
      },
      required: ["action"],
      additionalProperties: false,
    },
    allowedModes: ["execute"],
  };

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    // 服务端尚未完整实现子 Agent 所需的全部路由（create/status/output/update-task/stop 都依赖 /api/agents/{name}）。
    // 提前返回友好提示，避免模型陷入重试循环。
    // 待 server.ts 补齐端点后，删除这一行即可恢复完整功能。
    return createToolResponse(
      false,
      "subagent_create 工具当前暂未开放，服务端正在接入中。如需拆分任务，请在 content 中列出子任务并逐个完成；如需真正的并行 Agent，请稍后重试。",
    );

    const action = String(params.action ?? "").trim().toLowerCase();
    const name = String(params.name ?? "").trim();
    const task = String(params.task ?? "").trim();
    const description = String(params.description ?? "").trim();
    const limit = Number(params.limit ?? 5);

    switch (action) {
      case "list":
        return this.doList(ctx);
      case "create":
        return this.doCreate(name, task, description, ctx);
      case "status":
        return this.doStatus(name, ctx);
      case "output":
        return this.doOutput(name, limit, ctx);
      case "update-task":
        return this.doUpdateTask(name, task, ctx);
      case "stop":
        return this.doStop(name, ctx);
      default:
        return createToolResponse(false, `不支持的操作: ${action}。支持: list/create/status/output/update-task/stop`);
    }
  }

  private async doList(ctx: ToolContext): Promise<ToolResponse> {
    // TypeScript 端通过 API 调用获取 agent 列表
    try {
      const baseUrl = `http://127.0.0.1:${process.env.MAOU_PORT || "8099"}`;
      const resp = await fetch(`${baseUrl}/api/agents`);
      if (!resp.ok) return createToolResponse(false, "获取 Agent 列表失败");

      const agents = (await resp.json()) as Array<Record<string, unknown>>;
      const myName = ctx.agentName || "main";
      const subagents = agents.filter((a) => a.parent === myName && a.name !== myName);

      if (subagents.length === 0) {
        return createToolResponse(true, "🤖 当前没有子 Agent。用 subagent_create create 创建第一个。");
      }

      const lines = ["🤖 子 Agent 列表", "| 名称 | 状态 | 任务 | 更新时间 |", "|------|------|------|----------|"];
      for (const a of subagents) {
        const emoji = STATUS_EMOJI[String(a.status ?? "idle")] ?? "❓";
        const role = String(a.task ?? a.role ?? "—").slice(0, 40);
        lines.push(`| ${a.name} | ${emoji} ${a.status} | ${role} | ${a.updated_at ?? "—"} |`);
      }
      lines.push(`\n共 ${subagents.length} 个子 Agent`);
      return createToolResponse(true, lines.join("\n"), { payload: { subagents, total: subagents.length } });
    } catch (err) {
      return createToolResponse(false, `获取列表失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async doCreate(name: string, task: string, description: string, ctx: ToolContext): Promise<ToolResponse> {
    if (!name) return createToolResponse(false, "请提供 name（子 Agent 名称，英文+连字符）。");
    if (!task) return createToolResponse(false, "请提供 task（分配给子 Agent 的任务描述）。");

    try {
      const baseUrl = `http://127.0.0.1:${process.env.MAOU_PORT || "8099"}`;
      const resp = await fetch(`${baseUrl}/api/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          display_name: name,
          role: task,
          parent: ctx.agentName || "main",
          scope: "project",
          description,
          notes: `子 Agent，由 ${ctx.agentName || "main"} 创建。任务: ${task}`,
          created_by: ctx.agentName || "main",
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        return createToolResponse(false, `创建失败: ${errText}`);
      }

      return createToolResponse(
        true,
        `🤖 子 Agent「${name}」已创建。\n任务: ${task}\n使用 team_manage message 向其下达任务。`,
        { payload: { name, task, parent: ctx.agentName || "main" } },
      );
    } catch (err) {
      return createToolResponse(false, `创建失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async doStatus(name: string, _ctx: ToolContext): Promise<ToolResponse> {
    if (!name) return createToolResponse(false, "请提供 name（子 Agent 名称）。");
    try {
      const baseUrl = `http://127.0.0.1:${process.env.MAOU_PORT || "8099"}`;
      const resp = await fetch(`${baseUrl}/api/agents/${encodeURIComponent(name)}`);
      if (!resp.ok) return createToolResponse(false, `Agent「${name}」不存在或获取失败`);
      const agent = (await resp.json()) as Record<string, unknown>;
      const emoji = STATUS_EMOJI[String(agent.status ?? "idle")] ?? "❓";
      return createToolResponse(true, `${emoji} ${name}: ${agent.status ?? "idle"}\n任务: ${agent.role ?? agent.task ?? "—"}`);
    } catch (err) {
      return createToolResponse(false, `获取状态失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async doOutput(name: string, limit: number, _ctx: ToolContext): Promise<ToolResponse> {
    if (!name) return createToolResponse(false, "请提供 name（子 Agent 名称）。");
    try {
      const baseUrl = `http://127.0.0.1:${process.env.MAOU_PORT || "8099"}`;
      const resp = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(name)}/messages?limit=${limit}`);
      if (!resp.ok) return createToolResponse(false, `获取「${name}」输出失败`);
      const messages = await resp.text();
      return createToolResponse(true, messages.slice(0, 4000));
    } catch (err) {
      return createToolResponse(false, `获取输出失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async doUpdateTask(name: string, task: string, _ctx: ToolContext): Promise<ToolResponse> {
    if (!name) return createToolResponse(false, "请提供 name。");
    if (!task) return createToolResponse(false, "请提供 task（新任务描述）。");
    try {
      const baseUrl = `http://127.0.0.1:${process.env.MAOU_PORT || "8099"}`;
      const resp = await fetch(`${baseUrl}/api/agents/${encodeURIComponent(name)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: task }),
      });
      if (!resp.ok) return createToolResponse(false, `更新失败`);
      return createToolResponse(true, `🤖「${name}」任务已更新为: ${task}`);
    } catch (err) {
      return createToolResponse(false, `更新失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async doStop(name: string, _ctx: ToolContext): Promise<ToolResponse> {
    if (!name) return createToolResponse(false, "请提供 name。");
    try {
      const baseUrl = `http://127.0.0.1:${process.env.MAOU_PORT || "8099"}`;
      const resp = await fetch(`${baseUrl}/api/agents/${encodeURIComponent(name)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "stopped" }),
      });
      if (!resp.ok) return createToolResponse(false, `停止失败`);
      return createToolResponse(true, `🤖「${name}」已停止。`);
    } catch (err) {
      return createToolResponse(false, `停止失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
