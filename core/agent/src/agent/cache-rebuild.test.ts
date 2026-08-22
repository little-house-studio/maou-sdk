import { describe, expect, it } from "vitest";
import { Hooks } from "./hooks.js";
import {
  CacheRebuildHost,
  DEFAULT_CACHE_REBUILD_TRIGGERS,
  isCacheRebuildCompressStage,
  mergeCacheRebuildTriggers,
  parseCacheRebuildTriggers,
  shouldFireCacheRebuildPoint,
} from "./cache-rebuild.js";

describe("缓存重建点判定", () => {
  it("微压缩不是缓存重建点", () => {
    expect(isCacheRebuildCompressStage("compactStage")).toBe(false);
    expect(isCacheRebuildCompressStage("activeStage")).toBe(false);
    expect(
      shouldFireCacheRebuildPoint({ reason: "context_compress", stage: "compactStage" }),
    ).toBe(false);
    expect(
      shouldFireCacheRebuildPoint({ reason: "manual_compact", stage: "compactStage" }),
    ).toBe(false);
  });

  it("大压缩 / 归档默认触发", () => {
    expect(isCacheRebuildCompressStage("summaryStage")).toBe(true);
    expect(isCacheRebuildCompressStage("archiveStage")).toBe(true);
    expect(
      shouldFireCacheRebuildPoint({ reason: "context_compress", stage: "summaryStage" }),
    ).toBe(true);
    expect(
      shouldFireCacheRebuildPoint({ reason: "manual_compact", stage: "archiveStage" }),
    ).toBe(true);
  });

  it("新建 / 清空会话默认触发", () => {
    expect(shouldFireCacheRebuildPoint({ reason: "session_new" })).toBe(true);
    expect(shouldFireCacheRebuildPoint({ reason: "session_clear" })).toBe(true);
  });

  it("显式 fold / manual 不受开关约束", () => {
    const off = mergeCacheRebuildTriggers({
      onContextCompress: false,
      onManualCompact: false,
      onSessionNew: false,
      onSessionClear: false,
    });
    expect(shouldFireCacheRebuildPoint({ reason: "fold" }, off)).toBe(true);
    expect(shouldFireCacheRebuildPoint({ reason: "manual" }, off)).toBe(true);
    expect(shouldFireCacheRebuildPoint({ reason: "session_new" }, off)).toBe(false);
  });

  it("解析 agent.json cacheRebuild", () => {
    expect(parseCacheRebuildTriggers(null)).toEqual({});
    expect(parseCacheRebuildTriggers({ onSessionNew: false, extra: 1 })).toEqual({
      onSessionNew: false,
    });
    const merged = mergeCacheRebuildTriggers(
      DEFAULT_CACHE_REBUILD_TRIGGERS,
      { onSessionNew: false },
    );
    expect(merged.onSessionNew).toBe(false);
    expect(merged.onContextCompress).toBe(true);
  });
});

describe("CacheRebuildHost", () => {
  it("pre_cache_rebuild cancel 则不递增世代、不打点", async () => {
    const hooks = new Hooks();
    const seen: string[] = [];
    hooks.on("pre_cache_rebuild", () => ({ cancel: true }));
    hooks.on("cache_rebuild_point", () => {
      seen.push("point");
    });
    const host = new CacheRebuildHost({
      hooks: () => hooks,
      resolveTriggers: () => DEFAULT_CACHE_REBUILD_TRIGGERS,
    });
    const r = await host.atPoint({ reason: "session_new", sessionId: "s1" });
    expect(r.fired).toBe(false);
    expect(r.cancelled).toBe(true);
    expect(host.getGeneration("s1")).toBe(0);
    expect(seen).toEqual([]);
  });

  it("命中后走 pre → 点 → post，并递增世代", async () => {
    const hooks = new Hooks();
    const order: string[] = [];
    hooks.on("pre_cache_rebuild", () => {
      order.push("pre");
    });
    hooks.on("cache_rebuild_point", (kw) => {
      order.push(`point:${kw.generation}`);
    });
    hooks.on("post_cache_rebuild", () => {
      order.push("post");
    });
    const fired: number[] = [];
    const host = new CacheRebuildHost({
      hooks: () => hooks,
      resolveTriggers: () => DEFAULT_CACHE_REBUILD_TRIGGERS,
      onFired: (_e, gen) => fired.push(gen),
    });
    const r = await host.atPoint({
      reason: "context_compress",
      sessionId: "s1",
      stage: "summaryStage",
    });
    expect(r.fired).toBe(true);
    expect(r.generation).toBe(1);
    expect(host.getGeneration("s1")).toBe(1);
    expect(order).toEqual(["pre", "point:1", "post"]);
    expect(fired).toEqual([1]);
  });

  it("compactStage 跳过，不打 hook", async () => {
    const hooks = new Hooks();
    let n = 0;
    hooks.on("cache_rebuild_point", () => {
      n += 1;
    });
    const host = new CacheRebuildHost({
      hooks: () => hooks,
      resolveTriggers: () => DEFAULT_CACHE_REBUILD_TRIGGERS,
    });
    const r = await host.atPoint({
      reason: "context_compress",
      sessionId: "s1",
      stage: "compactStage",
    });
    expect(r.skipped).toBe(true);
    expect(n).toBe(0);
  });
});
