/**
 * @little-house-studio/tools/security
 *
 * 操作安全策略统一入口。通用规则集中在此；领域特例可留在各工具旁。
 *
 * 目录：
 *   gate.ts                 — 三层门禁（fatal / dangerous / safe）
 *   types.ts                — 公共类型
 *   hard-deny.ts            — 致命硬拦
 *   local-rules.ts          — 补 DCG 默认未覆盖的资产/供应链风险
 *   dcg/client.ts           — DCG 二进制适配
 *   dcg/safe-allow.ts       — 开发安全操作白名单（产物 rm 等）
 *   approval/terminal-policy.ts — 用户白/黑名单与 normal/auto/yolo
 *
 * 执行层沙箱（路径 jail）仍在 terminal-engine，由 initTerminalEngine 配置。
 */

export type {
  SecurityTier,
  SecurityGateAction,
  SecurityAssessment,
  SecurityGateResult,
  SecuritySource,
} from "./types.js";

export {
  assessCommandSecurity,
  gateTerminalCommand,
  mapDcgDenyToTier,
} from "./gate.js";

export { checkMaouHardDeny } from "./hard-deny.js";
export type { MaouHardDenyHit } from "./hard-deny.js";

export { checkLocalSecurityRules, listLocalSecurityRules } from "./local-rules.js";
export type { LocalRuleHit } from "./local-rules.js";

export {
  evaluateWithDcg,
  resolveDcgBinary,
  ensureDcgInstalled,
  formatDcgDenyMessage,
  setDcgEvaluatorForTest,
  resetDcgBinaryCache,
} from "./dcg/client.js";
export type { DcgEvalResult, DcgGuardOptions, DcgDecision, DcgEvaluator } from "./dcg/client.js";

export { matchMaouSafeAllow, tryOverrideDcgDeny } from "./dcg/safe-allow.js";
export type { MaouSafeAllowHit } from "./dcg/safe-allow.js";

export {
  setTerminalPolicyRoot,
  setTerminalReviewer,
  setTerminalApprover,
  getTerminalReviewer,
  getTerminalApprover,
  getMode,
  setMode,
  addToWhitelist,
  addToBlacklist,
  decideCommand,
  normalizeCommand,
  commandPrefix,
  recordReviewApprove,
  recordReviewReject,
  markCommandForRepeatConfirm,
  isCommandRepeatConfirm,
  consumeRepeatConfirm,
  getRepeatConfirmWindowMs,
} from "./approval/terminal-policy.js";
export type {
  TerminalMode,
  TerminalReviewer,
  TerminalApprover,
  PolicyAction,
  PolicyDecision,
} from "./approval/terminal-policy.js";

export {
  describeCommandForApproval,
} from "./command-summary.js";
export type {
  CommandRiskLevel,
  CommandHumanSummary,
} from "./command-summary.js";
