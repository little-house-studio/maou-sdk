export type {
  BuiltinContextModuleId,
  ContextCompressContext,
  ContextModule,
  ContextModuleResult,
  SummaryModelConfig,
} from "./types.js";
export {
  BUILTIN_CONTEXT_MODULE_IDS,
  DEFAULT_SUMMARIZER_PROMPT,
} from "./types.js";

export type { LegacyCompressConfig } from "./legacy.js";
export { DEFAULT_LEGACY_CONFIG, legacyContextModule } from "./legacy.js";

export type { StagedCompressConfig } from "./staged.js";
export { DEFAULT_STAGED_CONFIG, stagedContextModule } from "./staged.js";

export {
  ContextModuleRegistry,
  contextModules,
  registerContextModule,
  resolveContextModule,
  resetContextModulesForTest,
} from "./registry.js";
