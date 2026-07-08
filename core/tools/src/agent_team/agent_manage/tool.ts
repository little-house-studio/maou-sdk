/**
 * Team Manage 工具 — 进程内团队管理。
 * 查看团队状态、创建队友、发送消息、停止任务、清除队友。
 * 使用 AgentTeamManager 进程内单例（不依赖 HTTP）。
 */

import { Tool, toolDir } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { createToolResponse } from "../../base.js";
import { AgentTeamManager } from "../team-manager.js";

const STATUS_EMOJI: Record<string, string> = {
  idle: "💤", busy: "🔵", working: "🟢", stopped: "🔴", error: "💥",
};

const STATUS_LABEL: Record<string, string> = {
  idle: "空闲", busy: "忙碌中", working: "执行中", stopped: "已停止", error: "异常",
};

export class TeamManageTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);
  readonly definition: ToolDefinition = {
    name: "agent_manage",
    aliases: [],
    description:
      "团队管理工具。查看团队状态、创建队友、派发任务、发送消息、停止任务、清除队友。" +
      "主 Agent 用 scope=system 创建系统全局队友，Coding Agent 用 scope=project 创建项目专属队友。" +
      "message/interrupt/insert 通过 MessageBus 投递（带 from 说话人），主 Agent 循环可收取。" +
      "dispatch 让队友真后台执行任务（复用 SubagentExecutor detached fork）。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "create", "dispatch", "stop", "message", "interrupt", "insert", "remove"],
          description: "list: 查看团队 | create: 创建队友 | dispatch: 派任务让队友后台执行 | stop: 停止任务 | message: 发送消息 | interrupt: 中断+发消息 | insert: 插入消息 | remove: 清除队友",
        },
        to: { type: "string", description: "目标 Agent 名称" },
        content: { type: "string", description: "消息内容" },
        task: { type: "string", description: "dispatch 时派给队友的任务描述" },
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
    const action = String(params.action ?? "").trim().toLowerCase();

    switch (action) {
      case "list":
        return this.doList(ctx);
      case "create":
        return this.doCreate(params, ctx);
      case "dispatch":
        return this.doDispatch(params, ctx);
      case "stop":
        return this.doStop(params);
      case "message":
      case "interrupt":
      case "insert":
        return this.doMessage(params, ctx, action);
      case "remove":
        return this.doRemove(params);
      default:
        return createToolResponse(false, `不支持的操作: ${action}。支持: list/create/dispatch/stop/message/interrupt/insert/remove`);
    }
  }

  private doList(ctx: ToolContext): ToolResponse {
    const myName = ctx.agentName || "main";
    const all = AgentTeamManager.list();
    // 确保自己在列表里
    if (!all.find(a => a.name === myName)) {
      AgentTeamManager.create({
        name: myName, role: "主 Agent", parent: "", scope: "project", createdBy: myName,
      });
    }
    const members = AgentTeamManager.list();
    if (members.length === 0) {
      return createToolResponse(true, "👥 团队为空。使用 action=create 创建队友。");
    }

    const lines = ["👥 团队状态", "═══════════"];
    for (const m of members) {
      const isMe = m.name === myName;
      const emoji = STATUS_EMOJI[m.status] ?? "❓";
      const label = STATUS_LABEL[m.status] ?? m.status;
      const prefix = isMe ? "👉 " : "   ";
      lines.push(`${prefix}${emoji} ${m.name} — ${label}`);
      if (m.role) lines.push(`     职能: ${m.role.slice(0, 60)}`);
      if (m.notes) lines.push(`     备注: ${m.notes.slice(0, 60)}`);
      if (m.messages.length > 0) lines.push(`     消息: ${m.messages.length} 条未读`);
    }
    lines.push(`\n共 ${members.length} 名成员`);
    return createToolResponse(true, lines.join("\n"));
  }

  private doCreate(params: Record<string, unknown>, ctx: ToolContext): ToolResponse {
    const name = String(params.name ?? "").trim();
    const role = String(params.role ?? "").trim();
    if (!name) return createToolResponse(false, "请提供 name（新 Agent 名称）。");
    if (!role) return createToolResponse(false, "请提供 role（职能描述）。");

    if (AgentTeamManager.get(name)) {
      return createToolResponse(false, `队友「${name}」已存在。`);
    }

    const scope = (String(params.scope ?? "project").trim() as "system" | "project");
    const member = AgentTeamManager.create({
      name,
      displayName: name,
      role,
      parent: ctx.agentName || "main",
      scope,
      description: String(params.description ?? "").trim() || undefined,
      personality: String(params.personality ?? "").trim() || undefined,
      team: String(params.team ?? "").trim() || undefined,
      notes: String(params.notes ?? "").trim() || undefined,
      preset: String(params.preset ?? "default").trim() || undefined,
      permission: String(params.permission ?? "full").trim() || undefined,
      createdBy: ctx.agentName || "main",
    });

    const scopeLabel = scope === "system" ? "系统全局" : "项目专属";
    return createToolResponse(
      true,
      `👥 队友「${name}」已创建（${scopeLabel}）\n职能: ${role}\n权限: ${member.permission ?? "full"}`,
      { payload: { name, role, scope } },
    );
  }

  private doStop(params: Record<string, unknown>): ToolResponse {
    const to = String(params.to ?? "").trim();
    if (!to) return createToolResponse(false, "请提供 to（目标 Agent 名称）。");
    if (!AgentTeamManager.stop(to)) {
      return createToolResponse(false, `未找到队友「${to}」。`);
    }
    return createToolResponse(true, `⏹ 已停止「${to}」的当前任务。`);
  }

  private doMessage(params: Record<string, unknown>, ctx: ToolContext, mode: string): ToolResponse {
    const to = String(params.to ?? "").trim();
    const content = String(params.content ?? "").trim();
    if (!to) return createToolResponse(false, "请提供 to（目标 Agent 名称）。");
    if (!content) return createToolResponse(false, "请提供 content（消息内容）。");

    const from = ctx.agentName || "main";
    // 优先走 MessageBus（带 from 说话人，主 Agent 循环可 poll 收取）
    if (ctx.messageBus) {
      ctx.messageBus.register(to); // 允许向尚未注册的队友预投递
      const receipt = ctx.messageBus.send(to, content, from);
      if (receipt.outcome === "failed") {
        return createToolResponse(false, `消息投递失败: ${receipt.error ?? "未知"}`);
      }
      // 同步更新 TeamMember 状态记录（供 list 展示未读数）—— 不作为投递通道
      AgentTeamManager.sendMessage(to, from, content, mode as "message" | "interrupt" | "insert");
      const modeLabel = mode === "interrupt" ? "中断消息" : mode === "insert" ? "插入消息" : "队列消息";
      const reachLabel = receipt.outcome === "delivered" ? "已直接交付" : "已入 mailbox";
      return createToolResponse(true, `📨 ${modeLabel}已发送到「${to}」(${reachLabel})`);
    }

    // 回退：未注入 MessageBus 时走原 TeamManager 内存队列
    if (!AgentTeamManager.sendMessage(to, from, content, mode as "message" | "interrupt" | "insert")) {
      return createToolResponse(false, `未找到队友「${to}」。(MessageBus 未注入，回退 TeamManager 失败)`);
    }
    const modeLabel = mode === "interrupt" ? "中断消息" : mode === "insert" ? "插入消息" : "队列消息";
    return createToolResponse(true, `📨 ${modeLabel}已发送到「${to}」(内存队列，无消费端)`);
  }

  /**
   * dispatch：派任务让队友真后台执行（复用 SubagentExecutor 的 detached fork）。
   * 不重写执行逻辑——fork + detached 已实现，这里只做参数映射（DRY）。
   */
  private async doDispatch(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    const to = String(params.to ?? "").trim();
    const task = String(params.task ?? params.content ?? "").trim();
    if (!to) return createToolResponse(false, "请提供 to（目标队友名称）。");
    if (!task) return createToolResponse(false, "请提供 task（派给队友的任务描述）。");
    if (!ctx.subagentExecutor) {
      return createToolResponse(
        false,
        "子 Agent 执行器未注入。harness 需通过 runtime.setSubagentExecutor() 注入，" +
          "dispatch 才能让队友真后台执行。",
      );
    }
    const member = AgentTeamManager.get(to);
    if (!member) {
      return createToolResponse(false, `未找到队友「${to}」。请先 action=create 创建。`);
    }
    // 标记队友忙碌
    member.status = "working";

    try {
      // 复用 detached fork：队友用其 agent 配置后台跑，结果异步到达（lifecycle 事件 + mailbox）
      const result = await ctx.subagentExecutor.fork(to, task, {
        forkMode: "context_and_config",
        agentName: to,
        detached: true,
      });
      return createToolResponse(
        result.ok,
        `🚀 已派任务给「${to}」后台执行（detached fork）\ntaskId: ${result.taskId}\n` +
          `结果异步到达，可用 action=list 查状态、或通过 MessageBus 收队友汇报。`,
        { payload: { to, taskId: result.taskId } },
      );
    } catch (err) {
      member.status = "error";
      return createToolResponse(false, `派任务失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private doRemove(params: Record<string, unknown>): ToolResponse {
    const to = String(params.to ?? "").trim();
    const reason = String(params.reason ?? "").trim();
    if (!to) return createToolResponse(false, "请提供 to（目标 Agent 名称）。");
    if (!reason) return createToolResponse(false, "请提供 reason（清除原因）。");

    if (!AgentTeamManager.remove(to)) {
      return createToolResponse(false, `未找到队友「${to}」。`);
    }
    return createToolResponse(true, `🗑️ 已清除队友「${to}」。原因: ${reason}`);
  }
}
