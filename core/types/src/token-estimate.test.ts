/**
 * 这是全产品唯一的文本 token 公式 —— CLI / App / 压缩阈值都读它。
 * 下面的定值是锚：改动公式会让历史会话的占用条突变，必须是自觉的决定。
 */
import { describe, expect, it } from "vitest";
import { estimateTokensFromText } from "./token-estimate.js";

describe("estimateTokensFromText golden", () => {
  const cases: Array<[label: string, text: string, tokens: number]> = [
    ["empty", "", 0],
    ["ascii 4 chars = 1 token", "abcd", 1],
    ["ascii rounds up", "abcde", 2],
    ["cjk 1 char = 1 token", "字", 1],
    ["cjk sentence", "上下文压缩", 5],
    ["mixed", "读 file.ts 的第 10 行", 8],
    ["emoji counts as other", "🙂", 1],
    ["newline is ascii", "a\nb\nc\nd", 2],
    ["json-ish", '{"path":"/tmp/a.txt"}', 6],
  ];

  for (const [label, text, tokens] of cases) {
    it(label, () => {
      expect(estimateTokensFromText(text)).toBe(tokens);
    });
  }

  it("is additive across concatenation within rounding slack", () => {
    const a = "hello world ";
    const b = "上下文";
    const sum = estimateTokensFromText(a) + estimateTokensFromText(b);
    const joined = estimateTokensFromText(a + b);
    expect(Math.abs(joined - sum)).toBeLessThanOrEqual(1);
  });

  it("grows monotonically with length", () => {
    let prev = 0;
    for (let n = 1; n <= 200; n += 17) {
      const cur = estimateTokensFromText("x".repeat(n));
      expect(cur).toBeGreaterThanOrEqual(prev);
      prev = cur;
    }
  });

  it("never returns a negative or fractional count", () => {
    for (const text of ["", "a", "字", "🙂🙂🙂", "a".repeat(1000)]) {
      const n = estimateTokensFromText(text);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
    }
  });
});
