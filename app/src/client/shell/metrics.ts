/** Shared left rail width. */
export const SHELL_LEFT = {
  default: 260,
  min: 200,
  max: 360,
  agentPct: 24,
} as const;

/** Icon activity strip on both rails. */
export const SHELL_ACTIVITY = {
  width: 36,
} as const;

import { MOTION_DUR_SLOW_MS } from "../motion";

/** Aside open/close width animation. CSS must use the same ms. */
export const SHELL_ASIDE_ANIM_MS = MOTION_DUR_SLOW_MS;

export const LIVE_FILES_RAIL = {
  default: 320,
  min: 220,
  max: 520,
} as const;
