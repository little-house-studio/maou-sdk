/**
 * hit-test —— 鼠标 (col,row) → 组件/光标位置映射。
 * string-width 处理 CJK 宽字符列。
 * 命中区域：InputBar（移光标）/ ChatPage（滚动）/ ToolCard（折叠）/ overlay（选项）。
 */

import stringWidth from "string-width";

export type HitTarget =
  | { kind: "input"; col: number }          // 输入框，col=光标字符列
  | { kind: "chatScroll"; dir: "up" | "down" } // 对话区滚轮
  | { kind: "overlay"; row: number }        // overlay 选项行
  | { kind: "none" };

export interface LayoutRect {
  // 各区域在终端的行范围（1-based，从底往上数 inputRowFromBottom）
  inputRowFromBottom: number;  // 输入框行（默认 2，状态栏1 + 输入框2）
  inputLineCount?: number;     // InputBar 当前占几行（多行时命中整段，默认 1）
  chatTop: number;             // 对话区顶行（1-based）
  chatBottom: number;          // 对话区底行（1-based，= inputRowFromBottom+1 之上）
  overlayTop?: number;         // overlay 顶行（若开）
}

/** 把屏幕 (col, row 1-based) 映射到命中目标 */
export function hitTest(col: number, row: number, rows: number, rect: LayoutRect): HitTarget {
  const inputBottom = rows - 1;  // 状态栏占最后 1 行，InputBar 底部在 rows-1
  // InputBar 占 inputLineCount 行（从 inputBottom 往上）。多行时点击任意一行都命中。
  const inputTop = inputBottom - Math.max(1, rect.inputLineCount ?? 1) + 1;
  if (rect.overlayTop !== undefined && row >= rect.overlayTop) {
    return { kind: "overlay", row: row - rect.overlayTop };
  }
  if (row >= inputTop && row <= inputBottom) {
    // 输入框行：col 减去 prompt 前缀宽度 = paddingX(1) + " ❯ "(3) = 4 列
    // 多行时除第一行外没有 ❯ 前缀，但 react-ink-textarea 多行缩进对齐，统一按 4 列近似
    const charCol = Math.max(0, col - 4);
    return { kind: "input", col: charCol };
  }
  if (row >= rect.chatTop && row <= rect.chatBottom) {
    // 对话区滚轮（点击不滚动，滚轮才滚——这里命中仅标记）
    return { kind: "none" };
  }
  return { kind: "none" };
}

/** 把字符列转成字符串索引（考虑 CJK 宽字符占 2 列） */
export function colToIndex(text: string, col: number): number {
  let width = 0;
  for (let i = 0; i < text.length; i++) {
    const w = stringWidth(text[i]!);
    if (width + w > col) return i;
    width += w;
  }
  return text.length;
}
