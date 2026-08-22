/**
 * SDK 钩子系统 — 对齐 Pi：async、可拦截、可改写结果、可取消压缩。
 *
 * 旧用法仍可用：pre_tool_use 返回 false / 原因字符串。
 * 新用法：返回 `{ block, reason }` / `{ cancel }` / 改写后的 tool result；
 * handler 可为 async，kwargs.ui 可弹确认（无 UI 时 confirm 默认拒绝）。
 */

import type { Message, ToolCall, ToolResult } from "../agent_factory/types.js";

/** 与 tools/compat/tool-names 对齐；hooks 不依赖 tools 构建产物 */
const MAOU_TO_PI: Record<string, string> = {
  reader: "read",
  write_file: "write",
  edit_file: "edit",
  use_terminal: "bash",
  glob: "find",
  grep: "grep",
};

function toPiToolName(name: string): string {
  return MAOU_TO_PI[name] ?? MAOU_TO_PI[name.toLowerCase()] ?? name;
}

export interface HookUi {
  confirm(title: string, message: string, opts?: { timeout?: number }): Promise<boolean>;
  notify(message: string, level?: "info" | "warning" | "error"): void;
  select?(title: string, options: string[]): Promise<string | undefined>;
  input?(title: string, placeholder?: string): Promise<string | undefined>;
}

/** 无 TUI 时 fail-closed：危险确认默认否 */
export const FAIL_CLOSED_HOOK_UI: HookUi = {
  async confirm() {
    return false;
  },
  notify() {},
};

export interface HookDecision {
  block?: boolean;
  reason?: string;
  cancel?: boolean;
  content?: unknown;
  details?: unknown;
  isError?: boolean;
  compaction?: {
    summary: string;
    firstKeptEntryId?: string;
    tokensBefore?: number;
  };
  systemPrompt?: string;
  message?: unknown;
}

export type HookHandlerResult = boolean | string | void | HookDecision;

export type HookHandler = (
  kwargs: Record<string, unknown>,
) => HookHandlerResult | Promise<HookHandlerResult>;

export interface HookTriggerResult {
  allowed: boolean;
  cancel: boolean;
  blockReason?: string;
  content?: unknown;
  details?: unknown;
  isError?: boolean;
  compaction?: HookDecision["compaction"];
  systemPrompt?: string;
  message?: unknown;
}

export const ALL_HOOKS: ReadonlySet<string> = new Set([
  "pre_tool_use",
  "post_tool_use",
  "tool_error",
  "tool_call",
  "tool_result",
  "agent_start",
  "agent_stop",
  "agent_thinking",
  "before_agent_start",
  "pre_message",
  "post_message",
  "response_start",
  "response_end",
  "expression_change",
  "pre_compact",
  "post_compact",
  "session_before_compact",
  "session_compact",
  "pre_cache_rebuild",
  "cache_rebuild_point",
  "post_cache_rebuild",
  "device_online",
  "device_offline",
  "session_start",
  "session_end",
  "abort",
]);

export type HookName = typeof ALL_HOOKS extends Set<infer T> ? T : never;

const EMPTY: HookTriggerResult = { allowed: true, cancel: false };

function applyDecision(
  hookName: string,
  result: HookHandlerResult,
  acc: HookTriggerResult,
): HookTriggerResult {
  if (result === undefined || result === true || result === null) return acc;
  if (result === false) {
    return { ...acc, allowed: false };
  }
  if (typeof result === "string" && result.trim()) {
    return { ...acc, allowed: false, blockReason: result.trim() };
  }
  if (typeof result !== "object") return acc;
  const d = result as HookDecision;
  const next = { ...acc };
  if (d.block) next.allowed = false;
  if (typeof d.reason === "string" && d.reason.trim()) {
    next.blockReason = d.reason.trim();
    if (d.block !== false) next.allowed = false;
  }
  if (d.cancel) next.cancel = true;
  if (d.content !== undefined) next.content = d.content;
  if (d.details !== undefined) next.details = d.details;
  if (d.isError !== undefined) next.isError = d.isError;
  if (d.compaction) next.compaction = d.compaction;
  if (d.systemPrompt !== undefined) next.systemPrompt = d.systemPrompt;
  if (d.message !== undefined) next.message = d.message;
  return next;
}

export class Hooks {
  private _hooks: Map<string, HookHandler[]>;
  lastBlockReason?: string;
  lastToolResultOverride?: { content: unknown; details?: unknown; isError?: boolean };
  lastCompactDecision?: HookTriggerResult;
  lastCacheRebuildDecision?: HookTriggerResult;
  ui?: HookUi;

  constructor() {
    this._hooks = new Map();
    for (const hookName of ALL_HOOKS) {
      this._hooks.set(hookName, []);
    }
  }

  /** 对齐 Pi `pi.on` */
  on(hookName: string, handler: HookHandler): () => void {
    return this.register(hookName, handler);
  }

  register(hookName: string, handler: HookHandler): () => void {
    let handlers = this._hooks.get(hookName);
    if (!handlers) {
      handlers = [];
      this._hooks.set(hookName, handlers);
      console.warn(`[sdk] 注册未知钩子: ${hookName}`);
    }
    handlers.push(handler);
    return () => this.unregister(hookName, handler);
  }

  unregister(hookName: string, handler: HookHandler): void {
    const handlers = this._hooks.get(hookName);
    if (!handlers) return;
    const idx = handlers.indexOf(handler);
    if (idx !== -1) handlers.splice(idx, 1);
  }

  async trigger(
    hookName: string,
    kwargs: Record<string, unknown> = {},
  ): Promise<HookTriggerResult> {
    let acc: HookTriggerResult = { ...EMPTY };
    if (
      hookName === "pre_tool_use" ||
      hookName === "tool_call" ||
      hookName === "session_before_compact" ||
      hookName === "pre_compact" ||
      hookName === "pre_cache_rebuild"
    ) {
      this.lastBlockReason = undefined;
    }
    const handlers = this._hooks.get(hookName);
    if (!handlers || handlers.length === 0) return acc;

    const payload = { ...kwargs, ui: kwargs.ui ?? this.ui ?? FAIL_CLOSED_HOOK_UI };

    for (const handler of handlers) {
      try {
        const result = await handler(payload);
        acc = applyDecision(hookName, result, acc);
        if (!acc.allowed && acc.blockReason) {
          this.lastBlockReason = acc.blockReason;
          console.log(
            `[sdk] 钩子 '${hookName}' 拦截: ${this.lastBlockReason.slice(0, 80)}`,
          );
        } else if (!acc.allowed) {
          console.log(`[sdk] 钩子 '${hookName}' 拦截了操作`);
        }
      } catch (e) {
        console.error(`[sdk] 钩子 '${hookName}' 执行异常:`, e);
      }
    }
    return acc;
  }

  async preToolUse(toolCall: ToolCall): Promise<boolean> {
    const input = (toolCall as { parameters?: unknown }).parameters ?? {};
    const nativeName = toolCall.name;
    const toolName = toPiToolName(nativeName);
    const r1 = await this.trigger("pre_tool_use", { toolCall, toolName: nativeName, input });
    const r2 = await this.trigger("tool_call", {
      toolCall,
      toolName,
      nativeName,
      input,
    });
    const allowed = r1.allowed && r2.allowed;
    this.lastBlockReason = r2.blockReason ?? r1.blockReason ?? this.lastBlockReason;
    return allowed;
  }

  async postToolUse(toolCall: ToolCall, result: ToolResult): Promise<HookTriggerResult> {
    await this.trigger("post_tool_use", { toolCall, result });
    const r = await this.trigger("tool_result", {
      toolCall,
      result,
      toolName: toPiToolName(toolCall.name),
      nativeName: toolCall.name,
    });
    if (r.content !== undefined) {
      this.lastToolResultOverride = {
        content: r.content,
        details: r.details,
        isError: r.isError,
      };
    } else {
      this.lastToolResultOverride = undefined;
    }
    return r;
  }

  async toolError(toolCall: ToolCall, error: string): Promise<void> {
    await this.trigger("tool_error", { toolCall, error });
  }

  async agentStart(roundNumber: number): Promise<void> {
    await this.trigger("agent_start", { roundNumber });
  }

  async agentStop(roundNumber: number): Promise<void> {
    await this.trigger("agent_stop", { roundNumber });
  }

  async agentThinking(): Promise<void> {
    await this.trigger("agent_thinking");
  }

  async preMessage(message: Message): Promise<void> {
    await this.trigger("pre_message", { message });
  }

  async postMessage(message: Message, success = true): Promise<void> {
    await this.trigger("post_message", { message, success });
  }

  async responseStart(): Promise<void> {
    await this.trigger("response_start");
  }

  async responseEnd(fullText: string): Promise<void> {
    await this.trigger("response_end", { fullText });
  }

  async expressionChange(old: string, newExpr: string): Promise<void> {
    await this.trigger("expression_change", { old, new: newExpr });
  }

  async preCompact(payload: Record<string, unknown> = {}): Promise<HookTriggerResult> {
    const a = await this.trigger("pre_compact", payload);
    const b = await this.trigger("session_before_compact", payload);
    const merged: HookTriggerResult = {
      allowed: a.allowed && b.allowed,
      cancel: a.cancel || b.cancel,
      blockReason: b.blockReason ?? a.blockReason,
      compaction: b.compaction ?? a.compaction,
    };
    this.lastCompactDecision = merged;
    return merged;
  }

  async postCompact(compressedCount: number): Promise<void> {
    await this.trigger("post_compact", { compressedCount });
    await this.trigger("session_compact", { compressedCount });
  }

  /** 缓存重建点前；返回 `{ cancel: true }` 跳过本次重建（不撤销已发生的压缩 / 新建会话） */
  async preCacheRebuild(payload: Record<string, unknown> = {}): Promise<HookTriggerResult> {
    const r = await this.trigger("pre_cache_rebuild", payload);
    this.lastCacheRebuildDecision = r;
    return r;
  }

  /** 缓存重建点本身（前缀将重新 cache write） */
  async cacheRebuildPoint(payload: Record<string, unknown> = {}): Promise<HookTriggerResult> {
    return this.trigger("cache_rebuild_point", payload);
  }

  async postCacheRebuild(payload: Record<string, unknown> = {}): Promise<void> {
    await this.trigger("post_cache_rebuild", payload);
  }

  async deviceOnline(deviceId: string): Promise<void> {
    await this.trigger("device_online", { deviceId });
  }

  async deviceOffline(deviceId: string): Promise<void> {
    await this.trigger("device_offline", { deviceId });
  }

  async sessionStart(sessionId: string): Promise<void> {
    await this.trigger("session_start", { sessionId });
  }

  async sessionEnd(sessionId: string): Promise<void> {
    await this.trigger("session_end", { sessionId });
  }

  async abort(reason = ""): Promise<void> {
    await this.trigger("abort", { reason });
  }

  get hookNames(): string[] {
    return [...this._hooks.entries()]
      .filter(([, handlers]) => handlers.length > 0)
      .map(([name]) => name);
  }
}
