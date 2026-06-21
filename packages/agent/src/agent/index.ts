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

// ── 提示词与模板解析 ──────────────────────────────────────────────────────

export { PromptCompiler } from "./prompt-compiler.js";
export type { PromptCompilerOptions } from "./prompt-compiler.js";

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

// ── Agent 注册表与工厂 ─────────────────────────────────────────────────────

export { AgentRegistry, initMainAgent } from "./registry.js";
export type { AgentEntry, CreateAgentOptions } from "./registry.js";

export { AgentFactory } from "./factory.js";
export type {
  AgentFactoryConfig,
  AgentCreateResult,
  AgentPreview,
} from "./factory.js";
