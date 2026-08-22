/**
 * CLI 缓存重建点出口：store.startNewSession 通知当前 agent Runtime。
 * 避免 store ↔ AgentHandle 直接耦合。
 */
import type { CacheRebuildPointEvent } from "@little-house-studio/agent";

type Sink = (event: CacheRebuildPointEvent) => void;

let sink: Sink | undefined;

export function setCacheRebuildSink(fn: Sink | undefined): void {
  sink = fn;
}

export function notifyCacheRebuildPoint(event: CacheRebuildPointEvent): void {
  try {
    sink?.(event);
  } catch {
    /* 重建点失败不影响 /new UI */
  }
}
