/**
 * 上下文占用的 token 解析：厂商 usage 是唯一权威来源。
 * 启发式估算只用于两处 —— 锚点之后新增消息的增量、剪裁前后的比值。
 */

import { estimateTokensFromText } from "@little-house-studio/types";
import { segmentVisibleText, type MaouMessage } from "./types/message.js";

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

const MSG_OVERHEAD = 4;
const TOOL_CALL_OVERHEAD = 8;

/**
 * 启发式估算一组 MaouMessage 的 token 数（含 microCompact 摘要替换后的形态）。
 * 与厂商 usage 不可直接比绝对值，只能比同一批消息剪裁前后的比值。
 */
export function estimateTokens(messages: MaouMessage[]): number {
  let total = 0;
  for (const m of messages) {
    total += MSG_OVERHEAD;
    let text = "";
    for (const c of m.contents) {
      text += segmentVisibleText(c) + "\n";
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
