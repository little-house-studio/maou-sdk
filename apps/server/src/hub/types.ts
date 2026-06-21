/**
 * Hub 核心类型定义
 * 对齐 Python: core/server/hub/core/types.py, core/server/hub/config.py
 */

// ─── 设备状态 ────────────────────────────────────────────────────────────────

/** 设备在线状态 */
export type DeviceStatus = 'online' | 'offline' | 'busy'

// ─── 消息类型 ────────────────────────────────────────────────────────────────

/** 消息类型 */
export type MessageType = 'agent_msg' | 'event' | 'command' | 'sync'

// ─── 事件类型 ────────────────────────────────────────────────────────────────

/** Hub 事件类型枚举 */
export enum EventType {
  /** 设备上线 */
  DEVICE_ONLINE = 'device.online',
  /** 设备离线 */
  DEVICE_OFFLINE = 'device.offline',
  /** 设备状态变更 */
  DEVICE_STATUS = 'device.status',
  /** 新消息到达 */
  MESSAGE_INCOMING = 'message.incoming',
  /** 发送给 Agent 的消息 */
  MESSAGE_TO_AGENT = 'message.to_agent',
  /** Webhook 消息 */
  WEBHOOK_MESSAGE = 'webhook.message',
}

// ─── 设备信息 ────────────────────────────────────────────────────────────────

/** 设备信息 */
export interface DeviceInfo {
  device_id: string
  name: string
  hostname: string
  platform: string
  ip: string
  port: number
  ws_port: number
  status: DeviceStatus
  last_seen: string
  roles: string[]
  metadata: Record<string, unknown>
}

// ─── 消息 ────────────────────────────────────────────────────────────────────

/** 跨设备消息 */
export interface HubMessage {
  id: string
  source_device: string
  target_device: string
  target_agent: string
  msg_type: MessageType
  payload: Record<string, unknown>
  created_at: string
  source: string
}

// ─── Hub 事件 ────────────────────────────────────────────────────────────────

/** 内部事件总线事件 */
export interface HubEvent {
  type: string
  data: Record<string, unknown>
  source: string
}

// ─── Hub 配置 ────────────────────────────────────────────────────────────────

/** Hub 服务配置 */
export interface HubConfig {
  device_id: string
  device_name: string
  device_role: 'gateway' | 'worker'
  http_port: number
  webhook_port: number
  ws_port: number
  enable_websocket: boolean
  webhook_secret: string
  sync_interval: number
  heartbeat_interval: number
  device_timeout: number
  gateway_url: string
  auto_register: boolean
  managed_agents: string[]
}

/** 默认 Hub 配置 */
export const DEFAULT_HUB_CONFIG: HubConfig = {
  device_id: '',
  device_name: '',
  device_role: 'worker',
  http_port: 8098,
  webhook_port: 8096,
  ws_port: 8097,
  enable_websocket: false,
  webhook_secret: '',
  sync_interval: 60,
  heartbeat_interval: 15,
  device_timeout: 60,
  gateway_url: '',
  auto_register: true,
  managed_agents: [],
}
