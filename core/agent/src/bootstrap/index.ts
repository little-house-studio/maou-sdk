/**
 * Agent 通用装配 / 监督 / 配置 — 所有 agent 实例与 CLI 共用。
 */

export {
  setSupervisorAbortSignal,
  getSupervisorAbortSignal,
  createCallMainAgent,
} from "./supervisor.js";
export type {
  CreateCallMainAgentOptions,
  MainAgentRunner,
} from "./supervisor.js";

export {
  loadPresetsFromMaouConfig,
  getDefaultPresetFromMaouConfig,
  getDefaultPresetFromConfigStore,
  resolveMaouConfigPath,
  isGlobalApiConfigured,
  saveGlobalApiConfig,
  getGlobalMaouRoot,
  getRolePresetFromMaouConfig,
} from "./presets.js";
export type { GlobalApiWriteOptions } from "./presets.js";

export {
  installTerminalReviewer,
  resolveTerminalReviewPreset,
  TERMINAL_AUTO_REVIEW_HELPER,
} from "./terminal-reviewer.js";
export type { InstallTerminalReviewerOptions } from "./terminal-reviewer.js";

export {
  createStandardAgentDeps,
  listAgentsForCli,
  resolvePresetForCli,
  listProvidersForCli,
  listModelsForCli,
} from "./runtime-deps.js";
export type {
  StandardAgentDeps,
  CreateStandardAgentDepsOptions,
} from "./runtime-deps.js";

export {
  createAgentSkillManager,
  applyAgentSkillOptions,
  toSkillScanOptions,
  getDefaultSkillScanOptions,
  getSystemNpmSkillDirs,
  setDefaultSkillScanOptions,
  resolveSkillScanOptions,
} from "./skills.js";
export type { AgentSkillOptions, SkillScanOptions } from "./skills.js";

export {
  previewAgentSystemPrompt,
  previewAgentRequestBundle,
} from "./preview-prompt.js";
export type {
  PreviewSystemPromptOptions,
  PreviewSystemPromptResult,
  PreviewRequestBundleResult,
  PreviewRequestSection,
} from "./preview-prompt.js";
