/**
 * 草稿站公开面：DraftShell + 场景 fixture + 草稿设置模型。
 * 共享组件库在 ../wire；生产代码不依赖本目录（boundary.test.ts 守护）。
 */
export { DraftShell } from "./DraftShell";
export {
  SCENARIO_CATALOG,
  REQUIRED_SCENARIO_IDS,
  FULL_CONTEXT_MESSAGES,
  SHOWCASE_FLAGS,
  SHOWCASE_REQUIRED_ROLES,
  assertCatalogComplete,
  assertContextShowcaseComplete,
  inspectContextShowcase,
  showcaseMessages,
  getScenario,
  listScenarioIds,
  hydrateFromScenario,
  applyLocalSend,
  applyNewSession,
  applyForkSession,
  applyChildSession,
  applyDraftSlash,
  applyApprovalDecision,
  messagesForSession,
  sessionTitle,
  sessionsForAgent,
  pickSessionForAgent,
} from "./fixtures";
export {
  defaultApiConfig,
  cloneApiConfig,
  maskApiKey,
  validateApiPreset,
  addApiPreset,
  updateApiPreset,
  removeApiPreset,
  setDefaultApiPreset,
  getDefaultPreset,
  emptyApiPreset,
  normalizeDraftApiPreset,
  normalizeApiPreset,
  defaultCapabilityFields,
  capabilitySummary,
  formatTokenCount,
  DEFAULT_MAX_CONTEXT,
  DEFAULT_MAX_TOKENS,
  API_PROTOCOLS,
  PROTOCOL_LABEL,
} from "./api-settings";
export type { DraftShellProps, DraftScenario, ScenarioId } from "./types";
export type {
  DraftSession,
  DraftMessage,
  DraftMeta,
  DraftApproval,
  DraftAgent,
  DraftBgTask,
  DraftApiPreset,
  DraftApiConfig,
  DraftApiProtocol,
  UiMode,
  MessageRole,
} from "../wire/types";
