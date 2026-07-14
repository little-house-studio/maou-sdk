/**
 * hit-test —— 鼠标 (col,row) → 组件/光标位置映射。
 * string-width 处理 CJK 宽字符列。
 * 命中区域：InputBar（移光标）/ ChatPage（滚动）/ ToolCard（折叠）/ overlay（选项）。
 */

import stringWidth from "string-width";
import { INPUT_TEXT_COL_OFFSET_DEFAULT } from "../config/ui-constants.js";

export type HitTarget =
  | { kind: "input"; col: number; line: number }   // 输入框，col=光标字符列，line=0-based 行
  | { kind: "chatScroll"; dir: "up" | "down" }      // 对话区滚轮
  | { kind: "overlay"; row: number }                // overlay 选项行
  | { kind: "none" };

export interface LayoutRect {
  // 各区域在终端的行范围（1-based，从底往上数 inputRowFromBottom）
  inputRowFromBottom: number;  // 输入框行（默认 2，状态栏1 + 输入框2）—— fallback 用
  inputLineCount?: number;     // InputBar 当前占几行（多行时命中整段，默认 1）
  chatTop: number;             // 对话区顶行（1-based）
  chatBottom: number;          // 对话区底行（1-based，= inputRowFromBottom+1 之上）
  overlayTop?: number;         // overlay 顶行（若开）
  // InputBar 屏幕矩形（getElementRect 实测，优先于 inputRowFromBottom 硬编码）
  inputRect?: { left: number; top: number; width: number; height: number } | null;
  inputTextColOffset?: number; // TextArea 文字起点相对 inputRect.left 的列偏移（InputBar=4 含" ❯ "，FullScreenEditor=1）
}

/**
 * 把屏幕 (col, row 1-based) 映射到命中目标。
 * clickLine 0-based 从 InputBar 顶部数（供 InputBar 算光标行）。
 * 优先用 inputRect（实测屏幕矩形）判定 input 区；未就绪时回退 inputRowFromBottom。
 */
export function hitTest(col: number, row: number, rows: number, rect: LayoutRect): HitTarget {
  if (rect.overlayTop !== undefined && row >= rect.overlayTop) {
    return { kind: "overlay", row: row - rect.overlayTop };
  }
  // 优先：实测 inputRect（高度异常时忽略，防整屏被当成输入区 → I 形光标）
  if (rect.inputRect && rect.inputRect.height > 0 && rect.inputRect.height <= 10) {
    const r = rect.inputRect;
    if (col >= r.left && col < r.left + r.width && row >= r.top && row < r.top + r.height) {
      const offset = rect.inputTextColOffset ?? INPUT_TEXT_COL_OFFSET_DEFAULT;
      const charCol = Math.max(0, col - r.left - offset);
      const clickLine = row - r.top;  // 0-based 从 TextArea 顶部数
      return { kind: "input", col: charCol, line: clickLine };
    }
  } else if (!rect.inputRect || rect.inputRect.height > 10) {
    // fallback：命名常量行号（inputRect 未就绪时）
    const inputBottom = rows - rect.inputRowFromBottom;
    const lineCount = Math.max(1, rect.inputLineCount ?? 1);
    const inputTop = inputBottom - lineCount + 1;
    if (row >= inputTop && row <= inputBottom) {
      const clickLine = row - inputTop;
      const charCol = Math.max(0, col - INPUT_TEXT_COL_OFFSET_DEFAULT);
      return { kind: "input", col: charCol, line: clickLine };
    }
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
 * 用 [...text] 按 code point 遍历（修 emoji 代理对被拆）。
 */
export function colToIndex(text: string, col: number, line = 0): number {
  // 定位到第 line 行的起始索引
  let lineStart = 0;
  let curLine = 0;
  while (curLine < line && lineStart < text.length) {
    if (text[lineStart] === "\n") curLine++;
    lineStart++;
  }
  // 在该行内按 code point 遍历，按视觉宽度找 col
  const lineText = text.slice(lineStart);
  const newlineIdx = lineText.indexOf("\n");
  const segment = newlineIdx >= 0 ? lineText.slice(0, newlineIdx) : lineText;
  const chars = [...segment];
  let width = 0;
  let charIdx = 0;
  for (const ch of chars) {
    const w = stringWidth(ch);
    if (width + w > col) return lineStart + charIdx;
    width += w;
    charIdx += ch.length; // ch.length 是 UTF-16 code unit 数（代理对=2）
  }
  return lineStart + charIdx;
}

/**
 * 反向映射：UTF-16 字符索引 idx → (line, col) 视觉坐标。
 * line 0-based 按 \n 分割；col 是该行内的视觉列（CJK/emoji 算 2）。
 * 用于把文本选区索引转回屏幕列，同步 vram 蓝底。
 */
export function indexToCol(text: string, idx: number): { line: number; col: number } {
  let line = 0;
  let lineStart = 0;
  let i = 0;
  while (i < idx && i < text.length) {
    if (text[i] === "\n") { line++; lineStart = i + 1; }
    i++;
  }
  // 从 lineStart 到 idx 累加视觉宽度
  const seg = text.slice(lineStart, idx);
  let col = 0;
  for (const ch of [...seg]) col += stringWidth(ch);
  return { line, col };
}
