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

// Harness 层消息结构体与转换函数
export type {
  HarnessContent,
  HarnessMessage,
  HarnessTaskBlock,
  LLMMessage,
} from "./types/message.js";
export {
  harnessToLLMMessage,
  harnessToSessionMessage,
  sessionToHarnessMessage,
  sessionMessagesToHarness,
  harnessMessagesToLLM,
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
} from "./constants.js";

// 消息构建
export { buildMessages } from "./message-builder.js";

// 上下文压缩
export { maybeCompress } from "./compressor.js";
export type { CompressionZone, CompressionResult, TaskSummary } from "./compressor.js";

// 注：compileDynamicContext / formatAgentStatus 已上移到 @little-house-studio/agent-harness（需要 AgentRegistry）；
//     SkillScanner / SkillContextManager 已下放到 @little-house-studio/tools。

// 项目上下文注入
export { loadProjectContext, compileProjectContext } from "./project-context.js";

// 平台上下文（插件可注册平台特定上下文）
export { PlatformContextRegistry, platformContextRegistry, buildPlatformContext } from "./platform-context.js";
export type { PlatformContextRequest, PlatformContextProvider, BuildPlatformContextOptions } from "./platform-context.js";

// Harness Session 存储（双份：当前上下文 + 压缩前备份）
export { HarnessSessionStore } from "./harness-session-store.js";
export type { HarnessSessionStoreOptions } from "./harness-session-store.js";

// 任务块存储
export { TaskSessionStore } from "./task-session-store.js";
export type { TaskBlock } from "./task-session-store.js";