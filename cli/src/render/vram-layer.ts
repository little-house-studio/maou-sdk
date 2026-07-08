/**
 * vram-layer —— 显存提取渲染层。
 *
 * monkey-patch Ink 的 Output.get，拦截渲染结果字符串（含 SGR + 文本 + \n），
 * 建二维字符网格（含样式 + 宽字符），注入选区蓝底/hover 后输出到真实 stdout。
 *
 * 用户用普通 <Text>/<Box> 即可，不需要 SelectableText。选区蓝底（含空格、边框）。
 * 光标只有输入框软光标（TextArea 的 \x1b[7m 反显，在 cell.sgr 里），无 hover 伪光标。
 */

import { PassThrough } from "node:stream";
import stringWidth from "string-width";

export interface GridCell {
  ch: string;
  sgr: string;
  w: number;
}

export type Selection = { start: { row: number; col: number }; end: { row: number; col: number } } | null;

let selAnchor: { row: number; col: number } | null = null;
let selFocus: { row: number; col: number } | null = null;

export function setSelection(start: { row: number; col: number } | null, end: { row: number; col: number } | null) {
  selAnchor = start; selFocus = end;
}
export function getSelection(): Selection {
  return selAnchor && selFocus ? { start: selAnchor, end: selFocus } : null;
}
export function clearSelection() { selAnchor = null; selFocus = null; }

function inSel(r: number, c: number): boolean {
  if (!selAnchor || !selFocus) return false;
  const r0 = r - 1, c0 = c - 1;
  let r1: number, c1: number, r2: number, c2: number;
  if (selAnchor.row < selFocus.row || (selAnchor.row === selFocus.row && selAnchor.col <= selFocus.col)) {
    r1 = selAnchor.row - 1; c1 = selAnchor.col - 1; r2 = selFocus.row - 1; c2 = selFocus.col - 1;
  } else {
    r1 = selFocus.row - 1; c1 = selFocus.col - 1; r2 = selAnchor.row - 1; c2 = selAnchor.col - 1;
  }
  return r0 >= r1 && r0 <= r2 && (r0 > r1 || c0 >= c1) && (r0 < r2 || c0 <= c2);
}

// Output.prototype 由 initVramLayer 传入（动态 import 拿，避免 createRequire 的 ESM 问题）
let OutputProto: any = null;
let lastInkOutput = "";
// Ink 内部 cell 形状（含 type/value/fullWidth/styles），用 any 避免与 Ink 内部类型硬绑
let lastGrid: any[][] | null = null;
let origGet: any = null;
// styledCharsToString 在 initVramLayer 里一次性 import 缓存，避免每次 get() 都动态 import
let styledCharsToString: ((chars: any[]) => string) | null = null;

export async function initVramLayer() {
  if (origGet) return; // 已初始化
  const { createRequire } = await import("node:module");
  const { pathToFileURL } = await import("node:url");
  const req = createRequire(import.meta.url);
  const inkPath = req.resolve("ink");
  const outputJsPath = inkPath.replace(/index\.js$/, "output.js");
  const mod = await import(pathToFileURL(outputJsPath).href);
  OutputProto = mod.default.prototype;
  origGet = OutputProto.get;
  // 一次性 import 缓存（get 是同步函数，不能在里面 await import）
  // ansi-tokenize 是纯 ESM 包（type:module，仅 import 条件），用 ESM import 命中 exports map。
  // 之前用 createRequire().resolve() 拿根路径再 pathToFileURL 会因无 CJS main 失败。
  styledCharsToString = (await import("@alcalzone/ansi-tokenize")).styledCharsToString;
  // 重写 get：复制内部逻辑，在转字符串前把二维数组存到 lastGrid
  OutputProto.get = function () {
    // 复制 get 的内部逻辑：建 output[][]，遍历 operations 填充
    const output: any[][] = [];
    for (let y = 0; y < this.height; y++) {
      const row: any[] = [];
      for (let x = 0; x < this.width; x++) {
        row.push({ type: "char", value: " ", fullWidth: false, styles: [] });
      }
      output.push(row);
    }
    const clips: any[] = [];
    for (const operation of this.operations) {
      if (operation.type === "clip") clips.push(operation.clip);
      if (operation.type === "unclip") clips.pop();
      if (operation.type === "write") {
        const { text, transformers } = operation;
        let { x, y } = operation;
        let lines = text.split("\n");
        const clip = clips.at(-1);
        // 简化：不处理 clip（Ink 的 Box overflow:hidden 会 clip，但选区提取不需要精确 clip）
        let offsetY = 0;
        for (const [index, line] of lines.entries()) {
          const currentLine = output[y + offsetY];
          if (!currentLine) { offsetY++; continue; }
          let curLine = line;
          for (const transformer of (transformers ?? [])) {
            curLine = transformer(curLine, index);
          }
          const characters = this.caches.getStyledChars(curLine);
          let offsetX = x;
          if (characters.length === 0) { offsetY++; continue; }
          const spaceCell = { type: "char", value: " ", fullWidth: false, styles: [] };
          if (currentLine[offsetX]?.value === "" && offsetX > 0 &&
              this.caches.getStringWidth(currentLine[offsetX - 1]?.value ?? "") > 1) {
            currentLine[offsetX - 1] = spaceCell;
          }
          for (const character of characters) {
            currentLine[offsetX] = character;
            const characterWidth = Math.max(1, this.caches.getStringWidth(character.value));
            if (characterWidth > 1) {
              for (let i = 1; i < characterWidth; i++) {
                currentLine[offsetX + i] = {
                  type: "char", value: "", fullWidth: false, styles: character.styles,
                };
              }
            }
            offsetX += characterWidth;
          }
          if (currentLine[offsetX]?.value === "") currentLine[offsetX] = spaceCell;
          offsetY++;
        }
      }
    }
    // 存二维数组供 extractSelection 直接用（不丢字符）
    lastGrid = output;
    // 转字符串（用 initVramLayer 缓存的 styledCharsToString，保持 get 同步）
    const fn = styledCharsToString!;
    const generatedOutput = output
      .map(line => {
        const lineWithoutEmptyItems = line.filter((item: any) => item !== undefined);
        return fn(lineWithoutEmptyItems).trimEnd();
      })
      .join("\n");
    lastInkOutput = generatedOutput;
    return { output: generatedOutput, height: output.length };
  };
}

export function unpatchOutput() {
  if (origGet && OutputProto) {
    OutputProto.get = origGet;
    origGet = null;
  }
}

export function createFakeStdout(): any {
  const fake: any = new PassThrough();
  fake.isTTY = true;
  fake.columns = process.stdout.columns || 80;
  fake.rows = process.stdout.rows || 24;
  fake.write = () => true;
  fake.setRawMode = () => fake;
  fake.isRaw = false;
  fake.ref = () => fake;
  fake.unref = () => fake;
  fake.resume = () => fake;
  return fake;
}

/** 从 lastGrid（Ink 原始二维数组）直接建 GridCell 网格，不解析字符串，不丢字符 */
function buildGrid(cols: number, rows: number): GridCell[][] {
  const grid: GridCell[][] = [];
  for (let r = 0; r < rows; r++) {
    grid.push(new Array(cols).fill(null).map(() => ({ ch: " ", sgr: "", w: 1 })));
  }
  if (!lastGrid) return grid;
  for (let r = 0; r < Math.min(lastGrid.length, rows); r++) {
    const srcRow = lastGrid[r];
    if (!srcRow) continue;
    for (let c = 0; c < Math.min(srcRow.length, cols); c++) {
      const cell = srcRow[c];
      if (!cell) continue;
      const ch = cell.value || " ";
      // value="" 是宽字符占位列，跳过（主列已记录）
      if (cell.value === "" && c > 0) {
        // 占位列：标记 w=0，不覆盖主列
        const prev = grid[r][c];
        if (prev.w > 0) {
          // 主列已在上一格设好，这里设占位
          grid[r][c] = { ch: "", sgr: "", w: 0 };
        }
        continue;
      }
      const w = stringWidth(ch) || 1;
      // styles 数组转 SGR 字符串
      let sgr = "";
      if (cell.styles && cell.styles.length > 0) {
        // styles 是 ansi-tokenize 的格式，每个含 endCode
        // 简化：直接从 styles 拼接 SGR
        for (const s of cell.styles) {
          if (s?.code) sgr += s.code;
        }
      }
      grid[r][c] = { ch, sgr, w };
      for (let k = 1; k < w && c + k < cols; k++) {
        grid[r][c + k] = { ch: "", sgr, w: 0 };
      }
    }
  }
  return grid;
}

export function renderWithSelection(cols: number, rows: number): void {
  const grid = buildGrid(cols, rows);
  let out = "\x1b[H\x1b[?25l";
  for (let r = 0; r < rows; r++) {
    let line = "";
    let lastSgr = "\x1b[0m";
    let visW = 0;
    for (let c = 0; c < cols && visW < cols; c++) {
      const cell = grid[r][c];
      if (cell.w === 0) continue;
      if (inSel(r + 1, c + 1)) {
        line += `\x1b[0m${cell.sgr}\x1b[44m${cell.ch}\x1b[0m`;
        lastSgr = "\x1b[0m";
        visW += cell.w;
      } else {
        // 保留 cell.sgr（含 TextArea 软光标的 \x1b[7m 反显等），只在 SGR 变化时输出序列。
        // 空格也带 SGR（textarea 光标反显空格需要）。
        // 不再额外加 hover 反色：hover 反色块会在点击位置残留成"伪光标"，
        // 违背"只有输入框聚焦才有光标"的规则。
        const targetSgr = cell.sgr || "\x1b[0m";
        if (targetSgr !== lastSgr) { line += targetSgr; lastSgr = targetSgr; }
        line += cell.ch;
        visW += cell.w;
      }
    }
    out += `\x1b[${r + 1};1H\x1b[K${line}`;
  }
  out += "\x1b[0m\x1b[?25l";
  process.stdout.write(out);
}

export function extractSelection(): string {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  const grid = buildGrid(cols, rows);
  if (!selAnchor || !selFocus) return "";
  let r1: number, c1: number, r2: number, c2: number;
  if (selAnchor.row < selFocus.row || (selAnchor.row === selFocus.row && selAnchor.col <= selFocus.col)) {
    r1 = selAnchor.row - 1; c1 = selAnchor.col - 1; r2 = selFocus.row - 1; c2 = selFocus.col - 1;
  } else {
    r1 = selFocus.row - 1; c1 = selFocus.col - 1; r2 = selAnchor.row - 1; c2 = selAnchor.col - 1;
  }
  // 起点若落在宽字符占位列（w===0），回退到主列，否则首字符会丢
  if (r1 >= 0 && r1 < rows && c1 >= 0 && c1 < cols) {
    while (c1 > 0 && grid[r1][c1].w === 0) c1--;
  }
  // 起点若落在空白区，前进到第一个有内容的列（避免从边框/padding 起步）
  if (r1 >= 0 && r1 < rows && c1 >= 0 && c1 < cols) {
    while (c1 < cols - 1 && grid[r1][c1].ch === " " && grid[r1][c1].w === 1) c1++;
  }
  // 终点若落在占位列，前进到主列，否则末字符会少（宽字符的主列在占位列左侧）
  if (r2 >= 0 && r2 < rows && c2 >= 0 && c2 < cols) {
    while (c2 < cols - 1 && grid[r2][c2].w === 0) c2++;
  }
  // 终点若落在空白区，回退到最后一个有内容的列（避免越过内容抓到边框/padding）
  if (r2 >= 0 && r2 < rows && c2 >= 0 && c2 < cols) {
    while (c2 > 0 && grid[r2][c2].ch === " " && grid[r2][c2].w === 1) c2--;
  }
  const lines: string[] = [];
  for (let r = r1; r <= r2; r++) {
    if (r < 0 || r >= rows) continue;
    const cs = r === r1 ? c1 : 0;
    let ce: number;
    if (r === r2) {
      // 尾行：用 c2（已对齐宽字符 + 空白回退）
      ce = c2;
    } else {
      // 非尾行（首行/中间行）：从 cs 起向右找"内容结束"位置。
      // 内容结束 = 遇到连续 ≥2 个空格（内容内单词间单空格不断，但内容到边框/padding 必是长空格串）。
      // 这样不会越过内容抓到边框/装饰字符。
      ce = cs;
      let run = 0;
      for (let c = cs; c < cols; c++) {
        const cell = grid[r][c];
        if (cell.ch === " " && cell.w === 1) {
          run++;
          if (run >= 2) { ce = c - run; break; }
        } else {
          run = 0;
          ce = c;
        }
      }
    }
    const chars: string[] = [];
    for (let c = cs; c <= ce; c++) {
      if (c < 0 || c >= cols) continue;
      const cell = grid[r][c];
      if (cell.w === 0) continue; // 宽字符占位列，主列已记录字符
      chars.push(cell.ch);
    }
    lines.push(chars.join("").trimEnd());
  }
  return lines.join("\n");
}

/** 判断字符类型：英文/数字/中文/其他（分隔符） */
function charType(ch: string): "word" | "cjk" | "other" {
  if (ch === " " || ch === "") return "other";
  const code = ch.codePointAt(0) ?? 0;
  if (code >= 0x4e00 && code <= 0x9fff) return "cjk"; // CJK 统一汉字
  if (code >= 0x3400 && code <= 0x4dbf) return "cjk"; // CJK 扩展A
  if (code >= 0x3000 && code <= 0x30ff) return "cjk"; // CJK 标点/假名
  if (code >= 0xff00 && code <= 0xffef) return "cjk"; // 全角字符
  if (/[a-zA-Z0-9_]/.test(ch)) return "word";
  return "other";
}

/** 从网格 (row, col) 查找词边界，返回 {startCol, endCol}（1-based 屏幕坐标） */
export function findWordAt(row: number, col: number): { startCol: number; endCol: number } {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  const grid = buildGrid(cols, rows);
  const r = row - 1;
  const c = col - 1;
  if (r < 0 || r >= rows || c < 0 || c >= cols) return { startCol: col, endCol: col };

  const cell = grid[r][c];
  const ch = cell.ch;
  const type = charType(ch);

  if (type === "other") {
    // 标点/空格：单独一个字符为一个"词"
    return { startCol: col, endCol: col };
  }

  // 向左找词起点
  let startC = c;
  while (startC > 0 && charType(grid[r][startC - 1].ch) === type) startC--;
  // 向右找词终点
  let endC = c;
  while (endC < cols - 1 && charType(grid[r][endC + 1].ch) === type) endC++;

  return { startCol: startC + 1, endCol: endC + 1 }; // 转 1-based
}

/** 查找整行边界，返回 {startCol, endCol}（1-based） */
export function findLineBoundaries(row: number): { startCol: number; endCol: number } {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  const grid = buildGrid(cols, rows);
  const r = row - 1;
  if (r < 0 || r >= rows) return { startCol: 1, endCol: 1 };

  // 找行首（第一个非空格）
  let startC = 0;
  while (startC < cols && grid[r][startC].ch === " ") startC++;
  // 找行尾（最后一个非空格）
  let endC = cols - 1;
  while (endC >= 0 && grid[r][endC].ch === " ") endC--;
  if (endC < startC) { startC = 0; endC = 0; }

  return { startCol: startC + 1, endCol: endC + 1 };
}
