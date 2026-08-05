/**
 * Agent 层 · 主动智能（附属驻扎 subagent）
 *
 * 路径约定（nested）：
 *   <project>/.maou/agents/coding/subagents/proactive/
 *
 * 不作为可切换主体；由 ProactiveService 驱动，落地派发主体 coding。
 */

export {
  PROACTIVE_ZONES,
  DEFAULT_PROACTIVE_SETTINGS,
  type ProactiveZone,
  type ProactiveRisk,
  type ProactiveItem,
  type ProactiveBoard,
  type ProactiveFrequency,
  type ProactiveSettings,
  type ProactiveJobState,
  type ProactiveChatLine,
} from "./types.js";

export {
  isProactiveZone,
  itemId,
  parseItemLine,
  formatItemLine,
  emptyBoardMarkdown,
  parseProactiveMarkdown,
  serializeProactiveBoard,
  mergeSuggestions,
  setItemDone,
  setItemChecked,
  isQueued,
  normalizeSettings,
  canRunToday,
  bumpRun,
  parseSuggestionsFromModelText,
  buildScanUserPrompt,
  buildDispatchUserMessage,
} from "./board-format.js";

export {
  BOARD_REL,
  SETTINGS_REL,
  boardPath,
  settingsPath,
  readBoard,
  writeBoard,
  writeBoardRaw,
  readSettings,
  writeSettings,
  patchSettings,
  findItem,
} from "./board-store.js";

export {
  DEFAULT_PROACTIVE_AGENT_NAME,
  DEFAULT_PROACTIVE_PARENT_AGENT,
  DEFAULT_PROACTIVE_ROUND_LIMIT,
  PROACTIVE_SCAN_TOOL_WHITELIST,
  PROACTIVE_BOARD_REL,
  PROACTIVE_SETTINGS_REL,
  STATIONED_AFFILIATE_AGENT_NAMES,
  isStationedAffiliateAgentName,
} from "./defaults.js";

export {
  ensureProactiveStationed,
  resolveProactiveStationDir,
  type EnsureProactiveStationedOpts,
  type ProactiveStation,
} from "./station.js";

export {
  createProactiveAffiliateRunner,
  type ProactiveRunner,
  type ProactiveRunnerOpts,
} from "./runner.js";

export {
  ProactiveService,
  ProactiveHub,
  type ProactiveServiceOpts,
  type ProactiveHubOpts,
  type ProactiveSnapshot,
  type CodingDispatchPort,
} from "./service.js";
