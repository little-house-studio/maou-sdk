/**
 * screen-buffer —— 全局字符网格，供鼠标选区提取文本。
 *
 * 每个 SelectableText 渲染后调 registerText，把文本按视觉行登记到 grid：
 *   grid.get("row,col") → { char, textId }
 * row/col 1-based（和终端鼠标坐标一致）。
 *
 * 字符宽度用 string-width（CJK/emoji 占 2 列），按 code point 分割（[...str]）
 * 避免代理对被拆。
 *
 * soft-wrap：长行按可用宽度算视觉行，每个视觉行登记到对应 row。
 *
 * 选区提取：extractSelection(start, end) 按行列范围从 grid 提取文本，
 * 跨行用 \n 连接，宽字符整组包含。
 */

import stringWidth from "string-width";

export interface GridCell {
  char: string;     // 一个 grapheme/code point（可能占 2 列）
  textId: number;   // 所属 SelectableText 的 id
}

const grid = new Map<string, GridCell>(); // "row,col" → cell
let nextTextId = 0;

export function nextTextIdGen(): number {
  return nextTextId++;
}

export function clearScreenBuffer(): void {
  grid.clear();
}

export function charAt(row: number, col: number): GridCell | null {
  return grid.get(`${row},${col}`) ?? null;
}

/**
 * 登记一段文本到屏幕网格。
 * @param text 文本内容
 * @param left 文本左上角屏幕列（1-based）
 * @param top 文本左上角屏幕行（1-based）
 * @param availWidth 可用视觉宽度（超出则 soft-wrap 到下一行）
 * @param textId SelectableText id
 */
export function registerText(text: string, left: number, top: number, availWidth: number, textId: number): void {
  const chars = [...text]; // 按 code point 分割
  let row = top;
  let col = left;
  let lineUsed = 0;
  for (const ch of chars) {
    if (ch === "\n") {
      row++;
      col = left;
      lineUsed = 0;
      continue;
    }
    const w = stringWidth(ch) || 1;
    // soft-wrap：当前行放不下则换行
    if (lineUsed + w > availWidth && lineUsed > 0) {
      row++;
      col = left;
      lineUsed = 0;
    }
    // 登记该字符占的每个视觉列
    for (let k = 0; k < w; k++) {
      grid.set(`${row},${col + k}`, { char: ch, textId });
    }
    col += w;
    lineUsed += w;
  }
}

/**
 * 提取选区文本。start/end 为 {row, col}（1-based，col 为视觉列）。
 * 规范化到左上→右下。跨行用 \n 连接。
 * 宽字符：选区边界落在宽字符中间时整组包含（grid 里宽字符占多列但 char 相同，去重）。
 */
export function extractSelection(
  start: { row: number; col: number },
  end: { row: number; col: number },
): string {
  // 规范化：r1,c1 是左上（较小 row，同行较小 col），r2,c2 是右下
  let r1: number, c1: number, r2: number, c2: number;
  if (start.row < end.row || (start.row === end.row && start.col <= end.col)) {
    r1 = start.row; c1 = start.col; r2 = end.row; c2 = end.col;
  } else {
    r1 = end.row; c1 = end.col; r2 = start.row; c2 = start.col;
  }
  const lines: string[] = [];
  for (let r = r1; r <= r2; r++) {
    const colStart = r === r1 ? c1 : 1;
    const colEnd = r === r2 ? c2 : 9999;
    const lineChars: string[] = [];
    let lastChar: string | null = null;
    for (let c = colStart; c <= colEnd; c++) {
      const cell = grid.get(`${r},${c}`);
      if (!cell) {
        if (lastChar !== null) { lineChars.push(lastChar); lastChar = null; }
        continue;
      }
      if (lastChar !== null && lastChar !== cell.char) {
        lineChars.push(lastChar);
      }
      lastChar = cell.char;
    }
    if (lastChar !== null) lineChars.push(lastChar);
    lines.push(lineChars.join(""));
  }
  return lines.join("\n");
}

/** 诊断：返回 grid 大小 */
export function gridSize(): number {
  return grid.size;
}
