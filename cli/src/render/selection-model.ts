/**
 * 三种选区模式（业务层）
 *
 * chat   —— 起点在上下文框内：内容锚定 absY，可边缘自动滚，复制从起点到松手（含滚出视野的行）
 * global —— 起点在上下文框外：纯屏幕/显存，不滚对话，复制当前整屏可见区任意流式选区
 * input  —— 起点在输入框：字符索引选区，只画输入框内，复制/删除/替换走输入业务
 *
 * paintView vs logicalView：
 *  - logical：鼠标事件立刻更新（scroll 后立刻能算新 absY）
 *  - paint：仅在 Ink lastGrid 与滚动位置同步后更新（避免蓝底/lineCache 键错位导致闪烁与复制截断）
 */

export type SelMode = "chat" | "global" | "input" | null;

export type CellPos = { row: number; col: number };

export interface ChatViewMetrics {
  /** 上下文视口顶/底（屏幕 1-based） */
  top: number;
  bottom: number;
  /** 视口顶对应的内容绝对行 contentTopY = maxScroll - offset */
  contentTopY: number;
  maxScroll: number;
  offset: number;
}

export interface ChatSel {
  mode: "chat";
  aY: number;
  aCol: number;
  bY: number;
  bCol: number;
  /** absY → 该内容行文本（滚动过程中采集） */
  lineCache: Map<number, string>;
}

export interface GlobalSel {
  mode: "global";
  a: CellPos;
  b: CellPos;
}

export interface InputSel {
  mode: "input";
  /** 屏幕坐标仅用于高亮，业务以 store.inputTextSel 为准 */
  a: CellPos;
  b: CellPos;
}

export type ActiveSel = ChatSel | GlobalSel | InputSel | null;

const emptyView = (): ChatViewMetrics => ({
  top: 2,
  bottom: 20,
  contentTopY: 0,
  maxScroll: 0,
  offset: 0,
});

let active: ActiveSel = null;
/** 鼠标映射用（可超前于帧缓冲） */
let logicalView: ChatViewMetrics = emptyView();
/** 绘制/采帧用（与 lastGrid 同步） */
let paintView: ChatViewMetrics = emptyView();
/** 有未同步的 scroll：paint 仍用旧 metrics，等 Output.get 再 sync */
let paintPending = false;

/** 输入框屏幕矩形（1-based left/top，用于限制 input 蓝底不溢出） */
let inputBounds: { left: number; top: number; width: number; height: number; textColOffset: number } | null = null;

/** Shift 锚点（chat abs / global screen） */
let stickyAnchor: { kind: "chat"; y: number; col: number } | { kind: "global"; row: number; col: number } | null = null;

/**
 * 粘性行缓存：单击设锚后滚轮浏览时持续采集，供 Shift+click 跨视口复制。
 * 与当前 ChatSel.lineCache 共享写入。
 */
const stickyLineCache = new Map<number, string>();

/**
 * 同步 chat 视口指标。
 * - 无 paintPending：logical+paint 一起更新
 * - 有 paintPending：只更新 logical 的滚动字段，paint 仅同步 top/bottom 边框
 */
export function setChatViewMetrics(m: Partial<ChatViewMetrics>): void {
  logicalView = { ...logicalView, ...m };
  if (!paintPending) {
    paintView = { ...logicalView };
  } else {
    if (m.top !== undefined) paintView.top = m.top;
    if (m.bottom !== undefined) paintView.bottom = m.bottom;
  }
}

/** scroll 后立刻只改 logical；paint 等 Ink lastGrid 对齐后再 syncPaintViewFromLogical */
export function setLogicalChatViewMetrics(m: Partial<ChatViewMetrics>): void {
  logicalView = { ...logicalView, ...m };
  paintPending = true;
}

/** Ink lastGrid 已与当前 scroll 对齐时调用 */
export function syncPaintViewFromLogical(): boolean {
  if (!paintPending) {
    // 仍同步字段（rect 可能变）
    paintView = { ...logicalView };
    return false;
  }
  paintView = { ...logicalView };
  paintPending = false;
  return true;
}

export function isPaintPending(): boolean {
  return paintPending;
}

export function getChatViewMetrics(which: "logical" | "paint" = "logical"): ChatViewMetrics {
  return which === "paint" ? paintView : logicalView;
}

export function setInputBounds(
  b: { left: number; top: number; width: number; height: number; textColOffset?: number } | null,
): void {
  if (!b) {
    inputBounds = null;
    return;
  }
  inputBounds = {
    left: b.left,
    top: b.top,
    width: b.width,
    height: b.height,
    textColOffset: b.textColOffset ?? 4,
  };
}

export function getInputBounds() {
  return inputBounds;
}

export function getActiveSel(): ActiveSel {
  return active;
}

export function getSelMode(): SelMode {
  return active?.mode ?? null;
}

export function clearActiveSel(): void {
  active = null;
}

export function setStickyFromActive(): void {
  if (!active) {
    stickyAnchor = null;
    return;
  }
  if (active.mode === "chat") {
    stickyAnchor = { kind: "chat", y: active.aY, col: active.aCol };
  } else if (active.mode === "global") {
    stickyAnchor = { kind: "global", row: active.a.row, col: active.a.col };
  } else {
    stickyAnchor = null;
  }
}

export function getStickyAnchor() {
  return stickyAnchor;
}

export function clearStickyAnchor(): void {
  stickyAnchor = null;
  stickyLineCache.clear();
}

export function getStickyLineCache(): Map<number, string> {
  return stickyLineCache;
}

export function getStickyLine(absY: number): string | undefined {
  return stickyLineCache.get(absY);
}

export function putStickyLine(absY: number, text: string): void {
  // 不覆盖已有非空行：防止视口错位时把「已滚出」的真内容盖成 chrome 残片
  const prev = stickyLineCache.get(absY);
  if (prev !== undefined && prev.trim() !== "" && text.trim() === "") return;
  if (prev !== undefined && prev.length > text.length + 8 && looksLikeChromeFragment(text)) return;
  stickyLineCache.set(absY, text);
}

/** 框线/回底按钮等不应盖掉正文缓存 */
function looksLikeChromeFragment(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/回到最底部/.test(t)) return true;
  // 几乎全是盒绘字符
  const box = t.replace(/[─┌┐└┘│├┤┬┴┼═║╔╗╚╝\s─]/g, "");
  if (t.length >= 4 && box.length === 0) return true;
  return false;
}

/** 屏幕行 → chat absY；不在 chat 内返回 null */
export function screenToAbsY(
  screenRow: number,
  which: "logical" | "paint" = "logical",
): number | null {
  const v = which === "paint" ? paintView : logicalView;
  if (screenRow < v.top || screenRow > v.bottom) return null;
  return v.contentTopY + (screenRow - v.top);
}

export function absYToScreenRow(
  absY: number,
  which: "logical" | "paint" = "paint",
): number | null {
  const v = which === "paint" ? paintView : logicalView;
  const sr = v.top + (absY - v.contentTopY);
  if (sr < v.top || sr > v.bottom) return null;
  return sr;
}

export function pointInChat(row: number, _col: number, which: "logical" | "paint" = "logical"): boolean {
  const v = which === "logical" ? logicalView : paintView;
  return row >= v.top && row <= v.bottom;
}

export function normalizeStream(
  aY: number, aCol: number, bY: number, bCol: number,
): { y1: number; c1: number; y2: number; c2: number } {
  if (aY < bY || (aY === bY && aCol <= bCol)) {
    return { y1: aY, c1: aCol, y2: bY, c2: bCol };
  }
  return { y1: bY, c1: bCol, y2: aY, c2: aCol };
}

/** 流式选区是否包含 (y, col) */
export function inStream(y: number, col: number, y1: number, c1: number, y2: number, c2: number): boolean {
  if (y < y1 || y > y2) return false;
  if (y === y1 && y === y2) return col >= c1 && col <= c2;
  if (y === y1) return col >= c1;
  if (y === y2) return col <= c2;
  return true;
}

export function startChatSel(y: number, col: number, shift: boolean): void {
  if (shift && stickyAnchor?.kind === "chat") {
    const seeded = new Map(stickyLineCache);
    active = {
      mode: "chat",
      aY: stickyAnchor.y,
      aCol: stickyAnchor.col,
      bY: y,
      bCol: col,
      lineCache: seeded,
    };
  } else {
    stickyLineCache.clear();
    active = {
      mode: "chat",
      aY: y, aCol: col, bY: y, bCol: col,
      lineCache: new Map(),
    };
    stickyAnchor = { kind: "chat", y, col };
  }
}

export function updateChatSelEnd(y: number, col: number): void {
  if (!active || active.mode !== "chat") return;
  active.bY = y;
  active.bCol = col;
}

export function startGlobalSel(row: number, col: number, shift: boolean): void {
  if (shift && stickyAnchor?.kind === "global") {
    active = {
      mode: "global",
      a: { row: stickyAnchor.row, col: stickyAnchor.col },
      b: { row, col },
    };
  } else {
    active = { mode: "global", a: { row, col }, b: { row, col } };
    stickyAnchor = { kind: "global", row, col };
  }
}

export function updateGlobalSelEnd(row: number, col: number): void {
  if (!active || active.mode !== "global") return;
  active.b = { row, col };
}

export function startInputSel(row: number, col: number): void {
  active = { mode: "input", a: { row, col }, b: { row, col } };
  stickyAnchor = null;
}

export function updateInputSelEnd(row: number, col: number): void {
  if (!active || active.mode !== "input") return;
  // 夹到输入框内
  if (inputBounds) {
    const r1 = inputBounds.top;
    const r2 = inputBounds.top + inputBounds.height - 1;
    const c1 = inputBounds.left + inputBounds.textColOffset;
    const c2 = inputBounds.left + inputBounds.width - 1;
    row = Math.max(r1, Math.min(r2, row));
    col = Math.max(c1, Math.min(c2, col));
  }
  active.b = { row, col };
}

/** 当前选区覆盖的屏幕行范围（绘制用 paint metrics） */
export function dirtyRowsForPaint(screenRows: number): { r1: number; r2: number } | null {
  if (!active) return null;
  if (active.mode === "global" || active.mode === "input") {
    const a = active.a;
    const b = active.b;
    let r1 = Math.min(a.row, b.row);
    let r2 = Math.max(a.row, b.row);
    if (active.mode === "input" && inputBounds) {
      r1 = Math.max(r1, inputBounds.top);
      r2 = Math.min(r2, inputBounds.top + inputBounds.height - 1);
    }
    return { r1: Math.max(1, r1), r2: Math.min(screenRows, r2) };
  }
  // chat：只画视口内与选区相交的屏幕行（paint metrics）
  const { y1, y2 } = normalizeStream(active.aY, active.aCol, active.bY, active.bCol);
  const { top, bottom, contentTopY } = paintView;
  let r1 = screenRows, r2 = 0;
  for (let sr = top; sr <= bottom; sr++) {
    const ay = contentTopY + (sr - top);
    if (ay >= y1 && ay <= y2) {
      r1 = Math.min(r1, sr);
      r2 = Math.max(r2, sr);
    }
  }
  if (r1 > r2) return null;
  return { r1, r2 };
}

/**
 * 输入框是否有「非零宽」选区（标准编辑器：有选区时不画插入光标）。
 * 零宽 = 光标；有范围 = 选区，二者互斥。
 */
export function inputHasRangeSelection(): boolean {
  if (!active || active.mode !== "input") return false;
  return active.a.row !== active.b.row || active.a.col !== active.b.col;
}

/** 屏幕格是否在选区蓝底内（绘制必须用 paint metrics） */
export function cellInSelection(screenRow: number, screenCol: number): boolean {
  if (!active) return false;
  if (active.mode === "chat") {
    // paint 未同步时仍按 paintView 画，避免蓝底跟错行
    const ay = screenToAbsY(screenRow, "paint");
    if (ay === null) return false;
    const { y1, c1, y2, c2 } = normalizeStream(active.aY, active.aCol, active.bY, active.bCol);
    return inStream(ay, screenCol, y1, c1, y2, c2);
  }
  if (active.mode === "global") {
    const { y1, c1, y2, c2 } = normalizeStream(
      active.a.row, active.a.col, active.b.row, active.b.col,
    );
    return inStream(screenRow, screenCol, y1, c1, y2, c2);
  }
  // input：限制在输入框矩形内 + 流式选区
  // 零宽（a===b）不画：避免单击留下蓝块伪光标；真光标由 Ink 反色格 + 计算机蓝块表示
  if (active.a.row === active.b.row && active.a.col === active.b.col) {
    return false;
  }
  if (inputBounds) {
    const { left, top, width, height, textColOffset } = inputBounds;
    const r1 = top;
    const r2 = top + height - 1;
    const cMin = left + textColOffset;
    const cMax = left + width - 1;
    if (screenRow < r1 || screenRow > r2) return false;
    if (screenCol < cMin || screenCol > cMax) return false;
  }
  const { y1, c1, y2, c2 } = normalizeStream(
    active.a.row, active.a.col, active.b.row, active.b.col,
  );
  return inStream(screenRow, screenCol, y1, c1, y2, c2);
}
