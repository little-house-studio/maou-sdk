export {
  DEFAULT_SESSION_FEATURES,
  resolveSessionFeatures,
} from "./ports.js";
export type {
  AssemblyHook,
  AssemblyHookMeta,
  AssemblyMessage,
  AssemblySlot,
  FoldStep,
  FoldStepInput,
  FoldStepOutput,
  SessionLayout,
  SessionRecordFeatures,
  SessionRecordOptions,
} from "./ports.js";

export { maouSessionLayout } from "./layout.js";

export {
  assemble,
  createAssembly,
  defineHook,
  defineSlot,
} from "./assembly.js";
export type { Assembly } from "./assembly.js";

export {
  builtinFoldSteps,
  createFoldPipeline,
  pairToolsRetainStep,
  pruneToolResultsStep,
  traditionalFoldSteps,
  windowPressureStep,
} from "./fold-pipeline.js";
export type { FoldPipeline } from "./fold-pipeline.js";

export {
  DEFAULT_FOLD_STAGE,
  applyFoldStage,
  applyLlmMajorCompress,
  foldStageStep,
  foldUnfoldedSpan,
  resolveFoldStage,
} from "./fold-stage.js";
export type {
  ApplyFoldStageInput,
  ApplyFoldStageResult,
  CustomFoldFn,
  FoldSummarizer,
} from "./fold-stage.js";
export type { FoldStageConfig, TraditionalMajorScheme } from "./ports.js";
export { TRADITIONAL_MAJOR_SCHEMES, resolveTraditionalMajorScheme } from "./ports.js";

export { createMessageTree } from "./message-tree.js";

export {
  createContextParts,
  createSessionRecord,
  createWorkingSet,
} from "./session-record.js";
export type {
  ContextParts,
  ContextPartsOptions,
} from "./session-record.js";
