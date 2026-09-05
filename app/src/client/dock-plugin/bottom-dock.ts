/**
 * Bottom dock folder geometry + drag physics.
 *
 * Design SVGs (pixel-locked). Filter pad 3.5 is for shadow only — we store
 * content-local paths (origin at design 3.5,3.5) so the fill fills the CSS box.
 *
 *  1 tab:     M3.5 4.5V7.5H15V4.5H14L13 3.5H4.5L3.5 4.5Z
 *  2 preview: M3.5 4.5V7.5H47V4.5H14L13 3.5H4.5L3.5 4.5Z  (right edge grows)
 *  3 expand:  M3.5 4.5V37.5H38V4.5H14L13 3.5H4.5L3.5 4.5Z (right+bottom grow)
 *
 * Local (shift −3.5,−3.5):
 *  tab:     M0 1V4H11.5V1H10.5L9.5 0H1L0 1Z
 *  preview: M0 1V4H43.5V1H10.5L9.5 0H1L0 1Z
 *  expand:  M0 1V34H34.5V1H10.5L9.5 0H1L0 1Z
 */

export type {
  DockCardId,
  DockCardTone,
  DockCardDef,
} from "./ids";
export {
  DOCK_CARDS,
  defaultDockOrder,
  dockCardById,
  isDockCardId,
} from "./ids";
import {
  defaultDockOrder,
  type DockCardId,
} from "./ids";

/** Content-local design units (origin = design 3.5,3.5). */
export const FOLDER = {
  earTop: 0,
  bodyTop: 1,
  stripBottom: 4, // collapsed / preview body bottom
  left: 0,
  earTopLeft: 1,
  earTopRight: 9.5,
  earShoulder: 10.5,
  tabRight: 11.5,
  previewRight: 43.5,
  expandRight: 34.5,
  expandBottom: 34,
  /** Design shadow blur (CSS drop-shadow uses this) */
  shadowBlur: 1.75,
  shadowOpacity: 0.41,
} as const;

/**
 * Scale content units → CSS px (expand board width/height).
 */
export const FOLDER_SCALE = 8;

/** Full-width collapsed dock strip. Idle chips share this height. */
export const DOCK_TRACK_H = 24;
export const DOCK_TAB_H = DOCK_TRACK_H;
export const DOCK_TAB_W = Math.round(FOLDER.tabRight * FOLDER_SCALE); // 92
/** Idle rail body fills the strip. */
export const DOCK_STRIP_BODY_H = DOCK_TRACK_H;
export const DOCK_EAR_RISE_H = 0;

/** Preview min width (design 43.5 × scale); grows with title. */
export const DOCK_PREVIEW_W_MIN = Math.round(FOLDER.previewRight * FOLDER_SCALE); // 348
export const DOCK_PREVIEW_W = DOCK_PREVIEW_W_MIN;

/** Expand float default size */
export const DOCK_EXPAND_W_UI = Math.round(FOLDER.expandRight * FOLDER_SCALE); // 276
export const DOCK_EXPAND_H_UI = Math.round(FOLDER.expandBottom * FOLDER_SCALE); // 272
export const DOCK_EXPAND_H = DOCK_EXPAND_H_UI;
export const DOCK_EXPAND_W = DOCK_EXPAND_W_UI;
export const DOCK_EXPAND_H_MIN = 96;
export const DOCK_EXPAND_H_MAX = 480;

/**
 * Over-center detent: pointer travel that breaks the slot magnet.
 * Display height stays well below this (see detentPull) until snap-through.
 */
export const DOCK_BREAKAWAY_RAW = Math.round(DOCK_EXPAND_H_UI * 0.62);
/** How high the board is allowed to peek before the 啪嗒 pop. */
export const DOCK_DETENT_PEEK = Math.round(DOCK_EXPAND_H_UI * 0.3);
/** Open commits on raw pointer travel, not displayed height. */
export const DOCK_OPEN_THRESHOLD = DOCK_BREAKAWAY_RAW;
export const DOCK_OPEN_VELOCITY = 0.38;
export const DOCK_CLICK_SLOP_PX = 10;
export const DOCK_CLOSE_FRACTION = 0.42;

/**
 * Build continuous folder path in content-local units.
 * Ear fixed: H10.5 L9.5 0 H1 L0 1 — only rightX and bottomY change.
 */
export function buildFolderPath(rightX: number, bottomY: number): string {
  const r = Math.max(FOLDER.earShoulder + 0.5, rightX);
  const b = Math.max(FOLDER.bodyTop + 0.5, bottomY);
  const { bodyTop, earShoulder, earTopRight, earTop, earTopLeft, left } = FOLDER;
  return `M${left} ${bodyTop}V${b}H${r}V${bodyTop}H${earShoulder}L${earTopRight} ${earTop}H${earTopLeft}L${left} ${bodyTop}Z`;
}

/** Tight viewBox around path content (no empty filter padding). */
export function folderViewBox(rightX: number, bottomY: number): string {
  return `0 0 ${rightX} ${bottomY}`;
}

export function rightXFromCssWidth(cssW: number): number {
  return Math.max(FOLDER.tabRight, cssW / FOLDER_SCALE);
}

export function bottomYFromCssHeight(cssH: number): number {
  return Math.max(FOLDER.stripBottom, cssH / FOLDER_SCALE);
}

export function cssSizeFromPath(rightX: number, bottomY: number): {
  w: number;
  h: number;
} {
  return {
    w: Math.round(rightX * FOLDER_SCALE),
    h: Math.round(bottomY * FOLDER_SCALE),
  };
}

export const FOLDER_PATH_TAB = buildFolderPath(
  FOLDER.tabRight,
  FOLDER.stripBottom,
);
export const FOLDER_PATH_PREVIEW = buildFolderPath(
  FOLDER.previewRight,
  FOLDER.stripBottom,
);
export const FOLDER_PATH_EXPAND = buildFolderPath(
  FOLDER.expandRight,
  FOLDER.expandBottom,
);

// Back-compat
export const FOLDER_PATH_D = FOLDER_PATH_EXPAND;
export const FOLDER_PATH_UI = FOLDER_PATH_EXPAND;
export const FOLDER_PATH_VIEWBOX = folderViewBox(
  FOLDER.expandRight,
  FOLDER.expandBottom,
);
export const FOLDER_EAR = {
  bodyTop: FOLDER.bodyTop,
  earTop: FOLDER.earTop,
  left: FOLDER.left,
  earTopLeft: FOLDER.earTopLeft,
  earTopRight: FOLDER.earTopRight,
  earShoulder: FOLDER.earShoulder,
  pad: 0,
  stripBottom: FOLDER.stripBottom,
  tabRight: FOLDER.tabRight,
  expandRight: FOLDER.expandRight,
  expandBottom: FOLDER.expandBottom,
} as const;

export const FOLDER_LAYOUT = {
  vbW: FOLDER.expandRight,
  vbH: FOLDER.expandBottom,
  x0: 0,
  y0: 0,
  x1: FOLDER.expandRight,
  y1: FOLDER.expandBottom,
  bodyTop: FOLDER.bodyTop,
  earTop: FOLDER.earTop,
  bodyTopUi: FOLDER.bodyTop,
  earRight: FOLDER.earShoulder,
  earTopRight: FOLDER.earTopRight,
  earTopLeft: FOLDER.earTopLeft,
  chamfer: 1,
} as const;

export function folderEarWidthFrac(): number {
  return FOLDER.earShoulder / FOLDER.expandRight;
}

export function folderEarRiseFrac(): number {
  return FOLDER.bodyTop / FOLDER.expandBottom;
}

export function folderEarRiseUiFrac(): number {
  return folderEarRiseFrac();
}

export function folderClipPathPolygon(): string {
  // Content-local % for CSS clip if needed
  const b = (FOLDER.bodyTop / FOLDER.stripBottom) * 100;
  const eR = (FOLDER.earShoulder / FOLDER.tabRight) * 100;
  const eTR = (FOLDER.earTopRight / FOLDER.tabRight) * 100;
  const eTL = (FOLDER.earTopLeft / FOLDER.tabRight) * 100;
  return `polygon(0% 100%, 0% ${b}%, ${eTL}% 0%, ${eTR}% 0%, ${eR}% ${b}%, 100% ${b}%, 100% 100%)`;
}

// ── Physics ──────────────────────────────────────────────────────────


/**
 * Reorder dock tabs: move `fromId` to index `toIndex` (0 = leftmost).
 * Pure; clamps to bounds.
 */
export function reorderDockOrder(
  order: readonly DockCardId[],
  fromId: DockCardId,
  toIndex: number,
): DockCardId[] {
  const from = order.indexOf(fromId);
  if (from < 0) return [...order];
  const next = order.filter((id) => id !== fromId);
  const idx = Math.max(0, Math.min(next.length, toIndex));
  next.splice(idx, 0, fromId);
  return next;
}

/**
 * Given ordered tab center X positions and a pointer X, return insert index
 * (0..n) for reordering under the cursor.
 */
export function reorderIndexFromCenters(
  centers: readonly number[],
  clientX: number,
): number {
  if (centers.length === 0) return 0;
  for (let i = 0; i < centers.length; i++) {
    if (clientX < centers[i]!) return i;
  }
  return centers.length;
}

/**
 * Free-float window: hit dock zone near bottom of viewport → should stow.
 * `bottomY` = window bottom edge in client coords; `viewportH` = innerHeight.
 */
export function shouldStowFloat(
  windowBottomY: number,
  viewportH: number,
  zonePx = 64,
): boolean {
  return windowBottomY >= viewportH - zonePx;
}

/** Rightmost dock tab gets highest z (paint on top). */
export function dockTabZIndex(indexFromLeft: number, count: number): number {
  // left = 1 … right = count
  return 1 + Math.max(0, Math.min(count - 1, indexFromLeft));
}

export function dockCardWidth(phase: "tab" | "preview" | "expand"): number {
  if (phase === "tab") return DOCK_TAB_W;
  if (phase === "preview") return DOCK_PREVIEW_W_MIN;
  return DOCK_EXPAND_W_UI;
}

// ── Board lift geometry (physical folder board from slot) ────────────

export type BoardPos = { left: number; top: number };

/**
 * Keep board bottom edge on the slot strip while height grows upward
 * (like lifting a folder board out of a rack).
 */
export function boardTopFromSlotBottom(
  slotBottom: number,
  boardHeight: number,
): number {
  return slotBottom - boardHeight;
}

export function boardLeftFromSlot(
  slotLeft: number,
  boardWidth: number,
  viewportW: number,
  pad = 4,
): number {
  return Math.max(pad, Math.min(viewportW - boardWidth - pad, slotLeft));
}

/** Place board with bottom edge on slot.bottom, left aligned to slot.left. */
export function boardPlacementFromSlot(
  slot: { left: number; bottom: number },
  boardW: number,
  boardH: number,
  viewportW: number,
  viewportH: number,
): BoardPos {
  const left = boardLeftFromSlot(slot.left, boardW, viewportW);
  let top = boardTopFromSlotBottom(slot.bottom, boardH);
  // clamp top into viewport but prefer keeping bottom on slot
  top = Math.max(4, Math.min(top, Math.max(4, viewportH - 40)));
  return { left, top };
}

/** Ease-out cubic progress 0..1 */
export function easeOutCubic(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - u, 3);
}

/** Hover strip open duration (s) — right edge grows first. */
export const HOVER_EXPAND_S = 0.18;
/** Hover strip collapse duration (s) — slightly slower so sweep overlaps. */
export const HOVER_COLLAPSE_S = 0.22;
/**
 * Extra title/preview text starts fading after this progress of the width grow
 * (label + badge always stay; text is additive).
 */
/** Start fading in extra text earlier so label stays readable while width grows. */
export const HOVER_TEXT_REVEAL_AFTER = 0.18;

/**
 * Step hover progress toward target (0 = tab, 1 = full preview width).
 * Pure helper for rAF strip morph.
 */
export function stepHoverProgress(
  current: number,
  target: number,
  dtSec: number,
  expandS = HOVER_EXPAND_S,
  collapseS = HOVER_COLLAPSE_S,
): number {
  const c = Math.max(0, Math.min(1, current));
  const t = Math.max(0, Math.min(1, target));
  if (Math.abs(t - c) < 0.001) return t;
  const rate = t > c ? 1 / Math.max(0.05, expandS) : 1 / Math.max(0.05, collapseS);
  const next = c + Math.sign(t - c) * rate * Math.max(0, dtSec);
  if (t > c) return Math.min(t, next);
  return Math.max(t, next);
}

/** Opacity of hover extra text (title + preview) given width progress 0..1. */
export function hoverTextOpacity(
  progress: number,
  after = HOVER_TEXT_REVEAL_AFTER,
): number {
  const p = Math.max(0, Math.min(1, progress));
  if (p <= after) return 0;
  return easeOutCubic((p - after) / Math.max(0.001, 1 - after));
}

/** Gaussian weight 0..1 — how hard the pointer pulls on a slot. */
export const DOCK_MAGNET_SIGMA = 56;
export const DOCK_MAGNET_HOLD_PX = 16;
export const DOCK_MAGNET_MAX_RISE = 9;
export const DOCK_MAGNET_MAX_LEAN = 2.6;
export const DOCK_MAGNET_MAX_SHIFT = 5;

export function dockMagnetWeight(
  pointerX: number,
  centerX: number,
  sigma = DOCK_MAGNET_SIGMA,
): number {
  const d = pointerX - centerX;
  const s = Math.max(8, sigma);
  return Math.exp(-(d * d) / (2 * s * s));
}

export type DockMagnetSlot = { id: DockCardId; center: number };

/**
 * Winner under the pointer. Hysteresis: keep `prevId` until the pointer
 * is `holdPx` past the midpoint toward a neighbor (no flicker on the seam).
 */
export function dockMagnetWinner(
  slots: readonly DockMagnetSlot[],
  pointerX: number,
  prevId: DockCardId | null = null,
  holdPx = DOCK_MAGNET_HOLD_PX,
): DockCardId | null {
  if (slots.length === 0) return null;
  let best = slots[0]!;
  let bestW = dockMagnetWeight(pointerX, best.center);
  for (let i = 1; i < slots.length; i++) {
    const s = slots[i]!;
    const w = dockMagnetWeight(pointerX, s.center);
    if (w > bestW) {
      best = s;
      bestW = w;
    }
  }
  if (!prevId || prevId === best.id) return best.id;
  const prev = slots.find((s) => s.id === prevId);
  if (!prev) return best.id;
  const mid = (prev.center + best.center) / 2;
  const towardBest = best.center >= prev.center ? 1 : -1;
  if ((pointerX - mid) * towardBest < holdPx) return prevId;
  return best.id;
}

export type DockMagnetPose = {
  risePx: number;
  leanDeg: number;
  shiftX: number;
  influence: number;
};

export const DOCK_MAGNET_REST: DockMagnetPose = {
  risePx: 0,
  leanDeg: 0,
  shiftX: 0,
  influence: 0,
};

/** Peek / lean / adsorb toward the pointer. Winner rises more. */
export function dockMagnetPose(
  pointerX: number,
  centerX: number,
  isWinner: boolean,
  opts?: {
    sigma?: number;
    maxRise?: number;
    maxLean?: number;
    maxShift?: number;
  },
): DockMagnetPose {
  const influence = dockMagnetWeight(pointerX, centerX, opts?.sigma);
  const maxRise = opts?.maxRise ?? DOCK_MAGNET_MAX_RISE;
  const maxLean = opts?.maxLean ?? DOCK_MAGNET_MAX_LEAN;
  const maxShift = opts?.maxShift ?? DOCK_MAGNET_MAX_SHIFT;
  const toward = Math.max(-1, Math.min(1, (pointerX - centerX) / 80));
  const boost = isWinner ? 1 : 0.55;
  return {
    risePx: influence * maxRise * boost,
    leanDeg: toward * influence * maxLean,
    shiftX: toward * influence * maxShift,
    influence,
  };
}

export function lerpMagnetPose(
  from: DockMagnetPose,
  to: DockMagnetPose,
  t: number,
): DockMagnetPose {
  const u = Math.max(0, Math.min(1, t));
  return {
    risePx: from.risePx + (to.risePx - from.risePx) * u,
    leanDeg: from.leanDeg + (to.leanDeg - from.leanDeg) * u,
    shiftX: from.shiftX + (to.shiftX - from.shiftX) * u,
    influence: from.influence + (to.influence - from.influence) * u,
  };
}

/** Independent per-card hover progress — sweep does not snap the previous shut. */
export function stepHoverMap(
  current: Partial<Record<DockCardId, number>>,
  targetId: DockCardId | null,
  dtSec: number,
  ids: readonly DockCardId[] = defaultDockOrder(),
): Partial<Record<DockCardId, number>> {
  const next: Partial<Record<DockCardId, number>> = {};
  let any = false;
  for (const id of ids) {
    const t = stepHoverProgress(current[id] ?? 0, id === targetId ? 1 : 0, dtSec);
    if (t > 0.001) {
      next[id] = t;
      any = true;
    }
  }
  return any ? next : {};
}

export function magnetPoseSettled(
  pose: DockMagnetPose,
  eps = 0.08,
): boolean {
  return (
    Math.abs(pose.risePx) < eps &&
    Math.abs(pose.leanDeg) < eps &&
    Math.abs(pose.shiftX) < eps
  );
}

/** CSS transform: bottom-edge pivot, peek out of the slot toward the pointer. */
export function dockMagnetTransform(pose: DockMagnetPose): string | undefined {
  if (magnetPoseSettled(pose, 0.04)) return undefined;
  const y = -pose.risePx;
  return `translateX(${pose.shiftX.toFixed(2)}px) translateY(${y.toFixed(2)}px) rotate(${pose.leanDeg.toFixed(2)}deg)`;
}

/**
 * Strip width while hovering: only right edge grows (tab → preview).
 * `progress` 0..1; ear vertices stay fixed via buildFolderPath.
 */
export function stripWidthForHoverProgress(
  progress: number,
  previewCssW: number,
): number {
  const t = easeOutCubic(Math.max(0, Math.min(1, progress)));
  const target = Math.max(DOCK_TAB_W, previewCssW);
  return Math.round(DOCK_TAB_W + (target - DOCK_TAB_W) * t);
}

/**
 * Board width while pulling: morphs from tab → expand with ease
 * (same path topology; only right edge grows).
 */
export function boardWidthForPanel(panelH: number): number {
  const t = easeOutCubic(
    panelH / Math.max(1, DOCK_EXPAND_H_UI * 0.42),
  );
  return Math.round(DOCK_TAB_W + (DOCK_EXPAND_W_UI - DOCK_TAB_W) * t);
}

/** Total board CSS height from panel content height. */
export function boardHeightForPanel(panelH: number): number {
  return DOCK_TAB_H + Math.max(0, panelH);
}

/** Lerp free-board position (used when stowing back into the slot). */
export function lerpBoardPos(from: BoardPos, to: BoardPos, t: number): BoardPos {
  const u = Math.max(0, Math.min(1, t));
  return {
    left: from.left + (to.left - from.left) * u,
    top: from.top + (to.top - from.top) * u,
  };
}

/**
 * Stow progress from collapsing height: 0 at full open, 1 when fully stowed.
 * Drives board sliding back toward the slot while shrinking.
 */
export function stowProgressFromHeight(
  height: number,
  startHeight: number,
): number {
  if (startHeight <= 1) return 1;
  return easeOutCubic(1 - Math.max(0, height) / startHeight);
}

/** Subtle tilt (deg) from horizontal free-drag for board-in-hand feel. */
export function boardTiltDeg(dxPx: number, maxDeg = 5): number {
  return Math.max(-maxDeg, Math.min(maxDeg, dxPx * 0.035));
}

export function rubberBand(x: number, max: number, dim = max): number {
  if (x <= max) return Math.max(0, x);
  if (max <= 0) return 0;
  const over = x - max;
  // slightly firmer rubber for board thickness feel
  const c = 0.28;
  const d = Math.max(1, dim);
  return max + (1 - 1 / ((over * c) / d + 1)) * d * 0.34;
}

/**
 * Preload curve while the board is still in the slot magnet.
 * Early travel follows a bit; near breakaway the gain collapses so the
 * board stays low while the pointer keeps climbing (不跟手).
 */
export function detentPull(
  rawPull: number,
  breakaway = DOCK_BREAKAWAY_RAW,
  peek = DOCK_DETENT_PEEK,
): number {
  const raw = Math.max(0, rawPull);
  if (raw <= 0 || breakaway <= 0 || peek <= 0) return 0;
  const u = Math.min(1, raw / breakaway);
  // Cubic Hermite: start slope 1.15, end slope 0.08 (normalized 0..1)
  const m0 = 1.15;
  const m1 = 0.08;
  const p =
    m0 * u +
    (-2 * m0 - m1 + 3) * u * u +
    (m0 + m1 - 2) * u * u * u;
  return peek * Math.max(0, Math.min(1, p));
}

export function isPullBreakaway(
  rawPull: number,
  breakaway = DOCK_BREAKAWAY_RAW,
): boolean {
  return rawPull >= breakaway;
}

/** Stow / failed-pull: short ease into the slot, no oscillating spring. */
export const STOW_EASE_S = 0.2;

export function easeCloseProgress(
  elapsedSec: number,
  durationS = STOW_EASE_S,
): number {
  if (durationS <= 0) return 1;
  return easeOutCubic(Math.max(0, Math.min(1, elapsedSec / durationS)));
}

export function easeCloseHeight(startH: number, progress: number): number {
  const p = Math.max(0, Math.min(1, progress));
  return Math.max(0, startH * (1 - p));
}

export function easeOpenHeight(
  startH: number,
  targetH: number,
  progress: number,
): number {
  const p = Math.max(0, Math.min(1, progress));
  return startH + (targetH - startH) * p;
}

export function clampPullHeight(h: number): number {
  return Math.max(0, Math.min(DOCK_EXPAND_H_MAX + 100, h));
}

export type SpringState = { x: number; v: number };

/** Punchy open — near-critical with slight overshoot energy. */
export const SPRING_OPEN = {
  stiffness: 440,
  damping: 30,
  mass: 1,
} as const;

export function springStep(
  state: SpringState,
  target: number,
  dtMs: number,
  opts?: { stiffness?: number; damping?: number; mass?: number },
): SpringState {
  const stiffness = opts?.stiffness ?? SPRING_OPEN.stiffness;
  const damping = opts?.damping ?? SPRING_OPEN.damping;
  const mass = opts?.mass ?? SPRING_OPEN.mass;
  const dt = Math.min(32, Math.max(1, dtMs)) / 1000;
  const spring = -stiffness * (state.x - target);
  const damper = -damping * state.v;
  const a = (spring + damper) / mass;
  const v = state.v + a * dt;
  const x = state.x + v * dt;
  return { x, v };
}

export function springSettled(
  state: SpringState,
  target: number,
  posEps = 0.85,
  velEps = 12,
): boolean {
  return Math.abs(state.x - target) < posEps && Math.abs(state.v) < velEps;
}

/** Commit open from raw pointer travel — not the compressed display height. */
export function releaseTarget(
  rawPull: number,
  _velocityUp = 0,
): { target: number; open: boolean } {
  if (isPullBreakaway(rawPull)) {
    return { target: DOCK_EXPAND_H_UI, open: true };
  }
  return { target: 0, open: false };
}

export function releaseResizeTarget(
  height: number,
  velocityUp: number,
): { target: number; open: boolean } {
  if (velocityUp <= -DOCK_OPEN_VELOCITY) {
    return { target: 0, open: false };
  }
  if (height < DOCK_EXPAND_H_UI * DOCK_CLOSE_FRACTION) {
    return { target: 0, open: false };
  }
  const target =
    height > DOCK_EXPAND_H_UI + 24
      ? Math.min(DOCK_EXPAND_H_MAX, Math.round(height))
      : DOCK_EXPAND_H_UI;
  return { target, open: true };
}

export function isClickGesture(
  travelPx: number,
  slop: number = DOCK_CLICK_SLOP_PX,
): boolean {
  return travelPx < slop;
}

export function pullFromPointer(startY: number, clientY: number): number {
  return Math.max(0, startY - clientY);
}

export function displayPullHeight(rawPull: number): number {
  return detentPull(rawPull);
}

export function displayResizeHeight(
  startH: number,
  startY: number,
  clientY: number,
): number {
  const deltaUp = startY - clientY;
  const raw = startH + deltaUp;
  if (raw <= 0) return 0;
  if (raw <= DOCK_EXPAND_H_MAX) return raw;
  return rubberBand(raw, DOCK_EXPAND_H_MAX, DOCK_EXPAND_H_MAX);
}

/** Click-open impulse (px/s spring velocity) — board pops out of the slot. */
export const OPEN_KICK_V = 680;

// ── Pointer drag machine ─────────────────────────────────────────────

export type DockDragKind = "open" | "resize" | "float" | "reorder";

export type DockDragSession = {
  id: DockCardId;
  kind: DockDragKind;
  pointerId: number;
  startX: number;
  startY: number;
  startH: number;
  /** Float free-move origin (viewport px). */
  originLeft: number;
  originTop: number;
  lastY: number;
  lastT: number;
  vel: number;
  moved: boolean;
  maxTravel: number;
};

export function createDockDragSession(
  id: DockCardId,
  kind: DockDragKind,
  pointerId: number,
  clientY: number,
  startH: number,
  now = performance.now(),
  clientX = 0,
  originLeft = 0,
  originTop = 0,
): DockDragSession {
  return {
    id,
    kind,
    pointerId,
    startX: clientX,
    startY: clientY,
    startH,
    originLeft,
    originTop,
    lastY: clientY,
    lastT: now,
    vel: 0,
    moved: false,
    maxTravel: 0,
  };
}

export type DockDragMoveOpts = {
  alreadyOpenId?: DockCardId | null;
};

export type DockDragMoveResult = {
  session: DockDragSession;
  height: number;
  /** Pointer travel up (px). Breakaway is judged on this, not `height`. */
  raw: number;
  /** Crossed the over-center threshold — live snap-through. */
  breakaway: boolean;
  provisionalOpen: boolean;
  freezeHeight: boolean;
};

export function applyDockDragMove(
  session: DockDragSession,
  clientY: number,
  now = performance.now(),
  opts?: DockDragMoveOpts,
): DockDragMoveResult {
  const dt = Math.max(1, now - session.lastT);
  const dy = session.lastY - clientY;
  const vel = 0.65 * session.vel + 0.35 * (dy / dt);
  const vTravel = Math.abs(clientY - session.startY);
  const maxTravel = Math.max(session.maxTravel, vTravel);
  const moved = session.moved || maxTravel >= DOCK_CLICK_SLOP_PX;
  const next: DockDragSession = {
    ...session,
    lastY: clientY,
    lastT: now,
    vel,
    moved,
    maxTravel,
  };
  const already = opts?.alreadyOpenId ?? null;
  const switchingAway =
    session.kind === "open" &&
    already != null &&
    already !== session.id;

  if (!moved) {
    return {
      session: next,
      height: session.startH,
      raw: 0,
      breakaway: false,
      provisionalOpen: false,
      freezeHeight:
        switchingAway || (session.kind === "open" && already != null),
    };
  }

  if (switchingAway) {
    return {
      session: next,
      height: session.startH,
      raw: pullFromPointer(session.startY, clientY),
      breakaway: false,
      provisionalOpen: true,
      freezeHeight: true,
    };
  }

  if (session.kind === "open") {
    const raw = pullFromPointer(session.startY, clientY);
    // Interrupted close may leave startH > 0; never pop the board downward.
    const height = Math.max(displayPullHeight(raw), session.startH);
    return {
      session: next,
      height,
      raw,
      breakaway: isPullBreakaway(raw),
      provisionalOpen: height > 4,
      freezeHeight: false,
    };
  }

  const height = displayResizeHeight(session.startH, session.startY, clientY);
  return {
    session: next,
    height,
    raw: Math.max(0, session.startY - clientY),
    breakaway: false,
    provisionalOpen: true,
    freezeHeight: false,
  };
}

export type DockDragEndResult = {
  kind:
    | "click-open"
    | "click-close"
    | "click-switch"
    | "click-noop"
    | "spring"
    | "spring-switch"
    | "spring-restore";
  targetH: number;
  open: boolean;
  id: DockCardId;
  velocityKick: number;
};

export function resolveDockPointerUp(
  session: DockDragSession,
  alreadyOpenId: DockCardId | null,
  panelH: number,
  clientY?: number,
): DockDragEndResult {
  const y = clientY ?? session.lastY;
  const velUp = session.vel;
  const travel = session.maxTravel;
  const priorH = Math.max(session.startH, panelH);

  if (isClickGesture(travel) && !session.moved) {
    if (session.kind === "resize") {
      if (alreadyOpenId === session.id) {
        return {
          kind: "click-close",
          targetH: 0,
          open: false,
          id: session.id,
          velocityKick: -200,
        };
      }
      return {
        kind: "click-noop",
        targetH: panelH,
        open: true,
        id: session.id,
        velocityKick: 0,
      };
    }
    const isAlreadyOpen =
      alreadyOpenId === session.id && panelH > DOCK_EXPAND_H_UI * 0.55;
    if (isAlreadyOpen) {
      return {
        kind: "click-close",
        targetH: 0,
        open: false,
        id: session.id,
        velocityKick: -200,
      };
    }
    if (alreadyOpenId && alreadyOpenId !== session.id) {
      return {
        kind: "click-switch",
        targetH: Math.max(DOCK_EXPAND_H_UI, priorH),
        open: true,
        id: session.id,
        velocityKick: 400,
      };
    }
    return {
      kind: "click-open",
      targetH: DOCK_EXPAND_H_UI,
      open: true,
      id: session.id,
      velocityKick: OPEN_KICK_V,
    };
  }

  if (session.kind === "open") {
    if (alreadyOpenId != null && alreadyOpenId !== session.id) {
      return {
        kind: "spring-switch",
        targetH: Math.max(DOCK_EXPAND_H_UI, session.startH),
        open: true,
        id: session.id,
        velocityKick: Math.max(400, velUp * 1000),
      };
    }
    const raw = pullFromPointer(session.startY, y);
    const { target, open } = releaseTarget(raw, velUp);
    return {
      kind: "spring",
      targetH: target,
      open,
      id: session.id,
      velocityKick: open ? Math.max(OPEN_KICK_V, velUp * 1000) : 0,
    };
  }

  const { target, open } = releaseResizeTarget(panelH, velUp);
  return {
    kind: "spring",
    targetH: target,
    open,
    id: session.id,
    velocityKick: velUp * 1000,
  };
}
