export { WireShell } from "./WireShell";
export { SidebarFrame } from "./SidebarFrame";
export { LiveMid } from "./LiveMid";
export { LeftAside } from "./LeftAside";
export { RightAside } from "./RightAside";
export { ActivityBar } from "./ActivityBar";
export { AsidePane, useAsideLatch } from "./AsidePane";
export { registerAsideTab, AsidePaneStack } from "./aside-tab";
export {
  FILES_ACTIVITY_ID,
  SIDEBAR_ACTIVITY_ID,
  toggleAsideTab,
} from "./activity";
export {
  SHELL_LEFT,
  SHELL_ACTIVITY,
  SHELL_ASIDE_ANIM_MS,
  LIVE_FILES_RAIL,
} from "./metrics";
export {
  SHELL_FOCUS_REGIONS,
  closestShellRegion,
  isShellFocusRegion,
} from "./focus";
export type { ShellFocusRegion } from "./focus";
export type { WireHostBag, WireShellVariant, LiveChatBag } from "./types";
export type { ActivityBarProps } from "./activity";
export type { AsideEdge, AsideTabIcon, RegisterAsideTabSpec } from "./aside-tab";
