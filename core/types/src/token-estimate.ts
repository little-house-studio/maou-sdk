/**
 * 共享文本 token 启发式（权威实现）。
 *
 * context / llm 等包应复用本函数，避免双公式导致 CLI 与 Runtime 数字不一致。
 * 精度：中英混合约 ±10–20%，足够压缩阈值与 UI 展示。
 */

const CJK_RANGES =
  /[⺀-鿿豈-﫿︰-﹏\u{20000}-\u{2FA1F}]/u;

/**
 * 文本 → token 估算。
 * CJK 1 字 ≈ 1 token；拉丁约 4 字符 ≈ 1 token；其它非 ASCII 按 1 token。
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
      other++;
    }
  }
  const asciiTokens = Math.ceil(ascii / 4);
  return cjk + asciiTokens + other;
}
