/**
 * Agent 层统一 SDK 入口。
 *
 * 按设计文档 docs/SDK设计.md 中 Agent 层的内容组织导出：
 * - 提示词与模板解析系统
 * - agent-loop 接口（条件与调用）
 * - 烘培与增量注入系统
 * - 会话管理（创建/切换/fork/清空会话）
 * - token 用量追踪与费用计算
 * - agent 注册表与工厂
 */

// ── 提示词与模板解析（已迁移到 @little-house-studio/prompt）─────────────

export { PromptCompiler } from "@little-house-studio/prompt";
export type { PromptCompilerOptions } from "@little-house-studio/prompt";

// ── Agent-loop 接口 ────────────────────────────────────────────────────────

export { DefaultAgentLoop } from "./agent-loop.js";
export type {
  IAgentLoop,
  LoopConfig,
  LoopState,
  LoopResult,
  LoopIterationResult,
} from "./agent-loop.js";

// ── 烘培与增量注入系统 ────────────────────────────────────────────────────

export { BakeSystem } from "./bake.js";
export type {
  BakeTrigger,
  BakeEntry,
  BakeSystemConfig,
} from "./bake.js";

// ── 会话管理 ───────────────────────────────────────────────────────────────
// 注：SessionStore 及其类型的权威出口是 @little-house-studio/context，
// agent 不再转手导出（避免同一符号两个入口）。请直接从 context 包引入。

// ── Token 用量追踪与费用计算 ──────────────────────────────────────────────

export { TokenTracker } from "./token-tracker.js";
export type {
  TokenUsage,
  PricingInfo,
  TokenRecord,
  DailySummary,
} from "./token-tracker.js";

// ── Agent 运行时 ───────────────────────────────────────────────────────────

export { AgentRuntime } from "./runtime.js";
export type {
  RuntimeOptions,
  ModelCallParams,
  RunOptions,
} from "./runtime.js";

// ── Runtime 门面（通用高层包装，所有 agent 应用复用）─────────────────────────

export { Runtime } from "./runtime-facade.js";
export type { AppRuntimeOptions } from "./runtime-facade.js";
export { createAppLogger } from "./app-logger.js";
export { createAgentFromTemplate, renderAgentPreview } from "./template.js";
export type { CreateAgentOptions as CreateAgentFromTemplateOptions } from "./template.js";

// ── Agent 注册表与工厂 ─────────────────────────────────────────────────────

export { AgentRegistry, initMainAgent } from "./registry.js";
export type { AgentEntry, CreateAgentOptions, ChannelEntry, ScheduleEntry, AgentToolEntry } from "./registry.js";

export { AgentFactory } from "./factory.js";
export type {
  AgentFactoryConfig,
  AgentCreateResult,
  AgentPreview,
} from "./factory.js";

// ── defineAgent API（文件即 Agent 约定）──────────────────────────────────

export { defineAgent } from "./define-agent.js";
export type {
  DefineAgentConfig,
  DefinedAgent,
  ModelFallback,
  CompactionConfig,
} from "./define-agent.js";

// ── 消息通道注册表 ─────────────────────────────────────────────────────────

export { ChannelRegistry } from "./channel-registry.js";
export type { ChannelConfig } from "./channel-registry.js";

// ── 定时任务注册表 ─────────────────────────────────────────────────────────

export { ScheduleRegistry } from "./schedule-registry.js";
export type { ScheduleConfig } from "./schedule-registry.js";

// ── defineChannel API ──────────────────────────────────────────────────────

export { defineChannel } from "./define-channel.js";
export type {
  ChannelType,
  ChannelMessage,
  ChannelResponse,
  ChannelAdapter,
  DefineChannelConfig,
  DefinedChannel,
} from "./define-channel.js";

// ── defineSchedule API + CronScheduler ─────────────────────────────────────

export { defineSchedule, CronScheduler } from "./define-schedule.js";
export type {
  DefineScheduleConfig,
  DefinedSchedule,
} from "./define-schedule.js";

// ── defineConnection API + ConnectionRegistry ──────────────────────────────

export { defineMcpConnection, defineOpenApiConnection, ConnectionRegistry } from "./define-connection.js";
export type {
  ConnectionAuth,
  TokenAuth,
  OAuthAuth,
  ApiKeyAuth,
  ConnectionType,
  DefineMcpConnectionConfig,
  DefineOpenApiConnectionConfig,
  DefinedConnection,
} from "./define-connection.js";

// ── 子 Agent 注册表 ────────────────────────────────────────────────────────

export { SubagentRegistry } from "./subagent-registry.js";
export type { SubagentEntry } from "./subagent-registry.js";

// ── defineEval API + EvalRunner ─────────────────────────────────────────────

export { defineEval, EvalRunner, EvalContext, includes, notIncludes, matchesRegex, equals } from "./define-eval.js";
export type {
  DefineEvalConfig,
  DefinedEval,
  EvalCheckResult,
  EvalRunResult,
} from "./define-eval.js";
