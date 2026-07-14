/**
 * Token 估算 —— 本地启发式，不依赖厂商 tokenizer。
 *
 * 目标：中英混合误差约 10–20%，足够触发压缩阈值。
 * 比纯 chars/3 更稳：CJK≈1 token/字，ASCII≈4 chars/token，
 * 并计入消息/工具调用结构开销与 JSON 膨胀。
 */

import type { MaouMessage } from "./types/message.js";

const CJK_RANGES =
  /[⺀-鿿豈-﫿︰-﹏\u{20000}-\u{2FA1F}]/u;

/** 每条消息的结构开销（role/分隔等，近似 OpenAI 计费） */
const MSG_OVERHEAD = 4;
/** tool_call 名 + args 封装开销 */
const TOOL_CALL_OVERHEAD = 8;

/**
 * 文本 → token 估算。
 * CJK 1 字 ≈ 1 token；拉丁约 4 字符 ≈ 1 token；数字/标点计入 ascii 桶。
 */
export function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let ascii = 0;
  let other = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (CJK_RANGES.test(ch)) {
      cjk++;
    } else if (code <= 0x7f) {
      ascii++;
    } else {
      // 其它非 ASCII（emoji、西里尔等）：偏保守按 1 token
      other++;
    }
  }
  // JSON/代码里空白多：ascii 略加压
  const asciiTokens = Math.ceil(ascii / 4);
  return cjk + asciiTokens + other;
}

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
