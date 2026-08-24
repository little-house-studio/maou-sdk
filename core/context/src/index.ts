/**
 * core/context — 上下文层 SDK
 *
 * 负责：
 * - 会话持久化（SessionStore）
 * - 多会话管理（SessionManager）
 * - 消息构建（buildMessages）
 * - 上下文压缩（maybeCompress）
 * - 结构化记忆（MemoryStore）
 * - 会话快照（CheckpointStore）
 * - 动态上下文编译（compileDynamicContext）
 */

// 会话持久化
export { SessionStore } from "./session-store.js";
export type { SessionData, SessionMeta, SessionMessage, SessionListItem, SessionTrace } from "./session-store.js";
export {
  selectBranch,
  filterLlmVisible,
  prefixThrough,
  ensureEntryIds,
  newEntryId,
} from "./session-tree.js";
export type { SessionVisibility, TreeFields } from "./session-tree.js";

// Maou 层消息结构体与转换函数
export type {
  MaouContent,
  MaouMessage,
  MaouMeta,
  MaouTaskBlock,
  TaskStatus,
  CompactMessage,
  MessageMeta,
  Pin,
  LLMMessage,
} from "./types/message.js";
export {
  maouToLLMMessage,
  maouToSessionMessage,
  sessionToMaouMessage,
  sessionMessagesToMaou,
  maouMessagesToLLM,
} from "./types/message.js";

// 多会话管理
export { SessionManager } from "./session-manager.js";

// 结构化记忆
export { MemoryStore } from "./memory-store.js";
export { extractMemories, DEFAULT_RULES } from "./memory-extractor.js";
export type { ExtractionRule } from "./memory-extractor.js";

// 会话快照
export { CheckpointStore } from "./checkpoint-store.js";

// 类型
export type {
  UserMessageOptions,
  BuildMessagesParams,
  CompressResult,
  ContextBuilder,
  MessagePriority,
  PriorityConfig,
  ActiveSession,
  SwitchResult,
  MemoryEntry,
  MemoryRecallResult,
  ExtractedMemory,
  CheckpointMeta,
  CheckpointDiff,
} from "./types.js";

// 常量
export {
  CONTEXT_THRESHOLD_PERCENT,
  CONTEXT_KEEP_RECENT_PERCENT,
  MAX_ROUNDS,
  DEFAULT_AGENT_ROUND_LIMIT,
  DEFAULT_LOOP_THRESHOLD,
  DEFAULT_PRIORITY_CONFIG,
  MICRO_TRIGGER_PERCENT,
  SUMMARY_TRIGGER_PERCENT,
  ARCHIVE_TRIGGER_PERCENT,
  ACTIVE_WINDOW_PERCENT,
  ACTIVE_WINDOW_MIN_MESSAGES,
  RETAIN_TAIL_RATIO,
  MAX_AUTO_CHECKPOINTS,
} from "./constants.js";

// 消息构建
export { buildMessages } from "./message-builder.js";

// 思考回灌上下文策略
export {
  parseThinkingContextMode,
  shouldStoreThinkingInContext,
  wrapThinking,
  contentWithThinkingForLlm,
  DEFAULT_THINKING_CONTEXT_MODE,
} from "./thinking-context.js";
export type { ThinkingContextMode } from "./thinking-context.js";

// 会话事件语义（author × kind × wireRole）
export {
  appendSessionEvent,
  resolveSessionEventKind,
  resolveMessageAuthor,
  isSessionEventKind,
  isHumanTurnKind,
  isUserBubbleKind,
  isNoticeUiKind,
  defaultWireRole,
  defaultAuthorForKind,
  formatAuthorLabel,
  authorHuman,
  authorAgent,
  authorSystem,
  authorTool,
} from "./session-event.js";
export type {
  SessionEventKind,
  AppendSessionEventInput,
  MessageAuthor,
  MessageAuthorType,
} from "./session-event.js";

// 会话事件源账本（sidecar；登记即入库 / 可查）
export {
  registerLedgerEvent,
  appendLedgerEvent,
  queryLedgerEvents,
  bindSessionLedgerPort,
  emitSessionLedger,
  listLedgerCatalog,
  installCoreLedgerCatalog,
  resetExtraLedgerCatalogForTests,
  getLedgerEventSpec,
  isLedgerEventType,
  ledgerPath,
  readLedgerRecords,
  KIND_TO_LEDGER_TYPE,
  LEDGER_FILE_SUFFIX,
  mirrorMessageToLedger,
} from "./session-ledger.js";
export type { LedgerEventSpec } from "./session-ledger.js";
export {
  SessionGoalService,
  sessionGoals,
  bindSessionGoalPort,
  foldGoal,
  applyGoalEvent,
  applyGoalChange,
  decodeGoalChange,
  emptyGoalFoldState,
  renderGoalRoundPrompt,
  renderGoalWrapup,
  renderGoalToolGuidance,
} from "./session-goal.js";
export type { GoalFoldState, GoalChangeMeta } from "./session-goal.js";
export {
  GoalHarnessService,
  goalHarness,
  goalHarnessDir,
  planPath,
  planBaselinePath,
  scratchPath,
  gapFingerprint,
  firstUncheckedPlanItem,
  renderPlanMarkdown,
  renderWorkerRules,
  renderContinuation,
} from "./goal-harness.js";
export {
  SessionPlanService,
  sessionPlan,
  sessionPlanDir,
  sessionPlanFile,
  bindSessionPlanPort,
  renderPlanPolicy,
  renderPlanKickoff,
  renderPlanRevise,
  renderPlanImplement,
} from "./session-plan.js";
export {
  appendToolResult,
  patchPendingToolInterrupts,
  pendingToolCallIdsAtTail,
  isToolCallIdPaired,
  formatToolFollowupText,
  findToolCallIdByPayload,
} from "./tool-result.js";
export type { AppendToolResultOutcome } from "./tool-result.js";

// 上下文压缩
export {
  maybeCompress,
  compressMaou,
  assignTaskIds,
  activeWindowBoundary,
  activeWindowSeqIds,
  retainTailBoundary,
  historyVisiblyChanged,
} from "./compressor.js";
export {
  pruneTextHeadTail,
  pruneToolResultText,
  pruneBodyText,
  TOOL_RESULT_PRUNE_MARKER,
  TOOL_RESULT_PRUNE_THRESHOLD_CHARS,
} from "./prune-text.js";
export {
  toolCallIdsOf,
  toolResultIdOf,
  snapRetainStartForToolPairs,
  toolPairingBalancedAt,
} from "./tool-pairing.js";
export type { Summarizer, CompressOptions, CompressMaouResult, CompressionStage, CompressionResult, TaskSummary } from "./compressor.js";

// Token 估算
export {
  estimateTokens,
  estimateTokensFromText,
  estimateTokensFromStrings,
  contextUsageRatio,
  contextRemainingRatio,
  parsePromptTokensFromUsage,
  estimateFullPromptTokens,
  resolveContextUsedTokens,
} from "./token-estimate.js";

// 超窗紧急截断 / 剥多模态
export {
  emergencyTrimMessages,
  estimateMessagesTokens,
  stripNonTextContent,
} from "./emergency-trim.js";
export type { EmergencyTrimResult } from "./emergency-trim.js";

// ContextEngine（编排压缩 + 持久化闭环）
export { ContextEngine } from "./context-engine.js";
export type {
  ContextEngineOptions,
  CompressReport,
  SeedWorkingSetResult,
} from "./context-engine.js";

// Harness 工作集（LLM 压缩上下文；含 B1 对齐 meta）
export {
  HarnessSessionStore,
  sessionMessageFingerprint,
  isHarnessMetaAligned,
} from "./harness-session-store.js";
export type {
  HarnessSessionStoreOptions,
  HarnessWorkingSetMeta,
  HarnessCurrentRecord,
} from "./harness-session-store.js";

// 注：compileDynamicContext / formatAgentStatus 已上移到 @little-house-studio/agent（需要 AgentRegistry）；
//     SkillScanner / SkillContextManager 已下放到 @little-house-studio/tools。

// 项目上下文注入
export {
  loadProjectContext,
  compileProjectContext,
  resolveProjectContextMode,
} from "./project-context.js";
export type { ProjectContext, ProjectContextMode } from "./project-context.js";

// 平台上下文（插件可注册平台特定上下文）
export { PlatformContextRegistry, platformContextRegistry, buildPlatformContext } from "./platform-context.js";
export type { PlatformContextRequest, PlatformContextProvider, BuildPlatformContextOptions } from "./platform-context.js";

// 任务块存储
export { TaskSessionStore } from "./task-session-store.js";
export type { TaskPlanEntry } from "./task-session-store.js";

// BakeFile：磁盘文件 → 文件缓存区 + 上下文动态区 diff
export { BakeFile, bake } from "./bake-file.js";
export type { BakeFileOptions, BakeMode } from "./bake-file.js";

// 自动压缩
export {
  AutoCompressSession,
  TokenThresholdPolicy,
  resolveAutoCompressConfig,
  moduleConfigFor,
  toModuleContext,
  DEFAULT_AUTO_COMPRESS_CONFIG,
  DEFAULT_SUMMARIZER_PROMPT,
} from "./auto-compress.js";
export type {
  AutoCompressConfig,
  AutoCompressResult,
  CompressPolicy,
  CompressMode,
  LegacyCompressConfig,
  StagedCompressConfig,
} from "./auto-compress.js";

// 上下文模块（内置 legacy / staged，可注册替换）
export {
  contextModules,
  registerContextModule,
  resolveContextModule,
  resetContextModulesForTest,
  ContextModuleRegistry,
  legacyContextModule,
  stagedContextModule,
  DEFAULT_LEGACY_CONFIG,
  DEFAULT_STAGED_CONFIG,
  BUILTIN_CONTEXT_MODULE_IDS,
} from "./modules/index.js";
export type {
  ContextModule,
  ContextModuleResult,
  ContextCompressContext,
  BuiltinContextModuleId,
  SummaryModelConfig,
} from "./modules/index.js";

export {
  toAgentSendMessage,
  toAgentUserMessage,
  flattenAgentSendText,
  formatAgentSendSessionText,
  formatAgentSendRuntimeText,
  agentSendImages,
  agentSendVideo,
  agentSendAudio,
  resolveAgentSendMode,
  agentUserMessageText,
  unwrapAgentSendTag,
} from "./user-message.js";