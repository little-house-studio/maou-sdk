/**
 * Dock-plugin surface — first-class webui plugin slots for bottom folder boards.
 * Chrome (SVG ear / free-move) stays outside; face content is a free canvas host.
 */

import type { DockCardId, DockCardTone } from "../drafts/bottom-dock";

/** How the expanded board face paints its interior. */
export type DockContentKind = "canvas-ui" | "html-canvas" | "react";

/**
 * Plugin slot descriptor — registerable without rewriting dock chrome.
 * id/label/tone mirror dock chips; contentKind selects the face host.
 */
export type DockPluginSlot = {
  id: DockCardId;
  label: string;
  tone: DockCardTone;
  contentKind: DockContentKind;
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
