/**
 * @little-house-studio/agent — Agent 层
 *
 * 双层设计，兼顾"最小可用"与"100% 可扩展"：
 *
 * ① 极简入口（开箱即用）
 *    agentLoop() —— 定义工具 → 调模型 → 执行工具 → 喂回结果 → 循环。
 *    来自 @little-house-studio/llm（LLM 层的 agent 循环权威实现），此处 re-export。
 *
 * ② 可扩展底座（实现自定义循环策略）
 *    IAgentLoop / DefaultAgentLoop —— 把循环的条件/终止/中断抽成接口，
 *    外部可实现 plan 模式、task 模式等自定义策略。
 *
 * ③ 扩展件（可选，按需用）
 *    提示词编译(PromptCompiler)、token 追踪(TokenTracker)、Agent 注册表/工厂、
 *    烘焙系统(BakeSystem)、事件总线(EventBus)、技能注册(SkillRegistry)、Git 监听(GitWatcher)、
 *    插件基类(PluginBase)、动态上下文(compileDynamicContext)。
 *    这些是"重型 agent 管理"件，最小 agent 不强制依赖，但 SDK 全量提供以保证可扩展性。
 */

// ① 极简入口：agentLoop（权威实现在 @little-house-studio/llm）
export {
  agentLoop,
} from "@little-house-studio/llm";
export type {
  AgentLoopTool,
  AgentLoopAnyTool,
  AgentLoopParams,
  AgentLoopEvent,
  AgentLoopResult,
  AgentLoopStopReason,
} from "@little-house-studio/llm";

// Agent 层核心（注册表、工厂、提示词编译、token 追踪、agent-loop 接口、烘焙）
export * from "./agent/index.js";

// Hooks 钩子系统
export * from "./agent/hooks.js";

// Agent Factory（SDK 插件层）
export * from "./agent_factory/event-bus.js";
export * from "./agent_factory/skill.js";
export * from "./agent_factory/git-watcher.js";
export * from "./agent_factory/plugin.js";
export * from "./agent_factory/types.js";

// 动态上下文编译（团队 Agent 状态 + 终端状态面板）
export { compileDynamicContext, formatAgentStatus } from "./dynamic-context.js";
