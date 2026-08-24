/**
 * SDK 钩子系统 — async、可拦截、可改写结果、可取消压缩。
 *
 * 规范名见 hook-names.ts。别名（tool_call、session_before_compact 等）注册到规范名，只触发一次。
 *
 * 返回值：
 *   false / 非空字符串 / { block, reason } → 拦截（工具）
 *   { cancel: true } → 取消压缩或跳过缓存重建
 *   { content, details, isError } → 改写 tool result
 *   { compaction.summary } → 写入滚动摘要
 *   { systemPrompt } → 追加到系统提示词
 *   { message } → 改写用户消息（pre_message）；pre_message 拦截则不入会话
 *   { continue: true } / { cancel: true } → stop / stop_failure 阻止收尾并注入 reason
 *   { decision: "allow"|"deny"|"ask" } / { approve } → permission_request
 *
 * handler 可为 async；kwargs.ui 可弹确认（无 UI 时 confirm 默认拒绝）。
 */

import type { Message, ToolCall, ToolResult } from "../agent_factory/types.js";
import {
  CANONICAL_HOOKS,
  CANONICAL_HOOK_SET,
  resolveHookName,
} from "./hook-names.js";

export {
  ALL_HOOKS,
  CANONICAL_HOOKS,
  CANONICAL_HOOK_SET,
  HOOK_ALIASES,
  isKnownHookName,
  resolveHookName,
} from "./hook-names.js";
export type { CanonicalHookName, HookName } from "./hook-names.js";

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
  /** stop / stop_failure：阻止收尾，把 reason/message 喂回模型再跑一轮 */
  continue?: boolean;
  /** permission_request：allow 跳过审批，deny 当拒绝，ask 走原 UI */
  decision?: "allow" | "deny" | "ask";
  approve?: boolean;
  /** terminal_pre_run：改写即将执行的命令 */
  command?: string;
  /** terminal_pre_write：改写即将写入 PTY 的数据 */
  data?: string;
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
  continue?: boolean;
  decision?: "allow" | "deny" | "ask";
  blockReason?: string;
  command?: string;
  data?: string;
  content?: unknown;
  details?: unknown;
  isError?: boolean;
  compaction?: HookDecision["compaction"];
  systemPrompt?: string;
  message?: unknown;
}

const EMPTY: HookTriggerResult = { allowed: true, cancel: false };

const RESET_BLOCK_REASON = new Set([
  "pre_tool_use",
  "pre_compact",
  "pre_cache_rebuild",
  "pre_message",
  "stop",
  "stop_failure",
  "permission_request",
  "before_agent_start",
  "agent_request",
  "fs_write_intent",
  "fs_edit_intent",
  "terminal_pre_run",
  "terminal_pre_write",
  "terminal_pre_stop",
  "terminal_pre_rm",
]);

/** stop / stop_failure：钩子要求不要结束本轮 */
export function isHookContinue(r: HookTriggerResult | undefined): boolean {
  if (!r) return false;
  return r.continue === true || r.cancel === true || r.allowed === false;
}

function applyDecision(
  _hookName: string,
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
  if (d.continue) next.continue = true;
  if (d.content !== undefined) next.content = d.content;
  if (d.details !== undefined) next.details = d.details;
  if (d.isError !== undefined) next.isError = d.isError;
  if (d.compaction) next.compaction = d.compaction;
  if (d.systemPrompt !== undefined) next.systemPrompt = d.systemPrompt;
  if (d.message !== undefined) next.message = d.message;
  if (typeof d.command === "string") next.command = d.command;
  if (typeof d.data === "string") next.data = d.data;
  if (d.decision === "deny" || d.approve === false) {
    next.decision = "deny";
    next.allowed = false;
  } else if (
    (d.decision === "allow" || d.approve === true) &&
    next.decision !== "deny" &&
    next.allowed
  ) {
    next.decision = "allow";
    next.allowed = true;
  } else if (d.decision === "ask" && next.decision !== "deny") {
    next.decision = "ask";
  }
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
    for (const hookName of CANONICAL_HOOKS) {
      this._hooks.set(hookName, []);
    }
  }

  on(hookName: string, handler: HookHandler): () => void {
    return this.register(hookName, handler);
  }

  register(hookName: string, handler: HookHandler): () => void {
    const name = resolveHookName(hookName);
    let handlers = this._hooks.get(name);
    if (!handlers) {
      handlers = [];
      this._hooks.set(name, handlers);
      if (!CANONICAL_HOOK_SET.has(name)) {
        console.warn(`[sdk] 注册未知钩子: ${hookName}`);
      }
    }
    handlers.push(handler);
    return () => this.unregister(hookName, handler);
  }

  unregister(hookName: string, handler: HookHandler): void {
    const name = resolveHookName(hookName);
    const handlers = this._hooks.get(name);
    if (!handlers) return;
    const idx = handlers.indexOf(handler);
    if (idx !== -1) handlers.splice(idx, 1);
  }

  async trigger(
    hookName: string,
    kwargs: Record<string, unknown> = {},
  ): Promise<HookTriggerResult> {
    const name = resolveHookName(hookName);
    let acc: HookTriggerResult = { ...EMPTY };
    if (RESET_BLOCK_REASON.has(name)) {
      this.lastBlockReason = undefined;
    }
    const handlers = this._hooks.get(name);
    if (!handlers || handlers.length === 0) return acc;

    const payload = { ...kwargs, ui: kwargs.ui ?? this.ui ?? FAIL_CLOSED_HOOK_UI };

    for (const handler of handlers) {
      try {
        const result = await handler(payload);
        acc = applyDecision(name, result, acc);
        if (!acc.allowed && acc.blockReason) {
          this.lastBlockReason = acc.blockReason;
          console.log(
            `[sdk] 钩子 '${name}' 拦截: ${this.lastBlockReason.slice(0, 80)}`,
          );
        } else if (!acc.allowed) {
          console.log(`[sdk] 钩子 '${name}' 拦截了操作`);
        }
      } catch (e) {
        console.error(`[sdk] 钩子 '${name}' 执行异常:`, e);
      }
    }
    return acc;
  }

  async preToolUseGate(toolCall: ToolCall): Promise<HookTriggerResult> {
    const input = (toolCall as { parameters?: unknown }).parameters ?? {};
    const nativeName = toolCall.name;
    const piToolName = toPiToolName(nativeName);
    const r = await this.trigger("pre_tool_use", {
      toolCall,
      input,
      nativeName,
      toolName: nativeName,
      piToolName,
    });
    this.lastBlockReason = r.blockReason ?? this.lastBlockReason;
    return r;
  }

  async preToolUse(toolCall: ToolCall): Promise<boolean> {
    return (await this.preToolUseGate(toolCall)).allowed;
  }

  async postToolUse(toolCall: ToolCall, result: ToolResult): Promise<HookTriggerResult> {
    const nativeName = toolCall.name;
    const r = await this.trigger("post_tool_use", {
      toolCall,
      result,
      nativeName,
      toolName: nativeName,
      piToolName: toPiToolName(nativeName),
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

  async postToolUseFailure(toolCall: ToolCall, result: ToolResult): Promise<HookTriggerResult> {
    const nativeName = toolCall.name;
    const r = await this.trigger("post_tool_use_failure", {
      toolCall,
      result,
      nativeName,
      toolName: nativeName,
      piToolName: toPiToolName(nativeName),
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

  async postToolBatch(payload: Record<string, unknown> = {}): Promise<void> {
    await this.trigger("post_tool_batch", payload);
  }

  async toolError(toolCall: ToolCall, error: string): Promise<void> {
    await this.trigger("tool_error", { toolCall, error });
  }

  async stop(payload: Record<string, unknown> = {}): Promise<HookTriggerResult> {
    return this.trigger("stop", payload);
  }

  async stopFailure(payload: Record<string, unknown> = {}): Promise<HookTriggerResult> {
    return this.trigger("stop_failure", payload);
  }

  async subagentStart(payload: Record<string, unknown> = {}): Promise<void> {
    await this.trigger("subagent_start", payload);
  }

  async subagentStop(payload: Record<string, unknown> = {}): Promise<void> {
    await this.trigger("subagent_stop", payload);
  }

  async permissionRequest(payload: Record<string, unknown> = {}): Promise<HookTriggerResult> {
    return this.trigger("permission_request", payload);
  }

  async permissionDenied(payload: Record<string, unknown> = {}): Promise<void> {
    await this.trigger("permission_denied", payload);
  }

  async notification(payload: Record<string, unknown> = {}): Promise<void> {
    await this.trigger("notification", payload);
  }

  async agentRequest(payload: Record<string, unknown> = {}): Promise<HookTriggerResult> {
    return this.trigger("agent_request", payload);
  }

  async fsWriteIntent(payload: Record<string, unknown> = {}): Promise<HookTriggerResult> {
    return this.trigger("fs_write_intent", payload);
  }

  async fsEditIntent(payload: Record<string, unknown> = {}): Promise<HookTriggerResult> {
    return this.trigger("fs_edit_intent", payload);
  }

  async terminalPreRun(payload: Record<string, unknown> = {}): Promise<HookTriggerResult> {
    return this.trigger("terminal_pre_run", payload);
  }

  async terminalPreWrite(payload: Record<string, unknown> = {}): Promise<HookTriggerResult> {
    return this.trigger("terminal_pre_write", payload);
  }

  async terminalPreStop(payload: Record<string, unknown> = {}): Promise<HookTriggerResult> {
    return this.trigger("terminal_pre_stop", payload);
  }

  async terminalPreRm(payload: Record<string, unknown> = {}): Promise<HookTriggerResult> {
    return this.trigger("terminal_pre_rm", payload);
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

  async beforeAgentStart(payload: Record<string, unknown> = {}): Promise<HookTriggerResult> {
    return this.trigger("before_agent_start", payload);
  }

  async preMessage(message: Message): Promise<HookTriggerResult> {
    return this.trigger("pre_message", { message });
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
    const merged = await this.trigger("pre_compact", payload);
    this.lastCompactDecision = merged;
    return merged;
  }

  async postCompact(compressedCount: number): Promise<void> {
    await this.trigger("post_compact", { compressedCount });
  }

  async preCacheRebuild(payload: Record<string, unknown> = {}): Promise<HookTriggerResult> {
    const r = await this.trigger("pre_cache_rebuild", payload);
    this.lastCacheRebuildDecision = r;
    return r;
  }

  async cacheRebuildPoint(payload: Record<string, unknown> = {}): Promise<HookTriggerResult> {
    return this.trigger("cache_rebuild_point", payload);
  }

  async postCacheRebuild(payload: Record<string, unknown> = {}): Promise<void> {
    await this.trigger("post_cache_rebuild", payload);
  }

  async promptRefresh(payload: Record<string, unknown> = {}): Promise<HookTriggerResult> {
    return this.trigger("prompt_refresh", payload);
  }

  async deviceOnline(deviceId: string): Promise<void> {
    await this.trigger("device_online", { deviceId });
  }

  async deviceOffline(deviceId: string): Promise<void> {
    await this.trigger("device_offline", { deviceId });
  }

  async configChange(payload: Record<string, unknown> = {}): Promise<void> {
    await this.trigger("config_change", payload);
  }

  async sessionStart(sessionId: string): Promise<void> {
    await this.trigger("session_start", { sessionId });
  }

  async sessionEnd(sessionId: string): Promise<void> {
    await this.trigger("session_end", { sessionId });
  }

  async sessionFork(
    parentSessionId: string,
    childSessionId: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await this.trigger("session_fork", { parentSessionId, childSessionId, ...extra });
  }

  async loopEnd(sessionId: string, extra: Record<string, unknown> = {}): Promise<void> {
    await this.trigger("loop_end", { sessionId, ...extra });
  }

  async error(message: string, extra: Record<string, unknown> = {}): Promise<void> {
    await this.trigger("error", { message, ...extra });
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

/** 把 hook 返回的 message 收成字符串 */
export function takeHookMessage(message: unknown, fallback: string): string {
  if (typeof message === "string" && message.trim()) return message;
  if (message && typeof message === "object" && "content" in (message as object)) {
    const c = (message as { content?: unknown }).content;
    if (typeof c === "string") return c;
  }
  return fallback;
}

/** 把 hook 给出的 systemPrompt 追加到已编译提示词后 */
export function appendHookSystemPrompt(current: string, extra?: string): string {
  const t = extra?.trim();
  if (!t) return current;
  return `${current}\n\n${t}`;
}
