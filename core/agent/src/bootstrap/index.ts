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
} from "./presets.js";

export { installTerminalReviewer } from "./terminal-reviewer.js";
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

export { previewAgentSystemPrompt } from "./preview-prompt.js";
export type {
  PreviewSystemPromptOptions,
  PreviewSystemPromptResult,
} from "./preview-prompt.js";
