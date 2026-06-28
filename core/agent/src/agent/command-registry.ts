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
}
