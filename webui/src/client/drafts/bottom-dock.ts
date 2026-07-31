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

/**
 * Bottom dock slots — TASK/busy chrome moved here from context top bar.
 * 日志 | 任务(原 TASKS) | 终端 | agent
 */
export type DockCardId = "logs" | "tasks" | "terminal" | "agent";

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
 * Scale content units → CSS px.
 * Content height for strip = 4 → ~32px track tabs (matches mock density).
 */
export const FOLDER_SCALE = 8;

/** Track / tab strip height (content h 4 × scale) — full chip incl. ear. */
export const DOCK_TRACK_H = Math.round(FOLDER.stripBottom * FOLDER_SCALE); // 32
export const DOCK_TAB_H = DOCK_TRACK_H;
export const DOCK_TAB_W = Math.round(FOLDER.tabRight * FOLDER_SCALE); // 92
/**
 * Body band only (y = bodyTop..stripBottom): height of the bottom rail /
 * track-fill. Aligns with the folder shoulder (折角), not the ear tip.
 */
export const DOCK_STRIP_BODY_H = Math.round(
  (FOLDER.stripBottom - FOLDER.bodyTop) * FOLDER_SCALE,
); // 24
/** Ear lip height above the shoulder (y = 0..bodyTop). */
export const DOCK_EAR_RISE_H = Math.round(FOLDER.bodyTop * FOLDER_SCALE); // 8

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

export const DOCK_OPEN_THRESHOLD = 40;
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

export type DockCardTone = "logs" | "tasks" | "terminal" | "agent";

export type DockCardDef = {
  id: DockCardId;
  label: string;
  tone: DockCardTone;
};

/** Split of former top TASKS + ops surface into bottom folder boards. */
export const DOCK_CARDS: readonly DockCardDef[] = [
  { id: "logs", label: "日志", tone: "logs" },
  { id: "tasks", label: "任务", tone: "tasks" },
  { id: "terminal", label: "终端", tone: "terminal" },
  { id: "agent", label: "agent", tone: "agent" },
] as const;

/** Default left→right dock order. */
export function defaultDockOrder(): DockCardId[] {
  return DOCK_CARDS.map((c) => c.id);
}

export function dockCardById(id: DockCardId): DockCardDef {
  const c = DOCK_CARDS.find((x) => x.id === id);
  if (!c) throw new Error(`unknown dock card ${id}`);
  return c;
}

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
export const HOVER_EXPAND_S = 0.2;
/** Hover strip collapse duration (s). */
export const HOVER_COLLAPSE_S = 0.16;
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

/** Snappy close — board snaps back into the rack. */
export const SPRING_CLOSE = {
  stiffness: 400,
  damping: 36,
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

export function releaseTarget(
  pullH: number,
  velocityUp: number,
): { target: number; open: boolean } {
  const open =
    pullH >= DOCK_OPEN_THRESHOLD || velocityUp >= DOCK_OPEN_VELOCITY;
  if (!open) return { target: 0, open: false };
  return { target: DOCK_EXPAND_H_UI, open: true };
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
  return rubberBand(rawPull, DOCK_EXPAND_H_UI, DOCK_EXPAND_H_UI);
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

export function isDockCardId(v: string): v is DockCardId {
  return DOCK_CARDS.some((c) => c.id === v);
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
      provisionalOpen: false,
      freezeHeight:
        switchingAway || (session.kind === "open" && already != null),
    };
  }

  if (switchingAway) {
    return {
      session: next,
      height: session.startH,
      provisionalOpen: true,
      freezeHeight: true,
    };
  }

  if (session.kind === "open") {
    const raw = pullFromPointer(session.startY, clientY);
    const height = displayPullHeight(raw);
    return {
      session: next,
      height,
      provisionalOpen: height > 4,
      freezeHeight: false,
    };
  }

  const height = displayResizeHeight(session.startH, session.startY, clientY);
  return {
    session: next,
    height,
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
    const display = displayPullHeight(pullFromPointer(session.startY, y));
    const { target, open } = releaseTarget(display, velUp);
    return {
      kind: "spring",
      targetH: target,
      open,
      id: session.id,
      velocityKick: velUp * 1000,
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
