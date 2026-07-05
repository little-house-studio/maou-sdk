/**
 * hit-test —— 鼠标 (col,row) → 组件/光标位置映射。
 * string-width 处理 CJK 宽字符列。
 * 命中区域：InputBar（移光标）/ ChatPage（滚动）/ ToolCard（折叠）/ overlay（选项）。
 */

import stringWidth from "string-width";

export type HitTarget =
  | { kind: "input"; col: number; line: number }   // 输入框，col=光标字符列，line=0-based 行
  | { kind: "chatScroll"; dir: "up" | "down" }      // 对话区滚轮
  | { kind: "overlay"; row: number }                // overlay 选项行
  | { kind: "none" };

export interface LayoutRect {
  // 各区域在终端的行范围（1-based，从底往上数 inputRowFromBottom）
  inputRowFromBottom: number;  // 输入框行（默认 2，状态栏1 + 输入框2）
  inputLineCount?: number;     // InputBar 当前占几行（多行时命中整段，默认 1）
  chatTop: number;             // 对话区顶行（1-based）
  chatBottom: number;          // 对话区底行（1-based，= inputRowFromBottom+1 之上）
  overlayTop?: number;         // overlay 顶行（若开）
}

/**
 * 把屏幕 (col, row 1-based) 映射到命中目标。
 * clickLine 0-based 从 InputBar 顶部数（供 InputBar 算光标行）。
 */
export function hitTest(col: number, row: number, rows: number, rect: LayoutRect): HitTarget {
  const inputBottom = rows - 1;  // 状态栏占最后 1 行，InputBar 底部在 rows-1
  // InputBar 占 inputLineCount 行（从 inputBottom 往上）。多行时点击任意一行都命中。
  const lineCount = Math.max(1, rect.inputLineCount ?? 1);
  const inputTop = inputBottom - lineCount + 1;
  if (rect.overlayTop !== undefined && row >= rect.overlayTop) {
    return { kind: "overlay", row: row - rect.overlayTop };
  }
  if (row >= inputTop && row <= inputBottom) {
    // clickLine 0-based 从 InputBar 顶部数（rows - 1 是最后一行 → lineCount-1）
    const clickLine = row - inputTop;
    // 输入框行：col 减去 prompt 前缀宽度 = paddingX(1) + " ❯ "(3) = 4 列
    // 多行时除第一行外没有 ❯ 前缀，但 react-ink-textarea 多行缩进对齐，统一按 4 列近似
    const charCol = Math.max(0, col - 4);
    return { kind: "input", col: charCol, line: clickLine };
  }
  if (row >= rect.chatTop && row <= rect.chatBottom) {
    // 对话区滚轮（点击不滚动，滚轮才滚——这里命中仅标记）
    return { kind: "none" };
  }
  return { kind: "none" };
}

/**
 * 把 (line, col) 转成字符串索引（考虑 CJK 宽字符占 2 列）。
 * line 0-based 按 \n 分割的逻辑行；col 是该行内的字符列。
 * 多行 value：先跳过前 line 个换行，再在该行内按宽度找。
 */
export function colToIndex(text: string, col: number, line = 0): number {
  // 定位到第 line 行的起始索引
  let lineStart = 0;
  let curLine = 0;
  while (curLine < line && lineStart < text.length) {
    if (text[lineStart] === "\n") curLine++;
    lineStart++;
  }
  // 在该行内按宽度找 col 对应的字符索引
  let width = 0;
  let i = lineStart;
  while (i < text.length && text[i] !== "\n") {
    const w = stringWidth(text[i]!);
    if (width + w > col) return i;
    width += w;
    i++;
  }
  return i;  // col 超出行尾 → 行末索引
}
