/**
 * Hub 模块 — 多设备通信中心
 * 对齐 Python: core/server/hub/
 */

export { EventBus } from './event-bus.js'
export { DeviceRegistry } from './device-registry.js'
export { HubServer } from './server.js'
export { ClientBase, HttpClient, HubClient } from './client.js'
export type { MessageListener } from './client.js'
export type {
  DeviceInfo,
  DeviceStatus,
  HubMessage,
  MessageType,
  HubEvent,
  HubConfig,
} from './types.js'
export { EventType, DEFAULT_HUB_CONFIG } from './types.js'

// 插件系统（从 agent/agent_factory 迁入：服务/连接管理归 hub 层）
export { PluginBase, PLUGIN_METADATA, discoverPlugins } from './plugin.js'
export type { PluginMessage, PluginEvent, PluginMeta } from './plugin.js'
export * from './plugin-types.js'
