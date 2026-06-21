/**
 * @little-house-studio/agent-harness — Agent 运行时层
 *
 * 内容：Agent 注册表/工厂、提示词编译、token 追踪、agent-loop 接口、烘焙系统，
 * 以及 Agent Factory（事件总线 / 技能注册 / Git 监听 / 插件基类）和动态上下文编译。
 *
 * 注：原 harness 的 Express 服务端（server.ts / runtime.ts）属应用层
 *     （依赖 plugins/hub/express），未纳入本 SDK 包，与 cli / webui 一并作为应用单独维护。
 */

// Agent 层（注册表、工厂、提示词编译、token 追踪、agent-loop、烘焙）
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
