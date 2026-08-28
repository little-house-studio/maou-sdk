/**
 * Public shell seat map — declare-only surface for plugins.
 * Layout chrome lives in the SPA host, not this export.
 */
export {
  SHELL_CHILDREN,
  BODY_CHILDREN,
  SIDEBAR_CHILDREN,
  BOTTOM_CHILDREN,
  CONVERSATION_CHILDREN,
  COMPOSER_CHILDREN,
  COMPOSER_BAR_CHILDREN,
  CENTER_MODE_KEYS,
  ASIDE_LEFT_TAB,
  ASIDE_LEFT_PANE,
  ASIDE_RIGHT_TAB,
  ASIDE_RIGHT_PANE,
  type CenterModeKey,
} from "../slots/map";
export {
  registerAsideTab,
  type RegisterAsideTabSpec,
  type AsideEdge,
  type AsideTabIcon,
} from "./aside-tab";
export {
  FILES_ACTIVITY_ID,
  SIDEBAR_ACTIVITY_ID,
  toggleAsideTab,
} from "./activity";
export { registerSlotPlugin, type SlotPlugin } from "../slots";
