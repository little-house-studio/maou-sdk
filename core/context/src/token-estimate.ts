/**
 * Token 估算 —— 本地启发式，不依赖厂商 tokenizer。
 *
 * 文本级权威实现：`@little-house-studio/types` 的 `estimateTokensFromText`。
 * 本文件叠加 MaouMessage / 全量 prompt 结构开销。
 */

import { estimateTokensFromText } from "@little-house-studio/types";
import type { MaouMessage } from "./types/message.js";

export { estimateTokensFromText };

/** 每条消息的结构开销（role/分隔等，近似 OpenAI 计费） */
const MSG_OVERHEAD = 4;
/** tool_call 名 + args 封装开销 */
const TOOL_CALL_OVERHEAD = 8;

/** 任意消息列表（session wire / LLM message）粗算 */
export function estimateTokensFromStrings(
  parts: Array<{ role?: string; content?: string }>,
): number {
  let total = 0;
  for (const p of parts) {
    total += MSG_OVERHEAD;
    total += estimateTokensFromText(String(p.content ?? ""));
  }
  return total;
}

export function estimateTokens(messages: MaouMessage[]): number {
  let total = 0;
  for (const m of messages) {
    total += MSG_OVERHEAD;
    let text = "";
    for (const c of m.contents) {
      text +=
        (c.microCompact?.enabled && c.microCompact.summary
          ? c.microCompact.summary
          : c.text) + "\n";
    }
    total += estimateTokensFromText(text);
    if (m.toolCalls) {
      for (const tc of m.toolCalls) {
        total += TOOL_CALL_OVERHEAD;
        total += estimateTokensFromText(tc.name);
        try {
          total += estimateTokensFromText(JSON.stringify(tc.arguments ?? {}));
        } catch {
          total += 16;
        }
      }
    }
  }
  // 系统开销下限：避免空会话为 0
  return Math.max(total, 0);
}

/**
 * 占用比 0–1（used/max）。max<=0 时返回 0。
 */
export function contextUsageRatio(used: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(1.5, used / max)); // 允许略超 1 以便 UI 告警
}

/** 剩余比 0–1 */
export function contextRemainingRatio(used: number, max: number): number {
  if (max <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - used / max));
}

/**
 * 从厂商/runtime usage 对象解析 **prompt/input** token（上下文占用）。
 * 不含 completion；字段兼容 OpenAI / Anthropic / 内部别名。
 */
export function parsePromptTokensFromUsage(
  usage: Record<string, unknown> | null | undefined,
): number {
  if (!usage || typeof usage !== "object") return 0;
  const details = usage.prompt_tokens_details as { cached_tokens?: number } | undefined;
  const n = Number(
    usage.prompt_tokens
      ?? usage.input_tokens
      ?? usage.inputTokens
      ?? usage.input
      ?? 0,
  );
  if (Number.isFinite(n) && n > 0) return Math.trunc(n);
  // 少数适配器只给 total + completion：反推 prompt
  const total = Number(usage.total_tokens ?? usage.totalTokens ?? 0);
  const out = Number(
    usage.completion_tokens ?? usage.output_tokens ?? usage.outputTokens ?? usage.output ?? 0,
  );
  if (Number.isFinite(total) && total > 0 && Number.isFinite(out) && out >= 0 && total >= out) {
    return Math.trunc(total - out);
  }
  void details;
  return 0;
}

/**
 * 估算「整包 prompt」token：history + system + tools schema + 其它注入。
 * 用于无 API usage 时的压缩触发（首轮 / 厂商不回 usage）。
 */
export function estimateFullPromptTokens(parts: {
  historyTokens?: number;
  systemPrompt?: string;
  toolSchemas?: unknown;
  extras?: string[];
}): number {
  let total = Math.max(0, Math.trunc(parts.historyTokens ?? 0));
  if (parts.systemPrompt) total += estimateTokensFromText(parts.systemPrompt);
  for (const e of parts.extras ?? []) {
    if (e) total += estimateTokensFromText(e);
  }
  if (parts.toolSchemas != null) {
    try {
      total += estimateTokensFromText(JSON.stringify(parts.toolSchemas));
    } catch {
      total += 2048;
    }
  }
  return total;
}

/**
 * 决策用上下文占用：优先真实 API prompt tokens，再与本地全量估算取 max（防低估）。
 */
export function resolveContextUsedTokens(opts: {
  apiPromptTokens?: number;
  estimatedPromptTokens?: number;
}): number {
  const api = Math.max(0, Math.trunc(opts.apiPromptTokens ?? 0));
  const est = Math.max(0, Math.trunc(opts.estimatedPromptTokens ?? 0));
  return Math.max(api, est);
}
