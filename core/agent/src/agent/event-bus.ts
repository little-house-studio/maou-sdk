/**
 * SubagentEventBus — 子 Agent 进度/生命周期事件总线（P1-6）。
 *
 * 与 core/hub 的通用 EventBus 区别：
 *   - hub/EventBus：面向 Hub 设备事件（device.* 通配符订阅 + 历史回放）
 *   - 本 Event Bus：面向子 Agent 执行的可观测性，3 个固定 channel：
 *       ① event     —— 原始流式事件透传（assistant/tool_call/tool_result/...）
 *       ② progress  —— AgentProgress 快照（周期性上报，供 UI 实时显示）
 *       ③ lifecycle —— fork start / fork end / abort / depth-limit-hit 等生命周期
 *
 * 设计为单例（SUBAGENT_EVENT_BUS），让 harness / UI / 日志无需传依赖即可订阅。
 * SubagentExecutor 内部 publish 到本 bus，harness 在装配 executor 后订阅 channel。
 *
 * 不强制依赖：SubagentExecutor 即使不接 bus 也能工作（bus 是可选增强）。
 */

import type { AgentProgress, StreamEvent } from "@little-house-studio/types";

/** 3 个固定 channel 名 */
export type SubagentChannel = "event" | "progress" | "lifecycle";

/** lifecycle 事件类型 */
export type LifecycleEvent =
  | { kind: "fork_start"; taskId: string; subSessionId: string; taskDepth: number; desc: string }
  | { kind: "fork_end"; taskId: string; subSessionId: string; ok: boolean; elapsedMs: number; requests?: number; tokens?: number }
  | { kind: "abort"; taskId: string; subSessionId: string; reason: string; elapsedMs: number }
  | { kind: "depth_limit"; taskId: string; currentDepth: number; maxDepth: number }
  | { kind: "budget_exceeded"; taskId: string; requests: number; budget: number }
  | { kind: "timeout"; taskId: string; elapsedMs: number; maxRuntimeMs: number };

type EventHandler = (payload: unknown) => void;

/**
 * 子 Agent 事件总线。
 *
 * 订阅者通过 channel 名订阅；publish 时同步调用所有订阅者（捕获异常，不阻塞主流程）。
 * 单例导出为 SUBAGENT_EVENT_BUS，harness/UI 直接 import 即用。
 */
export class SubagentEventBus {
  private _channels: Map<SubagentChannel, EventHandler[]> = new Map();

  constructor() {
    this._channels.set("event", []);
    this._channels.set("progress", []);
    this._channels.set("lifecycle", []);
  }

  /** 订阅某 channel */
  subscribe(channel: SubagentChannel, handler: EventHandler): void {
    const list = this._channels.get(channel);
    if (!list) {
      this._channels.set(channel, [handler]);
      return;
    }
    list.push(handler);
  }

  /** 取消订阅（按引用） */
  unsubscribe(channel: SubagentChannel, handler: EventHandler): void {
    const list = this._channels.get(channel);
    if (!list) return;
    const idx = list.indexOf(handler);
    if (idx >= 0) list.splice(idx, 1);
  }

  /** 发布原始流式事件到 event channel */
  publishEvent(taskId: string, event: StreamEvent): void {
    this._publish("event", { taskId, event });
  }

  /** 发布进度快照到 progress channel */
  publishProgress(progress: AgentProgress): void {
    this._publish("progress", progress);
  }

  /** 发布生命周期事件到 lifecycle channel */
  publishLifecycle(ev: LifecycleEvent): void {
    this._publish("lifecycle", ev);
  }

  /** 清除所有订阅（主要用于测试） */
  clear(): void {
    for (const list of this._channels.values()) list.length = 0;
  }

  /** 某 channel 的订阅者数量 */
  subscriberCount(channel: SubagentChannel): number {
    return this._channels.get(channel)?.length ?? 0;
  }

  private _publish(channel: SubagentChannel, payload: unknown): void {
    const list = this._channels.get(channel);
    if (!list || list.length === 0) return;
    for (const handler of list) {
      try {
        handler(payload);
      } catch (err) {
        // 不让一个订阅者的异常阻塞其他订阅者或主流程
        console.error(`[SubagentEventBus] ${channel} handler error:`, err);
      }
    }
  }
}

/** 全局单例。harness/UI 直接 import 订阅。 */
export const SUBAGENT_EVENT_BUS = new SubagentEventBus();
