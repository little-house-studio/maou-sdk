/**
 * CJK-aware token 估算。
 * 不依赖 LLM tokenizer，纯本地计算。
 *
 * 启发式：CJK 字符 ≈ 1 token/字，ASCII ≈ 4 chars/token。
 * 比全局 chars/3 更准确（中英混合文本偏差从 ~40% 降到 ~15%）。
 */

import type { MaouMessage } from "./types/message.js";

const CJK_RANGES =
  /[⺀-鿿豈-﫿︰-﹏\u{20000}-\u{2FA1F}]/u;

export function estimateTokensFromText(text: string): number {
  let cjk = 0;
  let ascii = 0;
  for (const ch of text) {
    if (CJK_RANGES.test(ch)) {
      cjk++;
    } else {
      ascii++;
    }
  }
  return cjk + Math.ceil(ascii / 4);
}

export function estimateTokens(messages: MaouMessage[]): number {
  let total = 0;
  for (const m of messages) {
    let text = '';
    for (const c of m.contents) {
      text += (c.microCompact?.enabled && c.microCompact.summary ? c.microCompact.summary : c.text) + '\n';
    }
    total += estimateTokensFromText(text);
    if (m.toolCalls) {
      for (const tc of m.toolCalls) {
        total += estimateTokensFromText(tc.name);
        total += estimateTokensFromText(JSON.stringify(tc.arguments));
      }
    }
  }
  return total;
}
