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
  inputHasRangeSelection,
  isPaintPending,
  normalizeStream,
  getStickyLine,
  putStickyLine,
  syncPaintViewFromLogical,
  type CellPos,
} from "./selection-model.js";
import { selCellSgr, bindSelFxPaint, selFxClear } from "./sel-fx.js";
import {
  pinHardwareCursorForIme,
  bindViewportFullPaint,
} from "../input/terminal-viewport.js";
import { invalidateClickTargetCache } from "../input/click-target.js";
import { perfInc } from "../hooks/perf.js";
import { notePaintFrame, noteUiPhase, noteGridBuild } from "../hooks/process-stats.js";
import { useStore } from "../state/store.js";
import {
  PAINT_FULL_MS,
  PAINT_FULL_STREAM_MS,
  PAINT_FULL_SCROLL_MS,
  PAINT_SEL_MS,
  CURSOR_BLINK_MS,
  TERM_BREAKPOINTS,
} from "../config/ui-constants.js";
import { isLiteNoCursorBlink } from "../config/lite-mode.js";
import { nativePaintDiff, type FlatFrame } from "./native-raster.js";
import { scrollPaintMs } from "../hooks/scroll-pace.js";

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

// 选区：静态/短闪 paint（无循环动画）
bindSelFxPaint(() => schedulePaint({ selectionOnly: true }));
// 视口恢复需要全量重绘
bindViewportFullPaint(() => schedulePaint({ full: true }));

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
  selFxClear();
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
/** 构建 cachedBuilt 时所基于的 lastGrid 引用（同引用则免重建） */
let cachedBuiltFrom: any[][] | null = null;
let cachedBuiltCols = 0;
let cachedBuiltRows = 0;
/** 上一帧选区覆盖的行（1-based），用于脏行合并 */
let prevSelRows: { r1: number; r2: number } | null = null;

function invalidateGridCache(): void {
  cachedBuilt = null;
  cachedBuiltFrom = null;
  cachedBuiltCols = 0;
  cachedBuiltRows = 0;
}

/**
 * 作废「已画出的帧」缓存。
 * 清屏 / 拉宽后若仍用 prevEncoded 做行 diff，会认为「未变」跳过写出，
 * 屏幕上留下空白或残影。调用后下一帧必须整屏重写。
 */
export function invalidatePaintCache(): void {
  prevEncodedLines = null;
  prevEncodedCols = 0;
  prevSelRows = null;
  paintCacheValid = false;
  invalidateGridCache();
}

/** 终端上帧缓冲是否仍可信（清屏/resize 后为 false） */
let paintCacheValid = true;

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
  // 启动插入光标闪烁时钟
  ensureCursorBlinkTimer();

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
    // 不在此处 invalidate：buildGrid 用 lastGrid 引用判断缓存；
    // 旧实现每帧 invalidate + isPaintPending 时 capture→N 次 buildGrid，滚动 ↑grd、帧率塌掉。
    // 仅 chat 拖选 / sticky 需要在新帧上补 lineCache；普通滚动留给 schedulePaint 一次 build。
    const needChatCapture =
      getActiveSel()?.mode === "chat" || getStickyAnchor()?.kind === "chat";
    if (needChatCapture) {
      syncPaintViewFromLogical();
      captureChatVisibleLines({ alsoSticky: true });
    } else if (isPaintPending()) {
      // 滚动中 paint 排队：只同步 metrics，不扫 grid
      syncPaintViewFromLogical();
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

/** ASCII 单码点宽 1，跳过昂贵的 stringWidth/ICU */
function cellWidth(ch: string): number {
  if (!ch) return 1;
  if (ch.length === 1) {
    const code = ch.charCodeAt(0);
    // 可打印 ASCII
    if (code >= 0x20 && code <= 0x7e) return 1;
    if (code === 0x09) return 1; // tab 当 1（上层已展开更好）
  }
  // 全角 / emoji / 组合字符走完整测量
  return stringWidth(ch) || 1;
}

export function buildGrid(cols: number, rows: number): GridCell[][] {
  // 同 lastGrid 引用 + 同尺寸 → 直接复用（同一 Ink 帧内 extract/paint 多次调用只建一次）
  if (
    cachedBuilt &&
    cachedBuiltFrom === lastGrid &&
    cachedBuiltCols === cols &&
    cachedBuiltRows === rows
  ) {
    perfInc("buildGridCacheHit");
    noteGridBuild(true);
    return cachedBuilt;
  }
  perfInc("buildGrid");
  noteGridBuild(false);

  // 复用同尺寸 grid 壳，减少滚动时每帧 new 数千对象（GC 压力）
  let grid: GridCell[][];
  if (cachedBuilt && cachedBuiltCols === cols && cachedBuiltRows === rows) {
    grid = cachedBuilt;
    for (let r = 0; r < rows; r++) {
      const row = grid[r]!;
      for (let c = 0; c < cols; c++) {
        const cell = row[c]!;
        cell.ch = " ";
        cell.sgr = "";
        cell.w = 1;
      }
    }
  } else {
    grid = new Array(rows);
    for (let r = 0; r < rows; r++) {
      const row: GridCell[] = new Array(cols);
      for (let c = 0; c < cols; c++) {
        row[c] = { ch: " ", sgr: "", w: 1 };
      }
      grid[r] = row;
    }
  }
  if (!lastGrid) {
    cachedBuilt = grid;
    cachedBuiltFrom = lastGrid;
    cachedBuiltCols = cols;
    cachedBuiltRows = rows;
    return grid;
  }
  for (let r = 0; r < Math.min(lastGrid.length, rows); r++) {
    const srcRow = lastGrid[r];
    if (!srcRow) continue;
    const dstRow = grid[r]!;
    for (let c = 0; c < Math.min(srcRow.length, cols); c++) {
      const cell = srcRow[c];
      if (!cell) continue;
      const ch = cell.value || " ";
      if (cell.value === "" && c > 0) {
        const d = dstRow[c]!;
        d.ch = "";
        d.sgr = "";
        d.w = 0;
        continue;
      }
      const w = cellWidth(ch);
      let sgr = "";
      if (cell.styles?.length) {
        for (const s of cell.styles) {
          if (s?.code) sgr += s.code;
        }
      }
      const d = dstRow[c]!;
      d.ch = ch;
      d.sgr = sgr;
      d.w = w;
      for (let k = 1; k < w && c + k < cols; k++) {
        const cont = dstRow[c + k]!;
        cont.ch = "";
        cont.sgr = sgr;
        cont.w = 0;
      }
    }
  }
  cachedBuilt = grid;
  cachedBuiltFrom = lastGrid;
  cachedBuiltCols = cols;
  cachedBuiltRows = rows;
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

/** 输入区块状光标：计算机蓝底 + 白字（与选区同色，光标≈选区） */
const CURSOR_BLOCK_SGR = "\x1b[0m\x1b[48;2;33;33;255m\x1b[38;2;255;255;255m";

// ── 插入光标闪烁（非选区时）────────────────────────────────
/** true = 显示蓝块；false = 熄灭（按普通字画） */
let cursorBlinkOn = true;
let cursorBlinkTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 仅重绘输入框行（光标闪烁）。
 * 禁止 full paint：旧实现每 530ms 整屏 encode + 写 stdout，空闲 UI CPU 可到 60%+。
 * 网格内容未变，只改 encode 相位；用 cachedBuilt 即可。
 */
function paintCursorBlinkRowsOnly(): void {
  if (!paintCacheValid || !cachedBuilt) {
    // 尚无稳定帧：跳过，等下次内容 full paint 再闪
    return;
  }
  // 光标闪也算一帧写出（通常只 1～几行）
  notePaintFrame();
  const cols = process.stdout.columns || TERM_BREAKPOINTS.fallbackCols;
  const rows = process.stdout.rows || TERM_BREAKPOINTS.fallbackRows;
  if (cachedBuilt.length < rows || (cachedBuilt[0]?.length ?? 0) < cols) {
    return;
  }
  const b = getInputBounds();
  if (!b || b.width <= 0 || b.height <= 0) return;
  const rLo = Math.max(1, Math.floor(b.top));
  const rHi = Math.min(rows, Math.floor(b.top + b.height - 1));
  if (rLo > rHi) return;

  let out = "\x1b[?25l";
  for (let r = rLo; r <= rHi; r++) {
    const line = encodeLine(cachedBuilt, r - 1, cols);
    out += `\x1b[${r};1H${themeBgSgr}\x1b[K${line}`;
    if (prevEncodedLines && prevEncodedLines.length === rows) {
      prevEncodedLines[r - 1] = line;
    }
  }
  out += "\x1b[0m\x1b[?25l";
  try {
    process.stdout.write(out);
  } catch {
    /* ignore */
  }
  pinHardwareCursorForIme();
}

function ensureCursorBlinkTimer(): void {
  // LITE：禁用闪烁定时器，避免空闲每 ~530ms 写输入行
  if (isLiteNoCursorBlink()) return;
  if (cursorBlinkTimer) return;
  cursorBlinkTimer = setInterval(() => {
    // 有输入选区时不闪：保持熄灭相位，避免选区上叠光标
    if (inputHasRangeSelection()) {
      if (cursorBlinkOn) {
        cursorBlinkOn = false;
        // 不强制 paint：选区本身会重绘
      }
      return;
    }
    cursorBlinkOn = !cursorBlinkOn;
    // 只重画输入行，禁止整屏 full paint
    paintCursorBlinkRowsOnly();
  }, CURSOR_BLINK_MS);
  if (typeof cursorBlinkTimer === "object" && "unref" in cursorBlinkTimer) {
    cursorBlinkTimer.unref();
  }
}

/** 光标是否应画成蓝块（闪烁相位） */
export function isCursorBlinkVisible(): boolean {
  if (isLiteNoCursorBlink()) return true; // 常亮，不闪
  return cursorBlinkOn;
}

/**
 * 用户移动/输入时重置为「亮」，避免打字时刚好灭掉。
 * InputBar onCursorChange / onChange 可调。
 */
export function notifyCursorActivity(): void {
  if (isLiteNoCursorBlink()) {
    cursorBlinkOn = true;
    return;
  }
  ensureCursorBlinkTimer();
  if (!cursorBlinkOn && !inputHasRangeSelection()) {
    cursorBlinkOn = true;
    schedulePaint({ full: true });
  } else {
    cursorBlinkOn = true;
  }
}

function encodeLine(grid: GridCell[][], r: number, cols: number): string {
  let line = "";
  let lastSgr = themeBgSgr || "\x1b[0m";
  let visW = 0;
  const row = grid[r];
  if (!row) return "";
  const screenRow1 = r + 1;
  for (let c = 0; c < cols && visW < cols; c++) {
    const cell = row[c]!;
    // 宽字符 continuation：跳过，宽度已算在主胞
    if (cell.w === 0) continue;
    const screenCol1 = c + 1;
    const ch = cell.ch === "" ? " " : cell.ch;

    if (inSel(screenRow1, screenCol1)) {
      // 合并相邻同色选区 SGR，减少每字 reset（宽字符/中文不易被拆坏）
      const selSgr = `\x1b[0m${selCellSgr(screenCol1)}`;
      if (selSgr !== lastSgr) {
        line += selSgr;
        lastSgr = selSgr;
      }
      line += ch;
      visW += cell.w;
    } else {
      const cellSgr = cell.sgr || "";
      // 输入槽反色软光标 → 计算机蓝块（与选区同色）；非选区时按相位闪烁
      // 标准编辑器：有非零宽选区时不画插入光标（只显示选区）
      const inv = sgrHasInverse(cellSgr);
      const useInputCursor =
        inv &&
        !inputHasRangeSelection() &&
        (inInputTextCell(screenRow1, screenCol1) || sgrLightBg(cellSgr));
      if (useInputCursor) {
        ensureCursorBlinkTimer();
        if (cursorBlinkOn) {
          if (lastSgr !== CURSOR_BLOCK_SGR) {
            line += CURSOR_BLOCK_SGR;
            lastSgr = CURSOR_BLOCK_SGR;
          }
          line += ch;
          visW += cell.w;
          continue;
        }
        // 熄灭相位：剥 inverse，按普通字画
        const stripped = cellSgr
          .replace(/\x1b\[7m/g, "")
          .replace(/\x1b\[27m/g, "");
        const hasBg = stripped.includes("48;");
        const targetSgr =
          !hasBg && themeBgSgr ? themeBgSgr + stripped : stripped || "\x1b[0m";
        const normalized = targetSgr.startsWith("\x1b[0m")
          ? targetSgr
          : `\x1b[0m${targetSgr}`;
        if (normalized !== lastSgr) {
          line += normalized;
          lastSgr = normalized;
        }
        line += ch;
        visW += cell.w;
        continue;
      }
      // 有选区时 Ink 仍可能吐反色格：剥掉 inverse，按普通字画，避免「光标+选区」叠影
      if (inv && inputHasRangeSelection() && inInputTextCell(screenRow1, screenCol1)) {
        const stripped = cellSgr
          .replace(/\x1b\[7m/g, "")
          .replace(/\x1b\[27m/g, "");
        const hasBg = stripped.includes("48;");
        const targetSgr = (!hasBg && themeBgSgr) ? themeBgSgr + stripped : (stripped || "\x1b[0m");
        const normalized = targetSgr.startsWith("\x1b[0m") ? targetSgr : `\x1b[0m${targetSgr}`;
        if (normalized !== lastSgr) {
          line += normalized;
          lastSgr = normalized;
        }
        line += ch;
        visW += cell.w;
        continue;
      }
      const hasBg = cellSgr.includes("48;");
      const targetSgr = (!hasBg && themeBgSgr) ? themeBgSgr + cellSgr : (cellSgr || "\x1b[0m");
      const normalized = targetSgr.startsWith("\x1b[0m") ? targetSgr : `\x1b[0m${targetSgr}`;
      if (normalized !== lastSgr) {
        line += normalized;
        lastSgr = normalized;
      }
      line += ch;
      visW += cell.w;
    }
  }
  // 行末复位：SGR + 强制关闭 OSC 8 超链接（NavBar 手型链），
  // 否则部分终端会把未闭合 link 画成整行/整屏虚线下划线。
  if (lastSgr !== "\x1b[0m") line += "\x1b[0m";
  line += "\x1b]8;;\x1b\\";
  return line;
}

function selRowRange(screenRows: number): { r1: number; r2: number } | null {
  return dirtyRowsForPaint(screenRows);
}

/**
 * 全量或脏行写出。
 * selectionOnly=true 且网格未变时只重画 (旧选区∪新选区) 行，显著减闪。
 * forceAllLines / 缓存失效 / 尺寸变化 → 整屏重写（清屏、拉宽后必须）。
 */
export function renderWithSelection(
  cols: number,
  rows: number,
  opts: { selectionOnly?: boolean; forceAllLines?: boolean } = {},
): void {
  const grid = buildGrid(cols, rows);
  const nextRange = selRowRange(rows);

  // 仅选区变：脏行 = 旧∪新（不碰 \x1b[H 全屏，防闪）
  // 缓存已失效时不能只画选区行，否则清屏后大片空白
  if (opts.selectionOnly && paintCacheValid) {
    perfInc("paintSel");
    notePaintFrame();
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
    // 选区重绘也钉一次 IME，避免光标漂到右下角
    pinHardwareCursorForIme();
    return;
  }

  // 全量帧：按行 diff，只写变化行（StatusBar 每秒时钟不再整屏重刷）
  // 清屏/resize 后 paintCacheValid=false → 必须整屏写出
  perfInc("paintFull");
  notePaintFrame();
  const sameSize =
    paintCacheValid &&
    !!prevEncodedLines &&
    prevEncodedLines.length === rows &&
    prevEncodedCols === cols;
  const forceAll = opts.forceAllLines || !sameSize || !paintCacheValid;
  const scrolling = !!useStore.getState().scrollActive;

  // 滚动中：跳过 Rust 路径（grid→flat 再拷一遍 cols*rows 字符串，往往比 JS encode 更贵）
  // 静止时：Rust encode+diff 可减轻主线程
  if (!scrolling) {
    const flat = gridToFlatFrame(grid, cols, rows);
    const native = flat
      ? nativePaintDiff(flat, themeBgSgr, prevEncodedLines, forceAll)
      : null;
    if (native && native.native) {
      if (native.out) {
        try {
          process.stdout.write(native.out);
        } catch {
          /* ignore */
        }
      }
      prevEncodedLines = native.lines;
      prevEncodedCols = cols;
      prevSelRows = nextRange;
      paintCacheValid = true;
      invalidateClickTargetCache();
      pinHardwareCursorForIme();
      return;
    }
  }

  // JS 路径：先 encode 行，再与上一帧 diff（滚动时通常几乎全脏，但无双倍 flat 拷贝）
  const lines: string[] = new Array(rows);
  for (let r = 0; r < rows; r++) {
    lines[r] = encodeLine(grid, r, cols);
  }
  let out = "\x1b[?25l";
  let dirty = 0;
  if (forceAll) {
    out = "\x1b[H\x1b[?25l";
    for (let r = 0; r < rows; r++) {
      out += `\x1b[${r + 1};1H${themeBgSgr}\x1b[K${lines[r]}`;
      dirty++;
    }
  } else {
    for (let r = 0; r < rows; r++) {
      if (prevEncodedLines![r] === lines[r]) continue;
      out += `\x1b[${r + 1};1H${themeBgSgr}\x1b[K${lines[r]}`;
      dirty++;
    }
  }
  if (dirty > 0) {
    out += "\x1b[0m\x1b[?25l";
    process.stdout.write(out);
  }
  prevEncodedLines = lines;
  prevEncodedCols = cols;
  prevSelRows = nextRange;
  paintCacheValid = true;
  if (!scrolling) {
    invalidateClickTargetCache();
  }
  pinHardwareCursorForIme();
}

/** 复用缓冲区，避免滚动时每帧 new Array(cols*rows) 三次 */
let flatChBuf: string[] | null = null;
let flatSgrBuf: string[] | null = null;
let flatWBuf: number[] | null = null;
let flatBufN = 0;

/** GridCell[][] → Rust FlatFrame（失败返回 null） */
function gridToFlatFrame(
  grid: GridCell[][],
  cols: number,
  rows: number,
): FlatFrame | null {
  try {
    const n = cols * rows;
    if (!flatChBuf || flatBufN !== n) {
      flatChBuf = new Array(n);
      flatSgrBuf = new Array(n);
      flatWBuf = new Array(n);
      flatBufN = n;
    }
    const ch = flatChBuf;
    const sgr = flatSgrBuf!;
    const w = flatWBuf!;
    let i = 0;
    for (let r = 0; r < rows; r++) {
      const row = grid[r];
      for (let c = 0; c < cols; c++) {
        const cell = row?.[c];
        ch[i] = cell?.ch ?? " ";
        sgr[i] = cell?.sgr ?? "";
        w[i] = cell?.w ?? 1;
        i++;
      }
    }
    return { cols, rows, ch, sgr, w };
  } catch {
    return null;
  }
}

/** 上一帧编码后的行（用于 diff paint） */
let prevEncodedLines: string[] | null = null;
let prevEncodedCols = 0;

// ── 统一调度：合并 Ink onRender 与鼠标 paint，避免双刷闪烁 ──
let paintTimer: ReturnType<typeof setTimeout> | null = null;
let paintWantSelectionOnly = true;
let paintForceFull = false;
/** 当前排队的 full paint 延迟（用于 hover 时缩短等待） */
let paintQueuedDelay = 0;

export function schedulePaint(opts: { selectionOnly?: boolean; full?: boolean } = {}): void {
  if (opts.full) {
    paintForceFull = true;
    paintWantSelectionOnly = false;
  } else if (!opts.selectionOnly) {
    paintWantSelectionOnly = false;
  }

  const st = useStore.getState();
  const streaming = !!st.streaming;
  const scrolling = !!st.scrollActive;
  const delay =
    paintForceFull || !paintWantSelectionOnly
      ? scrolling
        ? scrollPaintMs(PAINT_FULL_SCROLL_MS)
        : streaming
          ? PAINT_FULL_STREAM_MS
          : PAINT_FULL_MS
      : PAINT_SEL_MS;

  // 已有 full 在排：仅当新 delay 更短时重排（hover 亮起不该干等滚动档 32～48ms）
  if (paintTimer && paintForceFull) {
    if (delay >= paintQueuedDelay) return;
    clearTimeout(paintTimer);
    paintTimer = null;
  } else if (paintTimer) {
    if (!opts.selectionOnly || opts.full) {
      clearTimeout(paintTimer);
      paintTimer = null;
    } else {
      return; // 已有 selection paint 在排
    }
  }

  paintQueuedDelay = delay;
  paintTimer = setTimeout(() => {
    paintTimer = null;
    paintQueuedDelay = 0;
    const cols = process.stdout.columns || TERM_BREAKPOINTS.fallbackCols;
    const rows = process.stdout.rows || TERM_BREAKPOINTS.fallbackRows;
    // 尺寸变了：旧 prevEncoded 不可信（尤其是拉宽后右侧未写）
    if (
      prevEncodedCols !== cols ||
      (prevEncodedLines && prevEncodedLines.length !== rows)
    ) {
      invalidatePaintCache();
    }
    const selectionOnly = paintWantSelectionOnly && !paintForceFull && paintCacheValid;
    const forceAll = paintForceFull && !paintCacheValid;
    paintWantSelectionOnly = true;
    paintForceFull = false;
    renderWithSelection(cols, rows, {
      selectionOnly,
      forceAllLines: forceAll || !paintCacheValid,
    });
  }, delay);
}

/** Ink onRender / 内容变化：全量帧 */
export function scheduleFullPaint(): void {
  schedulePaint({ full: true });
}

/**
 * 清屏后 / 强制立刻重绘：作废 diff 缓存并排队全量帧。
 * （供 clearTerminalScreen、resize 使用）
 */
export function requestScreenRefresh(opts?: { clear?: boolean }): void {
  if (opts?.clear && process.stdout.isTTY) {
    try {
      process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
    } catch {
      /* ignore */
    }
  }
  invalidatePaintCache();
  scheduleFullPaint();
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

export interface FullScreenDumpOpts {
  /** 是否去掉末尾连续空行（默认 true，便于粘贴） */
  trimTrailingEmpty?: boolean;
  /** 是否加尺寸/时间头尾（默认 true，方便对照调试） */
  withHeader?: boolean;
}

/**
 * 从当前显存（lastGrid / 帧缓冲）抽出整屏纯文本——相当于「文字截图」。
 * 不含 ANSI 颜色，只保留字符与换行，便于粘贴给 AI 排查 UI。
 */
export function extractFullScreen(opts: FullScreenDumpOpts = {}): string {
  const trimTrailing = opts.trimTrailingEmpty !== false;
  const withHeader = opts.withHeader !== false;
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  const grid = buildGrid(cols, rows);
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    const row = grid[r];
    if (!row) {
      lines.push("");
      continue;
    }
    const chars: string[] = [];
    for (let c = 0; c < cols; c++) {
      const cell = row[c]!;
      if (cell.w === 0) continue; // 宽字符 continuation
      chars.push(cell.ch || " ");
    }
    lines.push(chars.join("").replace(/\s+$/, ""));
  }
  if (trimTrailing) {
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
  }
  const body = lines.join("\n");
  if (!withHeader) return body;
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  const inkRows = lastGrid?.length ?? 0;
  const inkCols = lastGrid?.[0]?.length ?? 0;
  return [
    `── maou screen dump ${ts} · tty ${cols}×${rows} · ink ${inkCols}×${inkRows} ──`,
    body,
    `── end dump (${lines.length} lines, ${body.length} chars) ──`,
  ].join("\n");
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
