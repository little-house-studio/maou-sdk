/**
 * 缓存重建点 —— 文件缓存区（稳定前缀）失效后重新 cache write 的时机。
 *
 * 术语见 core/context/DESIGN.md：
 *   缓存破坏 = 前缀被改写；缓存重建 = 破坏后重新 write；
 *   缓存重建点 = 上述行为发生的时机（本模块的 hook）。
 *
 * 微压缩（compactStage）不是上下文压缩，不落在缓存重建点上。
 */

import { Hooks, type HookTriggerResult } from "./hooks.js";

/** 缓存重建点原因 */
export type CacheRebuildReason =
  /** 自动大压缩（summaryStage）或归档（archiveStage） */
  | "context_compress"
  /** 手动 /compact，且实际到达大压缩或归档 */
  | "manual_compact"
  /** 新建会话（/new、startSession） */
  | "session_new"
  /** 清空会话（/clear） */
  | "session_clear"
  /** 把 diff 折叠进文件缓存区（显式调用） */
  | "fold"
  /** 调用方显式触发 */
  | "manual";

/** 默认自动触发哪些缓存重建点 */
export interface CacheRebuildTriggers {
  /** 自动大压缩 / 归档后。默认 true */
  onContextCompress: boolean;
  /** 手动 /compact 且到达大压缩或归档。默认 true */
  onManualCompact: boolean;
  /** 新建会话。默认 true */
  onSessionNew: boolean;
  /** 清空会话。默认 true */
  onSessionClear: boolean;
}

export const DEFAULT_CACHE_REBUILD_TRIGGERS: CacheRebuildTriggers = {
  onContextCompress: true,
  onManualCompact: true,
  onSessionNew: true,
  onSessionClear: true,
};

/** 一次缓存重建点事件（hook payload） */
export interface CacheRebuildPointEvent {
  reason: CacheRebuildReason;
  sessionId?: string;
  agentName?: string;
  /** 压缩阶段；仅 compress 类原因 */
  stage?: string;
  /** 本次重建后的世代；pre 阶段尚未分配 */
  generation?: number;
}

export interface CacheRebuildPointResult {
  fired: boolean;
  cancelled?: boolean;
  skipped?: boolean;
  generation?: number;
  pre?: HookTriggerResult;
}

const TRIGGER_KEYS = [
  "onContextCompress",
  "onManualCompact",
  "onSessionNew",
  "onSessionClear",
] as const;

/** 大压缩 / 归档才是这里说的上下文压缩；微压缩不是 */
export function isCacheRebuildCompressStage(stage: string | undefined): boolean {
  return stage === "summaryStage" || stage === "archiveStage";
}

export function parseCacheRebuildTriggers(raw: unknown): Partial<CacheRebuildTriggers> {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const out: Partial<CacheRebuildTriggers> = {};
  for (const key of TRIGGER_KEYS) {
    if (typeof o[key] === "boolean") out[key] = o[key];
  }
  return out;
}

export function mergeCacheRebuildTriggers(
  ...parts: Array<Partial<CacheRebuildTriggers> | undefined>
): CacheRebuildTriggers {
  const merged: CacheRebuildTriggers = { ...DEFAULT_CACHE_REBUILD_TRIGGERS };
  for (const part of parts) {
    if (!part) continue;
    for (const key of TRIGGER_KEYS) {
      if (typeof part[key] === "boolean") merged[key] = part[key];
    }
  }
  return merged;
}

/**
 * 是否应落到缓存重建点。
 * `fold` / `manual` 为显式调用，不受默认触发开关约束。
 */
export function shouldFireCacheRebuildPoint(
  event: Pick<CacheRebuildPointEvent, "reason" | "stage">,
  triggers: CacheRebuildTriggers = DEFAULT_CACHE_REBUILD_TRIGGERS,
): boolean {
  switch (event.reason) {
    case "manual":
    case "fold":
      return true;
    case "context_compress":
      return triggers.onContextCompress && isCacheRebuildCompressStage(event.stage);
    case "manual_compact":
      return triggers.onManualCompact && isCacheRebuildCompressStage(event.stage);
    case "session_new":
      return triggers.onSessionNew;
    case "session_clear":
      return triggers.onSessionClear;
    default:
      return false;
  }
}

export type CacheRebuildHostOptions = {
  hooks: () => Hooks | undefined;
  resolveTriggers: (agentName?: string) => CacheRebuildTriggers;
  /** 内部默认动作：世代已递增之后、post hook 之前 */
  onFired?: (event: CacheRebuildPointEvent, generation: number) => void;
};

/**
 * 缓存重建点宿主：判断是否触发 → pre（可 cancel）→ 递增世代 → 点 hook → 默认动作 → post。
 */
export class CacheRebuildHost {
  private readonly generations = new Map<string, number>();

  constructor(private readonly opts: CacheRebuildHostOptions) {}

  getGeneration(sessionId: string): number {
    return this.generations.get(sessionId) ?? 0;
  }

  async atPoint(event: CacheRebuildPointEvent): Promise<CacheRebuildPointResult> {
    const triggers = this.opts.resolveTriggers(event.agentName);
    if (!shouldFireCacheRebuildPoint(event, triggers)) {
      return { fired: false, skipped: true };
    }

    const hooks = this.opts.hooks();
    const prePayload: Record<string, unknown> = { ...event };
    const pre = await hooks?.preCacheRebuild(prePayload);
    if (pre?.cancel) {
      return { fired: false, cancelled: true, pre };
    }

    const sid = event.sessionId?.trim() ?? "";
    const generation = sid
      ? (this.generations.get(sid) ?? 0) + 1
      : 1;
    if (sid) this.generations.set(sid, generation);

    const firedEvent: CacheRebuildPointEvent = { ...event, generation };
    const payload: Record<string, unknown> = { ...firedEvent };
    await hooks?.cacheRebuildPoint(payload);
    try {
      this.opts.onFired?.(firedEvent, generation);
    } catch {
      /* 默认动作失败不影响 hook 契约 */
    }
    await hooks?.postCacheRebuild(payload);
    return { fired: true, generation, cancelled: false, pre };
  }
}
