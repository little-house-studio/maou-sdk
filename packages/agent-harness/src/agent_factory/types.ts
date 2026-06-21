/**
 * SDK 自有类型定义 — 不依赖 hub 模块
 * 对齐 Python: sdk/types.py
 *
 * 所有 SDK 插件和扩展都应使用此模块的类型。
 * Hub 端通过适配层将 hub.types ↔ sdk.types 互转。
 */

// ─── 枚举 ──────────────────────────────────────────────────────────────────

/** 消息类型 */
export enum MessageType {
  USER = "user",
  ASSISTANT = "assistant",
  TOOL = "tool",
  SYSTEM = "system",
  EVENT = "event",
  COMMAND = "command",
}

/** 设备在线状态 */
export enum DeviceStatus {
  ONLINE = "online",
  OFFLINE = "offline",
  BUSY = "busy",
}

// ─── Agent 事件类型 ─────────────────────────────────────────────────────────

/** 全部 Agent 事件类型 */
export const AGENT_EVENT_TYPES = new Set([
  // 工具相关
  "tool_call",           // 工具调用请求
  "tool_result",         // 工具执行结果
  "tool_error",          // 工具执行异常
  // Agent 循环
  "agent_start",         // Agent 轮次开始
  "agent_stop",          // Agent 轮次结束
  "agent_thinking",      // Agent 正在思考
  // 消息相关
  "pre_message",         // 消息发送前
  "post_message",        // 消息发送后
  "response_start",      // 流式回复开始
  "response_chunk",      // 流式回复片段
  "response_end",        // 流式回复结束
  // 表情/状态
  "expression_change",   // 表情变化
  // 上下文
  "pre_compact",         // 上下文压缩前
  "post_compact",        // 上下文压缩后
  // 设备
  "device_online",       // 设备上线
  "device_offline",      // 设备离线
  // 会话
  "session_start",       // 会话开始
  "session_end",         // 会话结束
  "session_fork",        // 会话分支
  // 配置
  "config_change",       // 配置变更
  "prompt_refresh",      // 提示词刷新
  // 安全
  "pre_tool_use",        // 工具调用前（可拦截）
  "post_tool_use",       // 工具调用后
  "abort",               // 用户中断
  // 错误
  "error",               // 全局错误
]);

/** Agent 事件类型联合 */
export type AgentEventType = typeof AGENT_EVENT_TYPES extends Set<infer T> ? T : never;

// ─── 数据类型 ──────────────────────────────────────────────────────────────

/** SDK 消息 */
export interface Message {
  id: string;
  role: string;                       // "user" / "assistant" / "tool" / "system"
  content: string;
  metadata: Record<string, unknown>;
  source: string;                     // 来源标识
  timestamp: number;
}

/** 创建 Message 的工厂函数 */
export function createMessage(partial: Partial<Message> & Pick<Message, "id" | "role" | "content">): Message {
  return {
    metadata: {},
    source: "",
    timestamp: 0,
    ...partial,
  };
}

/** SDK 事件 */
export interface AgentEvent {
  type: string;                       // AGENT_EVENT_TYPES 中的一种
  data: Record<string, unknown>;
  source: string;
  timestamp: number;
}

/** 创建 AgentEvent 的工厂函数 */
export function createAgentEvent(partial: Partial<AgentEvent> & Pick<AgentEvent, "type">): AgentEvent {
  return {
    data: {},
    source: "sdk",
    timestamp: 0,
    ...partial,
  };
}

/** 工具调用描述 */
// 工具类型从 @little-house-studio/types 导入 + 重导出
import type { ToolCall, ToolResult } from '@little-house-studio/types'
export type { ToolCall, ToolResult }

/** 设备信息 */
export interface DeviceInfo {
  deviceId: string;
  name: string;
  hostname: string;
  platform: string;
  ip: string;
  port: number;
  status: DeviceStatus;
  lastSeen: string;
  metadata: Record<string, unknown>;
}

/** 创建 DeviceInfo 的工厂函数 */
export function createDeviceInfo(partial: Partial<DeviceInfo> & Pick<DeviceInfo, "deviceId">): DeviceInfo {
  return {
    name: "",
    hostname: "",
    platform: "",
    ip: "",
    port: 0,
    status: DeviceStatus.OFFLINE,
    lastSeen: "",
    metadata: {},
    ...partial,
  };
}
