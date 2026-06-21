/**
 * SDK 事件总线 — 25+ 事件类型 + 通配符订阅
 * 对齐 Python: sdk/event_bus.py
 *
 * 独立于 hub.core.event_bus，供 SDK 插件直接使用。
 * Hub 端通过适配层将事件转发到此总线。
 */

import type { AgentEvent } from "./types.js";

/** 事件处理函数 */
export type EventHandler = (event: AgentEvent) => void;

/** 事件历史最大条数 */
const EVENT_HISTORY_MAX = 1000;

/**
 * 事件总线 — 支持通配符订阅 + 历史回放
 *
 * 用法:
 * ```ts
 * const bus = new EventBus();
 * bus.on("tool_call", (evt) => console.log(evt));
 * bus.on("*", (evt) => console.log("any:", evt.type));
 * bus.emit({ type: "tool_call", data: { name: "bash" } });
 * ```
 */
export class EventBus {
  private _subscribers = new Map<string, EventHandler[]>();
  private _history: Array<{ id: string; event: AgentEvent }> = [];
  private _nextId = 0;

  /** 订阅事件（支持通配符模式，如 "tool.*" 匹配所有工具事件） */
  on(pattern: string, handler: EventHandler): string {
    const handlers = this._subscribers.get(pattern);
    if (handlers) {
      handlers.push(handler);
    } else {
      this._subscribers.set(pattern, [handler]);
    }
    const subId = `sub-${String(this._nextId).padStart(6, "0")}`;
    this._nextId++;
    return subId;
  }

  /** 取消订阅 */
  off(pattern: string, handler: EventHandler): void {
    const handlers = this._subscribers.get(pattern);
    if (!handlers) return;
    const idx = handlers.indexOf(handler);
    if (idx !== -1) {
      handlers.splice(idx, 1);
    }
    if (handlers.length === 0) {
      this._subscribers.delete(pattern);
    }
  }

  /** 匹配事件类型，支持通配符 */
  private _matchPattern(pattern: string, eventType: string): boolean {
    if (pattern === "*") return true;
    // 直接匹配
    if (fnmatch(pattern, eventType)) return true;
    // 将 event_type 中的 "_" 转为 "." 再匹配
    const normalized = eventType.replace(/_/g, ".");
    if (fnmatch(pattern, normalized)) return true;
    // 将 pattern 中的 "." 转为 "_" 再匹配
    const normalizedPattern = pattern.replace(/\./g, "_");
    return fnmatch(normalizedPattern, eventType);
  }

  /** 发布事件，同步调用所有匹配的订阅者 */
  emit(event: AgentEvent): void {
    // 记录历史
    const eventId = `evt-${String(this._nextId).padStart(6, "0")}`;
    this._nextId++;
    this._history.push({ id: eventId, event });
    while (this._history.length > EVENT_HISTORY_MAX) {
      this._history.shift();
    }

    // 触发订阅者
    const snapshot = [...this._subscribers.entries()];
    for (const [pattern, handlers] of snapshot) {
      if (this._matchPattern(pattern, event.type)) {
        for (const handler of handlers) {
          try {
            handler(event);
          } catch (e) {
            console.error(`事件处理器异常 [${event.type}]:`, e);
          }
        }
      }
    }
  }

  /** 获取历史事件（用于轮询） */
  getHistory(sinceId = ""): Array<{ id: string; event: AgentEvent }> {
    if (!sinceId) return [...this._history];
    const results: Array<{ id: string; event: AgentEvent }> = [];
    let found = false;
    for (const entry of this._history) {
      if (entry.id === sinceId) {
        found = true;
        continue;
      }
      if (found) {
        results.push(entry);
      }
    }
    return results;
  }

  /** 订阅者总数 */
  get subscriberCount(): number {
    let count = 0;
    for (const handlers of this._subscribers.values()) {
      count += handlers.length;
    }
    return count;
  }

  /** 清空所有订阅和历史 */
  clear(): void {
    this._subscribers.clear();
    this._history.length = 0;
  }
}

/**
 * 简化的 fnmatch 实现（仅支持 * 通配符）
 */
function fnmatch(pattern: string, text: string): boolean {
  // 转换 glob 模式为正则
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regexStr = `^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`;
  return new RegExp(regexStr).test(text);
}
