/**
 * 输入框编辑边界：词 / 句 / 单码点
 * Alt+Backspace → 按词删；Ctrl+Backspace → 按句删
 */

/** 光标前一个 Unicode 码点起点（处理代理对） */
export function prevCodePointIndex(s: string, cursor: number): number {
  if (cursor <= 0) return 0;
  const c = s.charCodeAt(cursor - 1);
  // 低代理：再退一个高代理
  if (c >= 0xdc00 && c <= 0xdfff && cursor >= 2) {
    const hi = s.charCodeAt(cursor - 2);
    if (hi >= 0xd800 && hi <= 0xdbff) return cursor - 2;
  }
  return cursor - 1;
}

/** 上一词边界：跳过空白，再跳过连续非空白（与常见编辑器一致） */
export function findPrevWordBoundary(value: string, cursor: number): number {
  let pos = Math.min(cursor, value.length) - 1;
  while (pos >= 0 && /\s/.test(value[pos]!)) pos -= 1;
  while (pos >= 0 && !/\s/.test(value[pos]!)) pos -= 1;
  return pos + 1;
}

/**
 * 上一句边界：删到上一个句末标点之后，或行首/文首。
 * 例：「Hello. World|」→ 保留「Hello.」；「第一句。第二句|」→ 保留「第一句。」
 */
export function findPrevSentenceBoundary(value: string, cursor: number): number {
  const c = Math.min(cursor, value.length);
  if (c <= 0) return 0;
  let i = c;
  // 先吃掉光标前空白
  while (i > 0 && /[ \t\r]/.test(value[i - 1]!)) i--;
  // 再向前扫到句末标点或换行
  while (i > 0) {
    const ch = value[i - 1]!;
    if (ch === "\n") return i;
    if (/[.!?。！？…]/.test(ch)) return i;
    i--;
  }
  return 0;
}

/** 在 cursor 处向回删到 boundary，返回新文本与新光标 */
export function deleteBackwardTo(
  value: string,
  cursor: number,
  boundary: number,
): { text: string; cursor: number } {
  const c = Math.max(0, Math.min(cursor, value.length));
  const b = Math.max(0, Math.min(boundary, c));
  if (b >= c) return { text: value, cursor: c };
  return {
    text: value.slice(0, b) + value.slice(c),
    cursor: b,
  };
}
