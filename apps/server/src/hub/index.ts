/**
 * Hub 模块 — 多设备通信中心
 * 对齐 Python: core/server/hub/
 */

export { EventBus } from './event-bus.js'
export { DeviceRegistry } from './device-registry.js'
export { HubServer } from './server.js'
export type {
  DeviceInfo,
  DeviceStatus,
  HubMessage,
  MessageType,
  HubEvent,
  HubConfig,
} from './types.js'
export { EventType, DEFAULT_HUB_CONFIG } from './types.js'
