/**
 * 主动智能 —— Agent 层附属驻扎约定（挂靠主 coding，非可切换主体）
 *
 * 身份分类权威在 agent-identity.ts（产品只有 ops/coding；proactive 是奴隶附属）。
 */

export const DEFAULT_PROACTIVE_AGENT_NAME = "proactive";
export const DEFAULT_PROACTIVE_PARENT_AGENT = "coding";
export const DEFAULT_PROACTIVE_ROUND_LIMIT = 24;

/** @deprecated 请从 agent-identity 导入；此处 re-export 保持旧路径 */
export {
  STATIONED_AFFILIATE_AGENT_NAMES,
  isStationedAffiliateAgentName,
} from "../agent-identity.js";

/** 只读扫描工具（对齐 task/explore 预设 + lsp） */
export const PROACTIVE_SCAN_TOOL_WHITELIST = [
  "reader",
  "glob",
  "grep",
  "find_code",
  "lsp",
  "search_internet",
  "use_skill",
  "find_skill",
] as const;

export const PROACTIVE_BOARD_REL = ".maou/project/PROACTIVE.md";
export const PROACTIVE_SETTINGS_REL = ".maou/project/proactive-settings.json";
