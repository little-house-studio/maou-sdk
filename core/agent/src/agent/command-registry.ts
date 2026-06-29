/**
 * 指令注册表 —— 统一注册、匹配、执行所有 /xxx 指令。
 *
 * 指令匹配成功 → 直接执行返回，不走 AI。
 * 支持：
 * - defineCommand() API（代码注册）
 * - 文件即指令（command/ 目录自动发现）
 * - 内置指令（/new /clear /stop /agent /help）
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runAgentCommand } from "./command-runner.js";

// ── 类型 ────────────────────────────────────────────────────────────────

export interface CommandDefinition {
  /** 指令名（不含 /），如 "new"、"help" */
  name: string;
  /** 简短描述（/help 显示用） */
  description: string;
  /** 参数说明（可选，/help 显示用） */
  usage?: string;
  /** 匹配函数：返回 true 表示匹配成功 */
  match?: (input: string) => boolean;
  /** 执行函数：返回回复文本 */
  execute: (ctx: CommandContext) => Promise<CommandResult> | CommandResult;
}

export interface CommandContext {
  /** 原始用户输入（含 /） */
  rawInput: string;
  /** 指令名后的参数部分 */
  args: string;
  /** 当前 session ID */
  sessionId: string;
  /** 当前 agent 名 */
  agentName: string;
  /** maou 根目录 */
  maouRoot: string;
  /** 项目根目录 */
  projectRoot: string;
  /** 额外运行时引用（用于 session 操作等） */
  runtime: CommandRuntimeRef;
}

/** 指令执行结果 */
export interface CommandResult {
  /** 回复给用户的文本 */
  content: string;
  /** 额外事件数据（如 newSession: true） */
  meta?: Record<string, unknown>;
}

export interface CommandRuntimeRef {
  /** 创建新 session */
  createSession: (initAgentName?: string) => { id: string; agentName?: string };
  /** 清空 session 历史 */
  clearSession: (sessionId: string) => void;
  /** 切换 session 的 agent */
  setAgentName: (sessionId: string, agentName: string) => void;
  /** 清理 task 相关状态 */
  clearTaskState: (sessionId: string) => void;
  /** 清理消息队列 */
  clearMessageQueue: (sessionId: string) => void;
  /**
   * 启动监督模式（/goal 指令调用）：
   * 创建监督 Agent session + 绑定到主 session。
   * 返回监督 Agent 的 sessionId，前端据此切换聊天对象。
   */
  startSupervisorMode?: (mainSessionId: string, agentName: string, chatKey?: string) => string;
  /**
   * 结束监督模式（supervisor_task_control end 调用）：
   * 清除绑定，返回主 session ID，前端据此切回主 Agent。
   */
  endSupervisorMode?: (supervisorSessionId: string) => string | undefined;
  /** 中断信号 */
  abortSignal?: AbortSignal;
}

// ── 注册表 ──────────────────────────────────────────────────────────────

export class CommandRegistry {
  private commands = new Map<string, CommandDefinition>();

  /** 注册一个指令 */
  register(def: CommandDefinition): void {
    this.commands.set(def.name, def);
  }

  /** 注销一个指令 */
  unregister(name: string): void {
    this.commands.delete(name);
  }

  /** 获取所有已注册指令 */
  list(): CommandDefinition[] {
    return [...this.commands.values()];
  }

  /** 获取指令定义 */
  get(name: string): CommandDefinition | undefined {
    return this.commands.get(name);
  }

  /**
   * 尝试匹配并执行指令。
   * @returns CommandResult 如果匹配成功，null 如果不匹配（应交给 AI）
   */
  async tryExecute(
    input: string,
    ctx: CommandContext,
  ): Promise<CommandResult | null> {
    const trimmed = input.trim();

    // 必须以 / 开头
    if (!trimmed.startsWith("/")) return null;

    // 提取指令名和参数
    const match = trimmed.match(/^\/([\w-]+)(?:\s+([\s\S]*))?$/);
    if (!match) return null;

    const cmdName = match[1].toLowerCase();
    const args = match[2] ?? "";

    // 1. 尝试注册表中的指令
    const def = this.commands.get(cmdName);
    if (def) {
      // 如果有自定义 match 函数，先检查
      if (def.match && !def.match(trimmed)) return null;
      const cmdCtx: CommandContext = { ...ctx, rawInput: trimmed, args };
      return def.execute(cmdCtx);
    }

    // 2. 尝试 agent command/ 目录下的文件指令
    const agentDir = join(ctx.maouRoot, "agents", ctx.agentName || "main");
    const fileResult = await runAgentCommand(agentDir, cmdName, args, ctx.projectRoot);
    if (fileResult !== null) {
      return { content: fileResult, meta: { command: cmdName } };
    }

    return null;
  }
}

// ── defineCommand API ───────────────────────────────────────────────────

export interface DefineCommandConfig {
  name: string;
  description: string;
  usage?: string;
  match?: (input: string) => boolean;
  execute: (ctx: CommandContext) => Promise<CommandResult> | CommandResult;
}

export function defineCommand(config: DefineCommandConfig): CommandDefinition {
  return {
    name: config.name,
    description: config.description,
    usage: config.usage,
    match: config.match,
    execute: config.execute,
  };
}

// ── 内置指令 ────────────────────────────────────────────────────────────

export function registerBuiltinCommands(registry: CommandRegistry): void {
  // /new：新建会话
  registry.register(defineCommand({
    name: "new",
    description: "新建会话",
    execute: (ctx) => {
      const newSession = ctx.runtime.createSession(ctx.agentName);
      return {
        content: `✅ 已新建会话（agent: ${newSession.agentName || "main"}）。`,
        meta: { sessionId: newSession.id, newSession: true },
      };
    },
  }));

  // /clear：清空当前会话历史
  registry.register(defineCommand({
    name: "clear",
    description: "清空当前会话历史",
    execute: (ctx) => {
      try {
        ctx.runtime.clearSession(ctx.sessionId);
        ctx.runtime.clearTaskState(ctx.sessionId);
        ctx.runtime.clearMessageQueue(ctx.sessionId);
        return { content: "✅ 已清空当前会话的历史记录。" };
      } catch (err) {
        return { content: `清空失败: ${err}` };
      }
    },
  }));

  // /stop：停止当前任务
  registry.register(defineCommand({
    name: "stop",
    description: "停止当前运行的任务",
    execute: (ctx) => {
      if (ctx.runtime.abortSignal?.aborted) {
        return { content: "✅ 已停止当前任务。", meta: { stopped: true } };
      }
      return { content: "当前无运行中的任务可停止。/stop 通常由外部中断信号触发。" };
    },
  }));

  // /agent <name>：切换 agent
  registry.register(defineCommand({
    name: "agent",
    description: "切换当前会话绑定的 agent",
    usage: "/agent <name>",
    match: (input) => /^\/agent\s+\S+/.test(input),
    execute: (ctx) => {
      const agentName = ctx.args.trim();
      if (!agentName) {
        return { content: "用法：/agent <name>" };
      }
      ctx.runtime.setAgentName(ctx.sessionId, agentName);
      return {
        content: `✅ 已切换到 agent「${agentName}」，下一条消息生效。`,
        meta: { agentSwitched: agentName },
      };
    },
  }));

  // /help：显示所有可用指令
  registry.register(defineCommand({
    name: "help",
    description: "显示所有可用指令",
    execute: (ctx) => {
      const cmds = registry.list();
      let text = "📋 可用指令：\n\n";
      for (const cmd of cmds) {
        text += `  /${cmd.name}`;
        if (cmd.usage) text += ` ${cmd.usage}`;
        text += ` — ${cmd.description}\n`;
      }
      text += "\n💡 指令不需要 AI 处理，直接执行。";
      return { content: text };
    },
  }));

  // /goal：启动监督模式 —— fork 监督 Agent 监督主 Agent 完成任务
  registry.register(defineCommand({
    name: "goal",
    usage: "[任务描述]",
    description: "启动监督模式：fork 监督 Agent 跟你确认任务，监督主 Agent 干活到完成",
    execute: (ctx) => {
      const args = ctx.args?.trim() ?? "";
      if (!ctx.runtime.startSupervisorMode) {
        return {
          content: "❌ 监督模式未启用（harness 未注入 startSupervisorMode 函数）。",
        };
      }
      // 创建监督 Agent session（agentName="supervisor"）+ 绑定到主 session
      const supervisorSessionId = ctx.runtime.startSupervisorMode(
        ctx.sessionId,
        "supervisor",
        undefined, // chatKey 由前端注入（飞书层在监听 session 切换事件时回填）
      );
      // 首条消息：如果有 args，作为任务描述传给监督 Agent；否则让监督 Agent 主动询问
      const initialMessage = args
        ? `用户启动了监督模式，任务描述：\n\n${args}\n\n请根据这个描述，向用户提问关键问题，整理出完整的任务计划 MD 大纲（含任务要求、细节、验收标准），让用户确认。`
        : `用户启动了监督模式。请向用户询问任务目标、细节、验收标准等关键问题，整理出完整的任务计划 MD 大纲，让用户确认。`;
      return {
        content: `🎯 监督模式已启动。\n\n聊天对象已切换为监督 Agent。请跟监督 Agent 对话确认任务计划。\n\n${args ? `任务描述：${args}` : "请描述你要完成的任务。"}`,
        meta: {
          sessionId: supervisorSessionId,
          newSession: true,
          supervisorMode: true,
          mainSessionId: ctx.sessionId,
          initialMessage, // 监督 Agent 的首条消息（harness 据此启动监督 Agent run）
        },
      };
    },
  }));
}
