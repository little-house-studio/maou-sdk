import type { SlotChildren } from "./types";

export const ASIDE_LEFT_TAB = "aside.left.tab";
export const ASIDE_LEFT_PANE = "aside.left.pane";
export const ASIDE_RIGHT_TAB = "aside.right.tab";
export const ASIDE_RIGHT_PANE = "aside.right.pane";

/**
 * Seats that match the current product chrome.
 * Declaring a seat here is the only way a plugin may register into it.
 * Visible layout stays: topbar / left+right aside tabs / center mode / bottom.
 */
export const SHELL_CHILDREN = {
  "shell.topbar": { kind: "single", scope: "root" },
  "shell.body": { kind: "single", scope: "root" },
  "shell.bottom": { kind: "single", scope: "root" },
  "shell.overlay": { kind: "list", scope: "root" },
} as const satisfies SlotChildren;

export const BODY_CHILDREN = {
  "shell.center": { kind: "keyed", scope: "root" },
  [ASIDE_LEFT_TAB]: { kind: "list", scope: "root" },
  [ASIDE_LEFT_PANE]: { kind: "keyed", scope: "root" },
  [ASIDE_RIGHT_TAB]: { kind: "list", scope: "root" },
  [ASIDE_RIGHT_PANE]: { kind: "keyed", scope: "root" },
} as const satisfies SlotChildren;

export const SIDEBAR_CHILDREN = {
  "sidebar.agents": { kind: "single", scope: "root" },
  "sidebar.sessions": { kind: "single", scope: "root" },
} as const satisfies SlotChildren;

export const BOTTOM_CHILDREN = {
  "bottom.card": { kind: "keyed", scope: "root" },
} as const satisfies SlotChildren;

/** Chat center — conversation column. */
export const CONVERSATION_CHILDREN = {
  "conversation.trail": { kind: "single", scope: "session" },
  "conversation.messages": { kind: "single", scope: "session" },
  "conversation.permit": { kind: "single", scope: "session" },
  "conversation.composer": { kind: "chain", scope: "session" },
  "conversation.overlay": { kind: "list", scope: "session" },
} as const satisfies SlotChildren;

export const COMPOSER_CHILDREN = {
  "composer.queue": { kind: "list", scope: "session" },
  "composer.bar": { kind: "single", scope: "session" },
  "composer.footer": { kind: "list", scope: "session" },
} as const satisfies SlotChildren;

export const COMPOSER_BAR_CHILDREN = {
  "composer.overlay": { kind: "list", scope: "session" },
  "composer.left": { kind: "list", scope: "session" },
  "composer.plan": { kind: "single", scope: "session" },
  "composer.approval-mode": { kind: "single", scope: "session" },
  "composer.model": { kind: "single", scope: "session" },
  "composer.usage": { kind: "single", scope: "session" },
  "composer.right": { kind: "list", scope: "session" },
} as const satisfies SlotChildren;

/** Center mode keys — existing UiMode, not a new surface. */
export const CENTER_MODE_KEYS = [
  "chat",
  "project",
  "team",
  "settings",
] as const;

export type CenterModeKey = (typeof CENTER_MODE_KEYS)[number];
