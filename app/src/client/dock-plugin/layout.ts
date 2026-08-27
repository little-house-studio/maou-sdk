/**
 * Dock board layout — declarative open size / surface / resize for folder cards.
 *
 * Designers declare layout on the plugin slot; BottomInfoBar must not hardcode
 * per-card widths. Internal faces only care about surface tokens.
 */
import {
  DOCK_EXPAND_H_UI,
  DOCK_EXPAND_W_UI,
  DOCK_TAB_H,
} from "../drafts/bottom-dock";
import type { DockCardId } from "./ids";

/** How the face content should sit on the manila folder fill. */
export type DockBoardSurface =
  /** Translucent panes + dock-ink (proactive-style). */
  | "paper"
  /** Inset dark panel with wire shell tokens (terminal-style). */
  | "dark"
  /** Raw on tone fill — canvas / list previews. */
  | "transparent";

/**
 * Open-board geometry and chrome for one dock card.
 * All sizes are CSS px for the full folder board (incl. ear strip).
 * `defaultHeight` / min/max height are **panel content height**
 * (the spring-driven body, excluding the ear track when closed).
 */
export type DockBoardLayout = {
  /** Default open width of the floating board. */
  defaultWidth: number;
  /** Default open panel height (content below ear). */
  defaultHeight: number;
  minWidth?: number;
  minHeight?: number;
  /**
   * Optional hard max; when omitted, viewport fraction is used
   * (see `dockViewportSizeLimits`).
   */
  maxWidth?: number;
  maxHeight?: number;
  /** Edge / corner resize grips when expanded. */
  resizable?: boolean;
  /** localStorage key — when set, size is remembered across sessions. */
  persistKey?: string;
  /** Content surface chrome for DockBoardShell. */
  surface?: DockBoardSurface;
};

export type DockBoardSize = { w: number; h: number };

/** Viewport-relative clamp for open boards. */
export function dockViewportSizeLimits(layout?: DockBoardLayout): {
  wMax: number;
  hMax: number;
} {
  const minW = layout?.minWidth ?? 200;
  const minH = layout?.minHeight ?? 96;
  if (typeof window === "undefined") {
    return {
      wMax: layout?.maxWidth ?? 960,
      hMax: layout?.maxHeight ?? 640,
    };
  }
  const vw = Math.max(minW, Math.floor(window.innerWidth * 0.72));
  const vh = Math.max(
    minH,
    Math.floor(window.innerHeight * 0.62) - DOCK_TAB_H,
  );
  return {
    wMax: layout?.maxWidth != null ? Math.min(layout.maxWidth, vw) : vw,
    hMax: layout?.maxHeight != null ? Math.min(layout.maxHeight, vh) : vh,
  };
}

export function clampDockBoardSize(
  size: DockBoardSize,
  layout: DockBoardLayout,
): DockBoardSize {
  const { wMax, hMax } = dockViewportSizeLimits(layout);
  const minW = layout.minWidth ?? 200;
  const minH = layout.minHeight ?? 96;
  return {
    w: Math.min(wMax, Math.max(minW, Math.round(size.w))),
    h: Math.min(hMax, Math.max(minH, Math.round(size.h))),
  };
}

export function defaultDockBoardSize(layout: DockBoardLayout): DockBoardSize {
  return clampDockBoardSize(
    { w: layout.defaultWidth, h: layout.defaultHeight },
    layout,
  );
}

export function readDockBoardSize(layout: DockBoardLayout): DockBoardSize {
  const fallback = defaultDockBoardSize(layout);
  if (!layout.persistKey || typeof localStorage === "undefined") {
    return fallback;
  }
  try {
    const raw = localStorage.getItem(layout.persistKey);
    if (!raw) return fallback;
    const j = JSON.parse(raw) as { w?: unknown; h?: unknown };
    const w = Number(j.w);
    const h = Number(j.h);
    return clampDockBoardSize(
      {
        w: Number.isFinite(w) ? w : layout.defaultWidth,
        h: Number.isFinite(h) ? h : layout.defaultHeight,
      },
      layout,
    );
  } catch {
    return fallback;
  }
}

export function writeDockBoardSize(
  layout: DockBoardLayout,
  size: DockBoardSize,
): void {
  if (!layout.persistKey || typeof localStorage === "undefined") return;
  try {
    const c = clampDockBoardSize(size, layout);
    localStorage.setItem(layout.persistKey, JSON.stringify(c));
  } catch {
    /* ignore quota */
  }
}

/** Compact defaults for simple canvas/list boards. */
const COMPACT: DockBoardLayout = {
  defaultWidth: DOCK_EXPAND_W_UI,
  defaultHeight: DOCK_EXPAND_H_UI,
  minWidth: DOCK_EXPAND_W_UI,
  minHeight: 120,
  resizable: false,
  surface: "transparent",
};

/**
 * Per-card default layouts. New react faces only need an entry here
 * (+ face registration) — no BottomInfoBar if/else.
 */
export const DEFAULT_DOCK_BOARD_LAYOUT: Record<DockCardId, DockBoardLayout> = {
  logs: { ...COMPACT, surface: "transparent" },
  tasks: { ...COMPACT, surface: "transparent" },
  terminal: {
    defaultWidth: 520,
    defaultHeight: 360,
    minWidth: 360,
    minHeight: 180,
    resizable: true,
    persistKey: "maou-app-dock-terminal-size",
    surface: "dark",
  },
  agent: { ...COMPACT, surface: "transparent" },
  proactive: {
    defaultWidth: 680,
    defaultHeight: 440,
    minWidth: 520,
    minHeight: 300,
    resizable: true,
    persistKey: "maou-app-dock-proactive-size",
    surface: "paper",
  },
};

export function getDefaultDockBoardLayout(id: DockCardId): DockBoardLayout {
  return DEFAULT_DOCK_BOARD_LAYOUT[id] ?? COMPACT;
}
