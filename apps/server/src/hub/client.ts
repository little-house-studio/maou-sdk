/**
 * SDK 客户端 — 协议抽象层
 * 对齐 Python: sdk/client.py
 *
 * 提供 ClientBase 抽象接口 + HttpClient 实现。
 * 插件通过此模块与 Hub 通信，不直接依赖 HTTP 细节。
 */

import { randomUUID } from "node:crypto";
import type { Message, AgentEvent } from "@little-house-studio/agent-harness";

/** 消息监听函数 */
export type MessageListener = (message: Message) => void;

/**
 * 客户端抽象基类
 *
 * 所有与 Hub 的通信都应通过此接口进行，
 * 以便插件可以在不同传输层（HTTP / WebSocket / IPC）之间切换。
 */
export abstract class ClientBase {
  /** 发送消息 */
  abstract sendMessage(
    content?: string,
    payload?: Record<string, unknown> | null,
    targetDevice?: string,
    targetAgent?: string,
  ): Promise<Record<string, unknown>>;

  /** 订阅事件 */
  abstract subscribe(
    eventType: string,
    handler: (event: AgentEvent) => void,
  ): string;

  /** 取消订阅 */
  abstract unsubscribe(handler: (event: AgentEvent) => void): void;

  /** 轮询事件 */
  abstract pollEvents(since?: string): Promise<AgentEvent[]>;

  /** 检查服务健康状态 */
  abstract health(): Promise<Record<string, unknown>>;

  /** 获取设备列表 */
  abstract listDevices(): Promise<Record<string, unknown>[]>;
}

/**
 * HTTP 客户端 — 通过 HTTP API 与 Hub 通信
 *
 * 对应 Python: sdk/client.py HttpClient
 */
export class HttpClient extends ClientBase {
  private _baseUrl: string;
  private _source: string;
  private _listeners = new Map<string, Array<(event: AgentEvent) => void>>();

  constructor(baseUrl = "http://127.0.0.1:8098", source = "sdk") {
    super();
    this._baseUrl = baseUrl.replace(/\/+$/, "");
    this._source = source;
  }

  async sendMessage(
    content = "",
    payload: Record<string, unknown> | null = null,
    _targetDevice = "",
    _targetAgent = "",
  ): Promise<Record<string, unknown>> {
    const finalPayload = payload ?? { text: content };
    const hubMsg = {
      id: randomUUID().slice(0, 16),
      role: "user",
      content,
      metadata: finalPayload,
      source: this._source,
      timestamp: Date.now(),
    };

    try {
      const resp = await fetch(`${this._baseUrl}/api/hub/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: hubMsg }),
        signal: AbortSignal.timeout(10_000),
      });
      if (resp.ok) {
        console.log(`[sdk] 消息已发送: target=${_targetDevice} agent=${_targetAgent}`);
      } else {
        console.warn("[sdk] 消息发送失败:", resp.statusText);
      }
      return (await resp.json()) as Record<string, unknown>;
    } catch (e) {
      console.error("[sdk] 消息发送异常:", e);
      return { ok: false, error: String(e) };
    }
  }

  subscribe(eventType: string, handler: (event: AgentEvent) => void): string {
    const handlers = this._listeners.get(eventType);
    if (handlers) {
      handlers.push(handler);
    } else {
      this._listeners.set(eventType, [handler]);
    }
    return `sub-${eventType}-${this._listeners.size}`;
  }

  unsubscribe(handler: (event: AgentEvent) => void): void {
    for (const [eventType, handlers] of this._listeners) {
      const idx = handlers.indexOf(handler);
      if (idx !== -1) {
        handlers.splice(idx, 1);
      }
      if (handlers.length === 0) {
        this._listeners.delete(eventType);
      }
    }
  }

  async pollEvents(since = ""): Promise<AgentEvent[]> {
    try {
      let url = `${this._baseUrl}/api/hub/events`;
      if (since) url += `?since=${encodeURIComponent(since)}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const data = (await resp.json()) as { events?: Array<Record<string, unknown>> };
      return (data.events ?? []).map((evt) => ({
        type: (evt.type as string) ?? "",
        data: (evt.data as Record<string, unknown>) ?? {},
        source: (evt.source as string) ?? "",
        timestamp: 0,
      }));
    } catch (e) {
      console.error("[sdk] 事件轮询失败:", e);
      return [];
    }
  }

  async health(): Promise<Record<string, unknown>> {
    try {
      const resp = await fetch(`${this._baseUrl}/api/hub/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      return (await resp.json()) as Record<string, unknown>;
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  async listDevices(): Promise<Record<string, unknown>[]> {
    try {
      const resp = await fetch(`${this._baseUrl}/api/hub/devices`, {
        signal: AbortSignal.timeout(5_000),
      });
      const data = (await resp.json()) as { devices?: Record<string, unknown>[] };
      return data.devices ?? [];
    } catch (e) {
      console.error("[sdk] 获取设备列表失败:", e);
      return [];
    }
  }

  /**
   * 阻塞式事件轮询循环
   *
   * @param interval - 轮询间隔（毫秒）
   * @param onEvent - 事件回调
   */
  async pollLoop(
    interval = 3000,
    onEvent: (event: AgentEvent) => void = (evt) =>
      console.log(`[${evt.type}]`, evt.data),
  ): Promise<void> {
    let lastId = "";
    console.log(`开始轮询 (间隔 ${interval}ms)，按 Ctrl+C 停止...`);
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const events = await this.pollEvents(lastId);
      for (const evt of events) {
        onEvent(evt);
      }
      if (events.length > 0) {
        lastId = `evt-${String(events.length).padStart(6, "0")}`;
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }
}

/** HubClient 保持向后兼容，内部使用 HttpClient */
export const HubClient = HttpClient;
