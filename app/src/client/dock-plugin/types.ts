/**
 * Dock-plugin surface — first-class webui plugin slots for bottom folder boards.
 * Chrome (SVG ear / free-move / size) stays outside; face content is a free host.
 *
 * Designers:
 * 1. Declare layout (default size, resizable, surface) on the slot
 * 2. Pass a React face via `faces[id]` (or use canvas/html preview)
 * 3. Style interior against DockBoardShell surface tokens — not dock chrome
 */

import type { ReactNode } from "react";
import type { DockCardId, DockCardTone } from "./ids";
import type { DockBoardLayout, DockBoardSurface } from "./layout";

/** How the expanded board face paints its interior. */
export type DockContentKind = "canvas-ui" | "html-canvas" | "react";

/**
 * Plugin slot descriptor — registerable without rewriting dock chrome.
 * id/label/tone mirror dock chips; layout drives open size; contentKind selects face host.
 */
export type DockPluginSlot = {
  id: DockCardId;
  label: string;
  tone: DockCardTone;
  contentKind: DockContentKind;
  /**
   * Open size / surface / resize.
   * Omit → DEFAULT_DOCK_BOARD_LAYOUT[id] (always resolved at runtime).
   */
  layout?: DockBoardLayout;
  /** Short blurb for plugin list / debug. */
  description?: string;
};

/** Runtime paint context passed into canvas-ui face painters. */
export type DockCanvasPaintInput = {
  id: DockCardId;
  title: string;
  lines: string[];
  /** Optional badge / count for HUD. */
  count?: number;
  /** Tone fill as CSS color string for accent bar. */
  accent?: string;
};

export type DockPluginRegistry = {
  slots: DockPluginSlot[];
};

/** Live shell injects React faces by card id (terminal, proactive, …). */
export type DockFaceMap = Partial<Record<DockCardId, ReactNode>>;

export type { DockBoardLayout, DockBoardSurface };
