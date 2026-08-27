/**
 * 上下文占用：只认上一条 API usage 的 input + output。
 * 不估算正文、不算历史增量。
 */

import { estimateTokensFromText } from "@little-house-studio/types";
import type { MaouMessage } from "./types/message.js";

export { estimateTokensFromText };

export type UsageTokens = {
  input: number;
  output: number;
};

export function parseUsageTokens(
  usage: Record<string, unknown> | null | undefined,
): UsageTokens {
  if (!usage || typeof usage !== "object") return { input: 0, output: 0 };
  const inputRaw = Number(
    usage.prompt_tokens
      ?? usage.input_tokens
      ?? usage.inputTokens
      ?? usage.input
      ?? 0,
  );
  const outputRaw = Number(
    usage.completion_tokens
      ?? usage.output_tokens
      ?? usage.outputTokens
      ?? usage.output
      ?? 0,
  );
  let input = Number.isFinite(inputRaw) && inputRaw > 0 ? Math.trunc(inputRaw) : 0;
  const output = Number.isFinite(outputRaw) && outputRaw > 0 ? Math.trunc(outputRaw) : 0;
  if (input <= 0) {
    const total = Number(usage.total_tokens ?? usage.totalTokens ?? 0);
    if (Number.isFinite(total) && total > 0 && total >= output) {
      input = Math.trunc(total - output);
    }
  }
  return { input, output };
}

/** 上一条回报的占用：input + output。无 usage 则为 0。 */
export function occupancyFromUsage(
  usage: Record<string, unknown> | null | undefined,
): number {
  const { input, output } = parseUsageTokens(usage);
  return input + output;
}

/**
 * 从厂商/runtime usage 解析 prompt/input token。
 * 占用请用 {@link occupancyFromUsage}（input+output）。
 */
export function parsePromptTokensFromUsage(
  usage: Record<string, unknown> | null | undefined,
): number {
  return parseUsageTokens(usage).input;
}

/** 占用比 0–1（used/max）。max<=0 时返回 0。 */
export function contextUsageRatio(used: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(1.5, used / max));
}

/** 剩余比 0–1 */
export function contextRemainingRatio(used: number, max: number): number {
  if (max <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - used / max));
}

/** 决策用占用：上一条 input + output。忽略任何估算字段。 */
export function resolveContextUsedTokens(opts: {
  input?: number;
  output?: number;
  apiPromptTokens?: number;
  apiOutputTokens?: number;
  estimatedPromptTokens?: number;
}): number {
  void opts.estimatedPromptTokens;
  const input = Math.max(0, Math.trunc(opts.input ?? opts.apiPromptTokens ?? 0));
  const output = Math.max(0, Math.trunc(opts.output ?? opts.apiOutputTokens ?? 0));
  return input + output;
}

/** @deprecated 占用不再估算正文。保留给非占用的文本长度探测。 */
const MSG_OVERHEAD = 4;
const TOOL_CALL_OVERHEAD = 8;

/** @deprecated */
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

/** @deprecated */
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
  return Math.max(total, 0);
}

/** @deprecated 占用不再估算整包 prompt。 */
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
