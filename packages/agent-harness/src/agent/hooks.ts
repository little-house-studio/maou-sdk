/**
 * SDK 钩子系统 — 18 种 Hook 事件
 * 对齐 Python: sdk/hooks.py
 *
 * 对齐 Claude Agent SDK / Pi Agent 的 Hook 设计。
 * 所有钩子均支持通配符订阅。
 */

import type { Message, ToolCall, ToolResult } from "../agent_factory/types.js";

/** 钩子处理函数 */
export type HookHandler = (...args: unknown[]) => boolean | void;

// ── 全部 18 种 Hook 事件 ────────────────────────────────────────────────────

/** 所有支持的 Hook 事件类型 */
export const ALL_HOOKS: ReadonlySet<string> = new Set([
  // 工具相关
  "pre_tool_use",        // 工具调用前（可拦截，返回 false 阻止执行）
  "post_tool_use",       // 工具调用后
  "tool_error",          // 工具执行异常
  // Agent 循环
  "agent_start",         // Agent 轮次开始
  "agent_stop",          // Agent 轮次结束
  "agent_thinking",      // Agent 正在思考
  // 消息相关
  "pre_message",         // 消息发送前
  "post_message",        // 消息发送后
  "response_start",      // 流式回复开始
  "response_end",        // 流式回复结束
  // 表情/状态
  "expression_change",   // 表情变化
  // 上下文
  "pre_compact",         // 上下文压缩前
  "post_compact",        // 上下文压缩后
  // 设备
  "device_online",       // 设备上线
  "device_offline",      // 设备离线
  // 会话
  "session_start",       // 会话开始
  "session_end",         // 会话结束
  // 安全
  "abort",               // 用户中断
]);

/** Hook 事件类型联合 */
export type HookName = typeof ALL_HOOKS extends Set<infer T> ? T : never;

/**
 * 钩子管理器 — 支持 18 种事件 + 通配符
 *
 * 用法:
 * ```ts
 * const hooks = new Hooks();
 * hooks.register("pre_tool_use", (toolCall) => {
 *   console.log("工具调用前:", toolCall);
 *   return true; // 返回 false 可拦截
 * });
 * hooks.trigger("pre_tool_use", { toolCall: tc });
 * ```
 */
export class Hooks {
  private _hooks: Map<string, HookHandler[]>;

  constructor() {
    this._hooks = new Map();
    for (const hookName of ALL_HOOKS) {
      this._hooks.set(hookName, []);
    }
  }

  /**
   * 注册钩子
   *
   * @param hookName - 钩子名称（建议在 ALL_HOOKS 中）
   * @param handler - 处理函数。pre_tool_use 的 handler 返回 false 可阻止执行
   */
  register(hookName: string, handler: HookHandler): void {
    let handlers = this._hooks.get(hookName);
    if (!handlers) {
      handlers = [];
      this._hooks.set(hookName, handlers);
      console.warn(`[sdk] 注册未知钩子: ${hookName}`);
    }
    handlers.push(handler);
  }

  /** 取消注册钩子 */
  unregister(hookName: string, handler: HookHandler): void {
    const handlers = this._hooks.get(hookName);
    if (!handlers) return;
    const idx = handlers.indexOf(handler);
    if (idx !== -1) {
      handlers.splice(idx, 1);
    }
  }

  /**
   * 触发钩子
   *
   * @returns true 表示允许继续，false 表示被拦截（仅 pre_tool_use 有意义）
   */
  trigger(hookName: string, kwargs: Record<string, unknown> = {}): boolean {
    let allowed = true;
    const handlers = this._hooks.get(hookName);
    if (!handlers) return allowed;

    for (const handler of handlers) {
      try {
        const result = handler(kwargs);
        if (result === false && hookName === "pre_tool_use") {
          allowed = false;
          console.log(`[sdk] 钩子 '${hookName}' 拦截了工具调用`);
        }
      } catch (e) {
        console.error(`[sdk] 钩子 '${hookName}' 执行异常:`, e);
      }
    }
    return allowed;
  }

  // ── 便捷方法 ──────────────────────────────────────

  /** 工具调用前触发。返回 false 可阻止执行。 */
  preToolUse(toolCall: ToolCall): boolean {
    return this.trigger("pre_tool_use", { toolCall });
  }

  /** 工具调用后触发 */
  postToolUse(toolCall: ToolCall, result: ToolResult): void {
    this.trigger("post_tool_use", { toolCall, result });
  }

  /** 工具执行异常 */
  toolError(toolCall: ToolCall, error: string): void {
    this.trigger("tool_error", { toolCall, error });
  }

  /** Agent 轮次开始 */
  agentStart(roundNumber: number): void {
    this.trigger("agent_start", { roundNumber });
  }

  /** Agent 轮次结束 */
  agentStop(roundNumber: number): void {
    this.trigger("agent_stop", { roundNumber });
  }

  /** Agent 正在思考 */
  agentThinking(): void {
    this.trigger("agent_thinking");
  }

  /** 消息发送前触发 */
  preMessage(message: Message): void {
    this.trigger("pre_message", { message });
  }

  /** 消息发送后触发 */
  postMessage(message: Message, success = true): void {
    this.trigger("post_message", { message, success });
  }

  /** 流式回复开始 */
  responseStart(): void {
    this.trigger("response_start");
  }

  /** 流式回复结束 */
  responseEnd(fullText: string): void {
    this.trigger("response_end", { fullText });
  }

  /** 表情变化 */
  expressionChange(old: string, newExpr: string): void {
    this.trigger("expression_change", { old, new: newExpr });
  }

  /** 上下文压缩前 */
  preCompact(): void {
    this.trigger("pre_compact");
  }

  /** 上下文压缩后 */
  postCompact(compressedCount: number): void {
    this.trigger("post_compact", { compressedCount });
  }

  /** 设备上线 */
  deviceOnline(deviceId: string): void {
    this.trigger("device_online", { deviceId });
  }

  /** 设备离线 */
  deviceOffline(deviceId: string): void {
    this.trigger("device_offline", { deviceId });
  }

  /** 会话开始 */
  sessionStart(sessionId: string): void {
    this.trigger("session_start", { sessionId });
  }

  /** 会话结束 */
  sessionEnd(sessionId: string): void {
    this.trigger("session_end", { sessionId });
  }

  /** 用户中断 */
  abort(reason = ""): void {
    this.trigger("abort", { reason });
  }

  /** 返回所有已注册钩子的名称 */
  get hookNames(): string[] {
    return [...this._hooks.entries()]
      .filter(([, handlers]) => handlers.length > 0)
      .map(([name]) => name);
  }
}
