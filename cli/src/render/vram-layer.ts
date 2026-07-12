/**
 * vram-layer —— 从 Ink 内部 cell 网格（真·帧缓冲）读像素，叠选区后写出。
 *
 * 选区模式见 selection-model.ts（chat 内容锚定 / global 显存 / input 输入框）。
 * 性能：内容变全量；仅选区变脏行重绘；schedulePaint ~60fps 合并。
 */

import { PassThrough } from "node:stream";
import stringWidth from "string-width";
import {
  cellInSelection,
  clearActiveSel,
  dirtyRowsForPaint,
  getActiveSel,
  getChatViewMetrics,
  getInputBounds,
  getStickyAnchor,
  isPaintPending,
  normalizeStream,
  getStickyLine,
  putStickyLine,
  syncPaintViewFromLogical,
  type CellPos,
} from "./selection-model.js";

export type { CellPos };
export type Selection = { start: CellPos; end: CellPos } | null;

/** InputBar 注册：用 inputDraft+inputTextSel 切片，避免 VRAM 乱码 */
let inputTextExtractFn: (() => string | null) | null = null;
export function setInputTextExtractFn(fn: (() => string | null) | null): void {
  inputTextExtractFn = fn;
}

export interface GridCell {
  ch: string;
  sgr: string;
  w: number;
}

const SEL_BG = "\x1b[48;2;37;99;235m";
const SEL_FG = "\x1b[38;2;255;255;255m";

/** 兼容旧 API：有活动选区则返回屏幕近似范围 */
export function getSelection(): Selection {
  const a = getActiveSel();
  if (!a) return null;
  if (a.mode === "global" || a.mode === "input") {
    return { start: { ...a.a }, end: { ...a.b } };
  }
  // chat：映射到当前 paint 视口可见部分
  const { top, contentTopY } = getChatViewMetrics("paint");
  return {
    start: { row: top + Math.max(0, a.aY - contentTopY), col: a.aCol },
    end: { row: top + Math.max(0, a.bY - contentTopY), col: a.bCol },
  };
}

export function clearSelection(): void {
  if (!getActiveSel()) return;
  clearActiveSel();
  schedulePaint({ selectionOnly: true });
}

export function hasSelection(): boolean {
  return getActiveSel() !== null;
}

/** 通知选区已更新（脏行重绘） */
export function notifySelectionChanged(): void {
  schedulePaint({ selectionOnly: true });
}

export function inSel(r: number, c: number): boolean {
  return cellInSelection(r, c);
}

let themeBgSgr = "";
export function setThemeBg(bg: string | null): void {
  if (!bg) { themeBgSgr = ""; return; }
  const m = /^#?([0-9a-f]{6})$/i.exec(bg.trim());
  if (!m) { themeBgSgr = ""; return; }
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
  themeBgSgr = `\x1b[48;2;${r};${g};${b}m`;
}

// ── Ink patch ─────────────────────────────────────────────
let OutputProto: any = null;
let lastInkOutput = "";
let lastGrid: any[][] | null = null;
let origGet: any = null;
let styledCharsToString: ((chars: any[]) => string) | null = null;
let sliceAnsi: ((input: string, begin: number, end: number) => string) | null = null;

let cachedBuilt: GridCell[][] | null = null;
let cachedBuiltKey = "";
/** 上一帧选区覆盖的行（1-based），用于脏行合并 */
let prevSelRows: { r1: number; r2: number } | null = null;

function invalidateGridCache(): void {
  cachedBuilt = null;
  cachedBuiltKey = "";
}

export async function initVramLayer() {
  if (origGet) return;
  const { createRequire } = await import("node:module");
  const { pathToFileURL } = await import("node:url");
  const req = createRequire(import.meta.url);
  const inkPath = req.resolve("ink");
  const outputJsPath = inkPath.replace(/index\.js$/, "output.js");
  const mod = await import(pathToFileURL(outputJsPath).href);
  OutputProto = mod.default.prototype;
  origGet = OutputProto.get;
  const reqFromInk = createRequire(pathToFileURL(outputJsPath).href);
  const sliceAnsiPath = reqFromInk.resolve("slice-ansi");
  const sliceAnsiMod = await import(pathToFileURL(sliceAnsiPath).href);
  sliceAnsi = sliceAnsiMod.default ?? sliceAnsiMod;
  styledCharsToString = (await import("@alcalzone/ansi-tokenize")).styledCharsToString;

  OutputProto.get = function () {
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
        if (clip) {
          const clipHorizontally = typeof clip?.x1 === "number" && typeof clip?.x2 === "number";
          const clipVertically = typeof clip?.y1 === "number" && typeof clip?.y2 === "number";
          if (clipHorizontally) {
            const width = this.caches.getWidestLine(text);
            if (x + width < clip.x1 || x > clip.x2) continue;
          }
          if (clipVertically) {
            const height = lines.length;
            if (y + height < clip.y1 || y > clip.y2) continue;
          }
          if (clipHorizontally) {
            lines = lines.map((line: string) => {
              const from = x < clip.x1 ? clip.x1 - x : 0;
              const width = this.caches.getStringWidth(line);
              const to = x + width > clip.x2 ? clip.x2 - x : width;
              return sliceAnsi!(line, from, to);
            });
            if (x < clip.x1) x = clip.x1;
          }
          if (clipVertically) {
            const from = y < clip.y1 ? clip.y1 - y : 0;
            const height = lines.length;
            const to = y + height > clip.y2 ? clip.y2 - y : height;
            lines = lines.slice(from, to);
            if (y < clip.y1) y = clip.y1;
          }
        }
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
    lastGrid = output;
    invalidateGridCache();
    // 滚动后 Ink 新帧就绪：同步 paint metrics，补采 lineCache（不再二次 schedule 造成闪烁）
    if (isPaintPending() || getActiveSel()?.mode === "chat" || getStickyAnchor()?.kind === "chat") {
      syncPaintViewFromLogical();
      captureChatVisibleLines({ alsoSticky: true });
    }
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
  if (typeof fake.setMaxListeners === "function") fake.setMaxListeners(64);
  fake.write = () => true;
  fake.setRawMode = () => fake;
  fake.isRaw = false;
  fake.ref = () => fake;
  fake.unref = () => fake;
  fake.resume = () => fake;
  return fake;
}

export function snapToCell(row: number, col: number, grid?: GridCell[][]): CellPos {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  const g = grid ?? buildGrid(cols, rows);
  let r = Math.max(1, Math.min(rows, row));
  let c = Math.max(1, Math.min(cols, col));
  const rr = r - 1, cc = c - 1;
  if (rr >= 0 && rr < g.length && cc >= 0 && cc < (g[rr]?.length ?? 0)) {
    let c0 = cc;
    while (c0 > 0 && g[rr]![c0]!.w === 0) c0--;
    c = c0 + 1;
  }
  return { row: r, col: c };
}

export function buildGrid(cols: number, rows: number): GridCell[][] {
  // 用 lastGrid 引用 identity + 尺寸做 key；内容更新时 lastGrid 换引用或 invalidate
  const key = `${cols}x${rows}:${lastGrid ? lastGrid.length : 0}x${lastGrid?.[0]?.length ?? 0}:${lastInkOutput.length}`;
  if (cachedBuilt && cachedBuiltKey === key) return cachedBuilt;

  const grid: GridCell[][] = [];
  for (let r = 0; r < rows; r++) {
    grid.push(new Array(cols).fill(null).map(() => ({ ch: " ", sgr: "", w: 1 })));
  }
  if (!lastGrid) {
    cachedBuilt = grid;
    cachedBuiltKey = key;
    return grid;
  }
  for (let r = 0; r < Math.min(lastGrid.length, rows); r++) {
    const srcRow = lastGrid[r];
    if (!srcRow) continue;
    for (let c = 0; c < Math.min(srcRow.length, cols); c++) {
      const cell = srcRow[c];
      if (!cell) continue;
      const ch = cell.value || " ";
      if (cell.value === "" && c > 0) {
        if (grid[r]![c]!.w > 0) grid[r]![c] = { ch: "", sgr: "", w: 0 };
        continue;
      }
      const w = stringWidth(ch) || 1;
      let sgr = "";
      if (cell.styles?.length) {
        for (const s of cell.styles) {
          if (s?.code) sgr += s.code;
        }
      }
      grid[r]![c] = { ch, sgr, w };
      for (let k = 1; k < w && c + k < cols; k++) {
        grid[r]![c + k] = { ch: "", sgr, w: 0 };
      }
    }
  }
  cachedBuilt = grid;
  cachedBuiltKey = key;
  return grid;
}

/** SGR 是否含 reverse/inverse（TextArea 软光标 \x1b[7m） */
function sgrHasInverse(sgr: string): boolean {
  if (!sgr) return false;
  // 独立参数 7（非 17/27/37…）；且未被 27 关掉
  const has7 = /(?:\x1b\[|;|^)(?:\d+;)*7(?:;\d+)*m/.test(sgr);
  const has27 = /(?:\x1b\[|;|^)(?:\d+;)*27(?:;\d+)*m/.test(sgr);
  return has7 && !has27;
}

/** 背景是否偏亮（输入槽 #B0B0B0 等）—— 亮底上反色光标会融掉 */
function sgrLightBg(sgr: string): boolean {
  const m = /48;2;(\d+);(\d+);(\d+)/.exec(sgr);
  if (!m) return false;
  return (+m[1]! + +m[2]! + +m[3]!) / 3 >= 160;
}

/** 是否在可输入文本列（用于亮底黑光标） */
function inInputTextCell(screenRow1: number, screenCol1: number): boolean {
  const b = getInputBounds();
  if (!b || b.width <= 0 || b.height <= 0) return false;
  if (screenRow1 < b.top || screenRow1 >= b.top + b.height) return false;
  const c0 = b.left + (b.textColOffset ?? 4);
  const c1 = b.left + b.width - 2;
  return screenCol1 >= c0 && screenCol1 <= c1;
}

/** 亮底输入区的块状黑光标 */
const CURSOR_BLOCK_SGR = "\x1b[0m\x1b[48;2;0;0;0m\x1b[38;2;255;255;255m";

function encodeLine(grid: GridCell[][], r: number, cols: number): string {
  let line = "";
  let lastSgr = themeBgSgr || "\x1b[0m";
  let visW = 0;
  const row = grid[r];
  if (!row) return "";
  const screenRow1 = r + 1;
  for (let c = 0; c < cols && visW < cols; c++) {
    const cell = row[c]!;
    if (cell.w === 0) continue;
    const screenCol1 = c + 1;
    if (inSel(screenRow1, screenCol1)) {
      line += `\x1b[0m${SEL_BG}${SEL_FG}${cell.ch}\x1b[0m`;
      lastSgr = "\x1b[0m";
      visW += cell.w;
    } else {
      const cellSgr = cell.sgr || "";
      // 输入槽亮底 + 反色软光标 → 改画黑块光标，避免和 #B0B0B0 融在一起
      const inv = sgrHasInverse(cellSgr);
      const useBlackCursor =
        inv && (inInputTextCell(screenRow1, screenCol1) || sgrLightBg(cellSgr));
      if (useBlackCursor) {
        if (lastSgr !== CURSOR_BLOCK_SGR) {
          line += CURSOR_BLOCK_SGR;
          lastSgr = CURSOR_BLOCK_SGR;
        }
        // 空格光标画成实心块感：用满宽空白即可（黑底已够醒目）
        line += cell.ch === "" ? " " : cell.ch;
        visW += cell.w;
        continue;
      }
      const hasBg = cellSgr.includes("48;");
      const targetSgr = (!hasBg && themeBgSgr) ? themeBgSgr + cellSgr : (cellSgr || "\x1b[0m");
      if (targetSgr !== lastSgr) {
        line += `\x1b[0m${targetSgr}`;
        lastSgr = targetSgr;
      }
      line += cell.ch;
      visW += cell.w;
    }
  }
  return line;
}

function selRowRange(screenRows: number): { r1: number; r2: number } | null {
  return dirtyRowsForPaint(screenRows);
}

/**
 * 全量或脏行写出。
 * selectionOnly=true 且网格未变时只重画 (旧选区∪新选区) 行，显著减闪。
 */
export function renderWithSelection(
  cols: number,
  rows: number,
  opts: { selectionOnly?: boolean } = {},
): void {
  const grid = buildGrid(cols, rows);
  const nextRange = selRowRange(rows);

  // 仅选区变：脏行 = 旧∪新（不碰 \x1b[H 全屏，防闪）
  if (opts.selectionOnly) {
    let rLo = rows + 1;
    let rHi = 0;
    const add = (a: number, b: number) => {
      rLo = Math.min(rLo, a);
      rHi = Math.max(rHi, b);
    };
    if (prevSelRows) add(prevSelRows.r1, prevSelRows.r2);
    if (nextRange) add(nextRange.r1, nextRange.r2);
    if (rLo > rHi) {
      prevSelRows = nextRange;
      return;
    }
    rLo = Math.max(1, rLo);
    rHi = Math.min(rows, rHi);
    let out = "\x1b[?25l";
    for (let r = rLo; r <= rHi; r++) {
      const line = encodeLine(grid, r - 1, cols);
      out += `\x1b[${r};1H${themeBgSgr}\x1b[K${line}`;
    }
    out += "\x1b[0m\x1b[?25l";
    process.stdout.write(out);
    prevSelRows = nextRange;
    return;
  }

  // 全量
  let out = "\x1b[H\x1b[?25l";
  for (let r = 0; r < rows; r++) {
    const line = encodeLine(grid, r, cols);
    out += `\x1b[${r + 1};1H${themeBgSgr}\x1b[K${line}`;
  }
  out += "\x1b[0m\x1b[?25l";
  process.stdout.write(out);
  prevSelRows = nextRange;
}

// ── 统一调度：合并 Ink onRender 与鼠标 paint，避免双刷闪烁 ──
let paintTimer: ReturnType<typeof setTimeout> | null = null;
let paintWantSelectionOnly = true;
let paintForceFull = false;
const PAINT_MIN_MS = 16; // ~60fps

export function schedulePaint(opts: { selectionOnly?: boolean; full?: boolean } = {}): void {
  if (opts.full) {
    paintForceFull = true;
    paintWantSelectionOnly = false;
  } else if (!opts.selectionOnly) {
    paintWantSelectionOnly = false;
  }
  // selectionOnly 且已有 full 排队 → 保持 full
  if (paintTimer) return;
  paintTimer = setTimeout(() => {
    paintTimer = null;
    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;
    const selectionOnly = paintWantSelectionOnly && !paintForceFull;
    paintWantSelectionOnly = true;
    paintForceFull = false;
    renderWithSelection(cols, rows, { selectionOnly });
  }, PAINT_MIN_MS);
}

/** Ink onRender / 内容变化：全量帧 */
export function scheduleFullPaint(): void {
  schedulePaint({ full: true });
}

/** 从当前帧缓冲抽一行纯文本（1-based screen row） */
export function extractScreenLine(screenRow1: number): string {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  const grid = buildGrid(cols, rows);
  const r = screenRow1 - 1;
  if (r < 0 || r >= rows) return "";
  const chars: string[] = [];
  for (let c = 0; c < cols; c++) {
    const cell = grid[r]![c]!;
    if (cell.w === 0) continue;
    chars.push(cell.ch);
  }
  return chars.join("").replace(/\s+$/, "");
}

export interface CaptureOpts {
  /** 同时写入 stickyLineCache（Shift 跨滚轮用） */
  alsoSticky?: boolean;
  /**
   * 只填充尚未缓存的 absY，不覆盖已有（防 paint 未同步时写错键）。
   * 默认 false：当前可见行以最新帧为准覆盖。
   */
  fillOnly?: boolean;
  /**
   * 强制用 paint metrics（默认）。若 false 且 paintPending 则跳过采集。
   */
  requireSynced?: boolean;
}

/**
 * 采集 chat 可见行进 lineCache。
 * 始终用 paint metrics（与 lastGrid 对齐）；滚动前先 capture，再只改 logical。
 *
 * 重要：对已缓存的 absY 默认不覆盖（fillOnly 语义），避免：
 *  - 往上滚时下方滚出内容被后续错位帧盖成框线/「回到最底部」
 *  - chatBottom 过大把 chrome 行写进正文 absY
 */
export function captureChatVisibleLines(opts: CaptureOpts = {}): void {
  void opts.requireSynced;
  const { top, bottom, contentTopY } = getChatViewMetrics("paint");
  if (bottom < top) return;
  const sel = getActiveSel();
  const sticky = getStickyAnchor()?.kind === "chat" || opts.alsoSticky;
  // 拖选过程默认只补洞；显式 fillOnly:false 才强制刷新可见行
  const fillOnly = opts.fillOnly !== false;

  for (let sr = top; sr <= bottom; sr++) {
    const ay = contentTopY + (sr - top);
    if (!sel && !sticky) continue;
    if (sel?.mode && sel.mode !== "chat" && !sticky) continue;

    const text = extractScreenLine(sr);
    // 跳过明显 chrome，绝不写入 cache
    if (/回到最底部/.test(text)) continue;

    if (sel?.mode === "chat") {
      const prev = sel.lineCache.get(ay);
      if (!fillOnly || prev === undefined) {
        sel.lineCache.set(ay, text);
      } else if (prev.trim() === "" && text.trim() !== "") {
        // 空占位可被正文替换
        sel.lineCache.set(ay, text);
      }
    }
    if (sticky || sel?.mode === "chat") {
      putStickyLine(ay, text);
    }
  }
}

/**
 * 提取选区文本：
 *  - chat：lineCache（滚动过程采集）+ 当前可见补洞
 *  - input：优先 store.inputDraft + inputTextSel 字符切片（可靠、无乱码）
 *  - global：当前帧缓冲流式提取
 */
export function extractSelection(): string {
  const sel = getActiveSel();
  if (!sel) return "";

  if (sel.mode === "chat") {
    // 补采当前可见（只填洞，不盖已滚出的缓存）
    if (!isPaintPending()) captureChatVisibleLines({ alsoSticky: true });
    const { y1, y2 } = normalizeStream(sel.aY, sel.aCol, sel.bY, sel.bCol);
    const lines: string[] = [];
    for (let y = y1; y <= y2; y++) {
      let t = sel.lineCache.get(y) ?? getStickyLine(y);
      if (t === undefined) {
        const sr = absYToScreenIfVisible(y);
        if (sr !== null && !isPaintPending()) {
          t = extractScreenLine(sr);
          if (!/回到最底部/.test(t)) {
            sel.lineCache.set(y, t);
            putStickyLine(y, t);
          } else {
            t = "";
          }
        } else {
          t = "";
        }
      }
      lines.push(t);
    }
    // 只去首尾空行，保留中间空行（消息间距）
    while (lines.length && lines[0] === "") lines.shift();
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    return lines.join("\n");
  }

  // input：字符索引优先（避免 VRAM 含 ❯/蓝底/半截 CSI 乱码）
  if (sel.mode === "input" && inputTextExtractFn) {
    const t = inputTextExtractFn();
    if (t !== null) return t;
  }

  // global / input fallback：屏幕流式
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  const grid = buildGrid(cols, rows);
  const a = sel.a, b = sel.b;
  let { y1: r1, c1, y2: r2, c2 } = normalizeStream(a.row, a.col, b.row, b.col);
  r1 = Math.max(0, Math.min(rows - 1, r1 - 1));
  r2 = Math.max(0, Math.min(rows - 1, r2 - 1));
  c1 = Math.max(0, Math.min(cols - 1, c1 - 1));
  c2 = Math.max(0, Math.min(cols - 1, c2 - 1));
  if (grid[r1]) while (c1 > 0 && grid[r1]![c1]!.w === 0) c1--;
  if (grid[r2]) while (c2 > 0 && grid[r2]![c2]!.w === 0) c2--;

  const bounds = sel.mode === "input" ? getInputBounds() : null;
  const lines: string[] = [];
  for (let r = r1; r <= r2; r++) {
    const row = grid[r]!;
    let cs: number, ce: number;
    if (r1 === r2) { cs = c1; ce = c2; }
    else if (r === r1) { cs = c1; ce = cols - 1; }
    else if (r === r2) { cs = 0; ce = c2; }
    else { cs = 0; ce = cols - 1; }
    // input：夹到文字区列
    if (bounds) {
      const minC = bounds.left + bounds.textColOffset - 1;
      const maxC = bounds.left + bounds.width - 2;
      if (r1 === r2) {
        cs = Math.max(cs, minC);
        ce = Math.min(ce, maxC);
      } else if (r === r1) {
        cs = Math.max(cs, minC);
        ce = maxC;
      } else if (r === r2) {
        cs = minC;
        ce = Math.min(ce, maxC);
      } else {
        cs = minC;
        ce = maxC;
      }
    }
    const chars: string[] = [];
    for (let c = cs; c <= ce; c++) {
      if (c < 0 || c >= cols) continue;
      const cell = row[c]!;
      if (cell.w === 0) continue;
      chars.push(cell.ch);
    }
    lines.push(chars.join("").replace(/\s+$/, ""));
  }
  while (lines.length && lines[0] === "") lines.shift();
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

function absYToScreenIfVisible(absY: number): number | null {
  const { top, bottom, contentTopY } = getChatViewMetrics("paint");
  const sr = top + (absY - contentTopY);
  if (sr < top || sr > bottom) return null;
  return sr;
}

function charType(ch: string): "word" | "cjk" | "other" {
  if (ch === " " || ch === "") return "other";
  const code = ch.codePointAt(0) ?? 0;
  if (code >= 0x4e00 && code <= 0x9fff) return "cjk";
  if (code >= 0x3400 && code <= 0x4dbf) return "cjk";
  if (code >= 0x3000 && code <= 0x30ff) return "cjk";
  if (code >= 0xff00 && code <= 0xffef) return "cjk";
  if (/[a-zA-Z0-9_]/.test(ch)) return "word";
  return "other";
}

export function findWordAt(row: number, col: number): { startCol: number; endCol: number } {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  const grid = buildGrid(cols, rows);
  const snapped = snapToCell(row, col, grid);
  const r = snapped.row - 1;
  const c = snapped.col - 1;
  if (r < 0 || r >= rows || c < 0 || c >= cols) {
    return { startCol: snapped.col, endCol: snapped.col };
  }
  const type = charType(grid[r]![c]!.ch);
  if (type === "other") return { startCol: snapped.col, endCol: snapped.col };

  let startC = c;
  while (startC > 0) {
    const prev = grid[r]![startC - 1]!;
    if (prev.w === 0) { startC--; continue; }
    if (charType(prev.ch) !== type) break;
    startC--;
  }
  while (startC < cols - 1 && grid[r]![startC]!.w === 0) startC++;

  let endC = c;
  while (endC < cols - 1) {
    const next = grid[r]![endC + 1]!;
    if (next.w === 0) { endC++; continue; }
    if (charType(next.ch) !== type) break;
    endC++;
  }
  return { startCol: startC + 1, endCol: endC + 1 };
}

export function findLineBoundaries(row: number): { startCol: number; endCol: number } {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  const grid = buildGrid(cols, rows);
  const r = Math.max(0, Math.min(rows - 1, row - 1));
  let startC = 0;
  while (startC < cols && (grid[r]![startC]!.ch === " " || grid[r]![startC]!.w === 0)) startC++;
  let endC = cols - 1;
  while (endC >= 0 && (grid[r]![endC]!.ch === " " || grid[r]![endC]!.w === 0)) endC--;
  if (endC < startC) { startC = 0; endC = 0; }
  return { startCol: startC + 1, endCol: Math.max(startC, endC) + 1 };
}

export function selectionHasContent(): boolean {
  return extractSelection().trim().length > 0;
}
