/**
 * harness — 产品层（Harness 层）
 *
 * 消费 core（llm/agent/tools/context/common）和 hub，
 * 提供 Server、Runtime 等完整产品功能。
 *
 * 以下内容已从 harness/ 分离到 core/ 各层，
 * 此处仅做重新导出以保持向后兼容：
 */

// ─── Server ──────────────────────────────────────────────────────────────────
export { MaouServer } from './server.js'

// ─── Runtime ─────────────────────────────────────────────────────────────────
export { Runtime } from './runtime.js'
export type { RuntimeOptions } from './runtime.js'

// ─── SDK 类型（已移至 core/agent_factory/types.ts）──────────────────────────
export {
  MessageType,
  DeviceStatus,
  AGENT_EVENT_TYPES,
  createMessage,
  createAgentEvent,
  createDeviceInfo,
} from '@little-house-studio/agent'
export type {
  AgentEventType,
  Message,
  AgentEvent,
  ToolCall,
  ToolResult,
  DeviceInfo,
} from '@little-house-studio/agent'

// ─── 事件总线（已移至 core/agent_factory/event-bus.ts）───────────────────────
export { EventBus } from '@little-house-studio/agent'
export type { EventHandler } from '@little-house-studio/agent'

// ─── 插件系统（已移至 core/agent_factory/plugin.ts）──────────────────────────
export { PluginBase, discoverPlugins } from '@little-house-studio/agent'

// ─── 技能系统（已移至 core/agent_factory/skill.ts）───────────────────────────
export {
  SkillRegistry,
  parseSkillFile,
  renderSkill,
} from '@little-house-studio/agent'
export type { Skill } from '@little-house-studio/agent'

// ─── 钩子系统（已移至 core/agent/hooks.ts）────────────────────────────────────
export { Hooks, ALL_HOOKS } from '@little-house-studio/agent'
export type { HookHandler, HookName } from '@little-house-studio/agent'

// ─── 客户端（已移至 hub/client.ts）───────────────────────────────────────────
export { ClientBase, HubClient } from '../hub/client.js'
export type { MessageListener } from '../hub/client.js'

// ─── 平台上下文 SDK（已移至 core/context/platform-context.ts）─────────────────
export {
  PlatformContextRegistry,
  platformContextRegistry,
  buildPlatformContext,
} from '@little-house-studio/context'
export type {
  PlatformContextRequest,
  PlatformContextProvider,
  BuildPlatformContextOptions,
} from '@little-house-studio/context'

// ─── Git（已移至 core/agent_factory/git-watcher.ts）──────────────────────────
export { GitWatcher } from '@little-house-studio/agent'
export type { DiffMeta, RollbackResult } from '@little-house-studio/agent'