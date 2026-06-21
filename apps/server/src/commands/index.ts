/**
 * commands — 指令层
 *
 * 提供 CommandRunner 接口，cli、web、feishu 等均可调用。
 */

import type { AgentRegistry } from '@little-house-studio/agent-harness'
import type { SessionStore } from '@little-house-studio/context'
import type { ToolRegistry } from '@little-house-studio/tools'

// ─── 类型 ───────────────────────────────────────────────────────────────────

export interface CommandContext {
  agentRegistry: AgentRegistry
  sessionStore: SessionStore
  toolRegistry: ToolRegistry
}

export interface CommandResult {
  ok: boolean
  message: string
  data?: unknown
}

export interface CommandInfo {
  name: string
  description: string
  usage: string
}

export interface CommandHandler {
  (args: string[], ctx: CommandContext): Promise<CommandResult>
}

// ─── CommandRunner ──────────────────────────────────────────────────────────

export class CommandRunner {
  private handlers = new Map<string, CommandHandler>()
  private infos: CommandInfo[] = []

  /** 注册指令 */
  register(name: string, info: CommandInfo, handler: CommandHandler): void {
    this.handlers.set(name, handler)
    this.infos.push(info)
  }

  /** 执行指令字符串 */
  async execute(input: string, ctx: CommandContext): Promise<CommandResult> {
    const parts = input.trim().split(/\s+/)
    if (parts.length === 0) {
      return { ok: false, message: '空指令' }
    }
    const name = parts[0]
    const args = parts.slice(1)
    const handler = this.handlers.get(name)
    if (!handler) {
      return { ok: false, message: `未知指令: ${name}。可用: ${this.list().map(i => i.name).join(', ')}` }
    }
    try {
      return await handler(args, ctx)
    } catch (err) {
      return { ok: false, message: `指令执行错误: ${String(err)}` }
    }
  }

  /** 列出所有可用指令 */
  list(): CommandInfo[] {
    return [...this.infos]
  }
}

// ─── 单例 ───────────────────────────────────────────────────────────────────

let _runner: CommandRunner | null = null

/** 获取全局 CommandRunner（自动注册内置指令） */
export function getCommandRunner(): CommandRunner {
  if (!_runner) {
    _runner = new CommandRunner()
    // 后续可在此注册内置指令
  }
  return _runner
}