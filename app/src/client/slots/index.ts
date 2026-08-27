export { SlotCore } from "./core";
export { SlotRegistry, type SlotPlugin } from "./registry";
export {
  SlotOutlet,
  PassSlot,
  SlotsProvider,
  renderSlot,
  useOptionalSlots,
  useSlots,
  StaleAuthorizationError,
  SlotOwnershipError,
} from "./render";
export {
  SHELL_CHILDREN,
  BODY_CHILDREN,
  SIDEBAR_CHILDREN,
  BOTTOM_CHILDREN,
  CONVERSATION_CHILDREN,
  COMPOSER_CHILDREN,
  COMPOSER_BAR_CHILDREN,
  CENTER_MODE_KEYS,
  type CenterModeKey,
} from "./map";
export {
  resolveSlotLabel,
  type SlotKind,
  type SlotScope,
  type SlotSpec,
  type SlotChildren,
  type SlotEntry,
  type SlotRegisterOptions,
  type SlotSnapshotNode,
} from "./types";
