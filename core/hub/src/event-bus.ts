/**
 * 内存事件总线 (pub/sub 模式)
 * 对齐 Python: core/server/hub/core/event_bus.py
 *
 * 支持通配符订阅：订阅 "device.*" 可收到所有 device 开头的事件。
 */

import type { HubEvent } from './types.js'

// ─── 事件历史 ────────────────────────────────────────────────────────────────

const EVENT_HISTORY_MAX = 500

/** 事件历史记录条目 */
interface EventHistoryEntry {
  id: string
  type: string
  data: Record<string, unknown>
  source: string
}

/** 环形事件历史，保留最近 N 条事件 */
class EventHistory {
  private _events: EventHistoryEntry[] = []
  private _nextId = 0

  push(event: HubEvent): string {
    const eventId = `evt-${String(this._nextId).padStart(6, '0')}`
    this._nextId++
    this._events.push({
      id: eventId,
      type: event.type,
      data: event.data,
      source: event.source,
    })
    while (this._events.length > EVENT_HISTORY_MAX) {
      this._events.shift()
    }
    return eventId
  }

  since(lastId: string = ''): EventHistoryEntry[] {
    if (!lastId) return [...this._events]
    const idx = this._events.findIndex((e) => e.id === lastId)
    if (idx < 0) return [...this._events]
    return this._events.slice(idx + 1)
  }

  clear(): void {
    this._events = []
    this._nextId = 0
  }

  get lastId(): string {
    if (this._events.length === 0) return ''
    return this._events[this._events.length - 1].id
  }
}

// ─── EventBus ────────────────────────────────────────────────────────────────

type EventHandler = (event: HubEvent) => void

/** 轻量级内存事件总线 */
export class EventBus {
  private _subscribers: Map<string, EventHandler[]> = new Map()
  readonly eventHistory = new EventHistory()

  /**
   * 订阅某类事件
   * @param eventType 事件类型，支持通配符如 "device.*"
   * @param handler 事件处理函数
   */
  subscribe(eventType: string, handler: EventHandler): void {
    const handlers = this._subscribers.get(eventType)
    if (handlers) {
      handlers.push(handler)
    } else {
      this._subscribers.set(eventType, [handler])
    }
  }

  /**
   * 取消订阅
   * @param eventType 事件类型
   * @param handler 要移除的处理函数
   */
  unsubscribe(eventType: string, handler: EventHandler): void {
    const handlers = this._subscribers.get(eventType)
    if (!handlers) return
    const idx = handlers.indexOf(handler)
    if (idx >= 0) {
      handlers.splice(idx, 1)
    }
    if (handlers.length === 0) {
      this._subscribers.delete(eventType)
    }
  }

  /**
   * 发布事件，同步调用所有匹配的订阅者
   * @param event 事件对象
   */
  publish(event: HubEvent): void {
    this.eventHistory.push(event)

    for (const [pattern, handlers] of this._subscribers) {
      if (this._matchPattern(pattern, event.type)) {
        for (const handler of handlers) {
          try {
            handler(event)
          } catch (err) {
            console.error(`[EventBus] handler error for ${event.type}:`, err)
          }
        }
      }
    }
  }

  /** 清除所有订阅（主要用于测试） */
  clear(): void {
    this._subscribers.clear()
  }

  /** 当前订阅者总数 */
  get subscriberCount(): number {
    let count = 0
    for (const handlers of this._subscribers.values()) {
      count += handlers.length
    }
    return count
  }

  /**
   * 通配符匹配：支持 "device.*" 匹配 "device.online" 等
   * 对齐 Python fnmatch 行为
   */
  private _matchPattern(pattern: string, eventType: string): boolean {
    if (pattern === eventType) return true
    if (!pattern.includes('*') && !pattern.includes('?')) return false

    // 转换 glob 通配符为正则
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')
    const regex = new RegExp(`^${escaped}$`)
    return regex.test(eventType)
  }
}
