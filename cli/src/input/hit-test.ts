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
  chatTop: number;             // 对话区顶行（1-based）
  chatBottom: number;          // 对话区底行（1-based，= inputRowFromBottom+1 之上）
  overlayTop?: number;         // overlay 顶行（若开）
}

/** 把屏幕 (col, row 1-based) 映射到命中目标 */
export function hitTest(col: number, row: number, rows: number, rect: LayoutRect): HitTarget {
  const inputRow = rows - rect.inputRowFromBottom + 1;
  if (rect.overlayTop !== undefined && row >= rect.overlayTop) {
    return { kind: "overlay", row: row - rect.overlayTop };
  }
  if (row === inputRow) {
    // 输入框行：col 减去 prompt 前缀宽度（"❯ " = 2 + padding 1 = 3）
    const charCol = Math.max(0, col - 3);
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
