/**
 * defineChannel — 消息通道定义 API（对标 Vercel Eve）
 *
 * 用法：在 agent/channels/ 目录下创建 .ts 文件，导出 defineChannel() 的返回值。
 * 文件名即通道名（如 slack.ts → 通道名 "slack"）。
 *
 * @example
 * // agent/channels/slack.ts
 * import { defineChannel } from "@little-house-studio/agent/define";
 *
 * export default defineChannel({
 *   type: "slack",
 *   description: "团队 Slack 频道",
 *   config: {
 *     channel: "#general",
 *   },
 * });
 */

// ─── 通道类型 ──────────────────────────────────────────────────────────────

export type ChannelType =
  | "http"      // HTTP API（默认，自动启用）
  | "feishu"    // 飞书
  | "slack"     // Slack
  | "discord"   // Discord
  | "teams"     // Microsoft Teams
  | "telegram"  // Telegram
  | "twilio"    // Twilio SMS
  | "github"    // GitHub
  | "linear"    // Linear
  | "webhook"   // 通用 Webhook
  | string;     // 自定义类型

// ─── 消息格式 ──────────────────────────────────────────────────────────────

export interface ChannelMessage {
  /** 消息内容 */
  content: string;
  /** 发送者 */
  sender?: string;
  /** 消息类型 */
  messageType?: "text" | "markdown" | "json";
  /** 附加元数据 */
  metadata?: Record<string, unknown>;
}

export interface ChannelResponse {
  /** 是否成功 */
  ok: boolean;
  /** 响应消息 */
  message?: string;
  /** 附加数据 */
  data?: Record<string, unknown>;
}

// ─── 通道适配器接口 ────────────────────────────────────────────────────────

/**
 * 通道适配器 — 处理特定通道的收发逻辑
 * 每种通道类型需要实现此接口
 */
export interface ChannelAdapter {
  /** 通道类型 */
  type: ChannelType;

  /** 初始化通道（连接、认证等） */
  start?(): Promise<void>;

  /** 停止通道 */
  stop?(): Promise<void>;

  /** 发送消息到通道 */
  send(message: ChannelMessage): Promise<ChannelResponse>;

  /** 接收消息的回调注册 */
  onMessage?(handler: (message: ChannelMessage) => void): void;
}

// ─── defineChannel 配置 ────────────────────────────────────────────────────

export interface DefineChannelConfig {
  /** 通道类型 */
  type: ChannelType;

  /** 通道描述（给 LLM 看） */
  description: string;

  /** 是否启用（默认 true） */
  enabled?: boolean;

  /** 通道特定配置 */
  config?: Record<string, unknown>;

  /** 自定义适配器（可选，如果不提供则使用内置适配器） */
  adapter?: ChannelAdapter;
}

// ─── DefinedChannel 结果 ───────────────────────────────────────────────────

export interface DefinedChannel {
  readonly _type: "defineChannel";
  readonly _source: "file";

  /** 通道名（文件名去掉扩展名） */
  name: string;

  /** 通道类型 */
  type: ChannelType;

  /** 描述 */
  description: string;

  /** 是否启用 */
  enabled: boolean;

  /** 配置 */
  config: Record<string, unknown>;

  /** 适配器实例 */
  adapter?: ChannelAdapter;
}

// ─── defineChannel 函数 ────────────────────────────────────────────────────

/**
 * 定义一个消息通道
 *
 * @param config - 通道配置
 * @returns 函数，接收通道名后返回 DefinedChannel
 *
 * @example
 * export default defineChannel({
 *   type: "slack",
 *   description: "团队 Slack 频道",
 *   config: { channel: "#general" },
 * });
 */
export function defineChannel(config: DefineChannelConfig): (name: string) => DefinedChannel {
  return (name: string) => ({
    _type: "defineChannel",
    _source: "file",
    name,
    type: config.type,
    description: config.description,
    enabled: config.enabled ?? true,
    config: config.config ?? {},
    adapter: config.adapter,
  });
}
