/**
 * prompt-cache usage 语义归一测试。
 * 跑：cd core/llm && npx vitest run src/cache-usage.test.ts
 */
import { describe, it, expect } from "vitest";
import { normalizeCacheUsage, cacheHitPct } from "./cache-usage.js";

describe("normalizeCacheUsage · OpenAI 家族（prompt_tokens 已含命中）", () => {
  it("prompt_tokens_details.cached_tokens", () => {
    const n = normalizeCacheUsage({
      prompt_tokens: 6135,
      completion_tokens: 200,
      prompt_tokens_details: { cached_tokens: 5504 },
    });
    expect(n.promptTotal).toBe(6135);
    expect(n.cacheRead).toBe(5504);
    expect(n.uncached).toBe(631);
    expect(n.output).toBe(200);
    expect(n.reported).toBe(true);
  });

  it("顶层 cached_tokens", () => {
    const n = normalizeCacheUsage({ prompt_tokens: 1000, cached_tokens: 900 });
    expect(n.promptTotal).toBe(1000);
    expect(n.cacheRead).toBe(900);
    expect(n.uncached).toBe(100);
  });

  it("Responses / Codex / Grok：input_tokens_details.cached_tokens ⊂ input_tokens", () => {
    const n = normalizeCacheUsage({
      input_tokens: 15000,
      output_tokens: 80,
      input_tokens_details: { cached_tokens: 12000, cache_write_tokens: 3000 },
    });
    expect(n.promptTotal).toBe(15000);
    expect(n.cacheRead).toBe(12000);
    expect(n.cacheWrite).toBe(3000);
    expect(n.uncached).toBe(0);
  });

  it("DeepSeek prompt_cache_hit_tokens + miss = prompt_tokens", () => {
    const n = normalizeCacheUsage({
      prompt_tokens: 6135,
      prompt_cache_hit_tokens: 5504,
      prompt_cache_miss_tokens: 631,
    });
    expect(n.promptTotal).toBe(6135);
    expect(n.cacheRead).toBe(5504);
    expect(n.uncached).toBe(631);
  });

  it("中转层 0 占位不盖掉真实 cached_tokens", () => {
    const n = normalizeCacheUsage({
      prompt_tokens: 6135,
      cache_read_input_tokens: 0,
      cached_tokens: 5504,
    });
    expect(n.cacheRead).toBe(5504);
    expect(n.promptTotal).toBe(6135);
  });
});

describe("normalizeCacheUsage · Anthropic（三字段互斥相加）", () => {
  it("命中时补齐分母，不再算出 9000%", () => {
    const n = normalizeCacheUsage({
      input_tokens: 100,
      output_tokens: 250,
      cache_read_input_tokens: 9000,
      cache_creation_input_tokens: 0,
    });
    expect(n.promptTotal).toBe(9100);
    expect(n.cacheRead).toBe(9000);
    expect(n.uncached).toBe(100);
    expect(cacheHitPct(n.cacheRead, n.promptTotal)).toBe(99);
  });

  it("官方小命中也相加（不再误判成已含）", () => {
    const n = normalizeCacheUsage({
      input_tokens: 20000,
      cache_read_input_tokens: 500,
    });
    expect(n.promptTotal).toBe(20500);
    expect(n.cacheRead).toBe(500);
    expect(n.uncached).toBe(20000);
    expect(cacheHitPct(n.cacheRead, n.promptTotal)).toBe(2);
  });

  it("首轮建缓存：写入计入分母但不算命中", () => {
    const n = normalizeCacheUsage({
      input_tokens: 200,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 5000,
    });
    expect(n.promptTotal).toBe(5200);
    expect(n.cacheRead).toBe(0);
    expect(n.cacheWrite).toBe(5000);
    expect(n.uncached).toBe(200);
    expect(cacheHitPct(n.cacheRead, n.promptTotal)).toBe(0);
  });

  it("命中+写入同轮", () => {
    const n = normalizeCacheUsage({
      input_tokens: 50,
      cache_read_input_tokens: 8000,
      cache_creation_input_tokens: 1200,
    });
    expect(n.promptTotal).toBe(9250);
    expect(n.uncached).toBe(50);
    expect(cacheHitPct(n.cacheRead, n.promptTotal)).toBe(86);
  });

  it("cache_creation 对象 5m+1h", () => {
    const n = normalizeCacheUsage({
      input_tokens: 80,
      cache_read_input_tokens: 0,
      cache_creation: {
        ephemeral_5m_input_tokens: 4000,
        ephemeral_1h_input_tokens: 1000,
      },
    });
    expect(n.promptTotal).toBe(5080);
    expect(n.cacheWrite).toBe(5000);
    expect(n.reported).toBe(true);
  });

  it("无缓存轮（全 0 cache 字段）仍算已上报", () => {
    const n = normalizeCacheUsage({
      input_tokens: 300,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    });
    expect(n.promptTotal).toBe(300);
    expect(n.cacheRead).toBe(0);
    expect(n.reported).toBe(true);
  });
});

describe("normalizeCacheUsage · Gemini", () => {
  it("promptTokenCount 已含 cachedContentTokenCount", () => {
    const n = normalizeCacheUsage({
      promptTokenCount: 1000,
      candidatesTokenCount: 40,
      cachedContentTokenCount: 800,
    });
    expect(n.promptTotal).toBe(1000);
    expect(n.cacheRead).toBe(800);
    expect(n.uncached).toBe(200);
    expect(n.output).toBe(40);
    expect(n.reported).toBe(true);
  });
});

describe("normalizeCacheUsage · 边界", () => {
  it("无 usage / 空对象 → 全 0 且未上报", () => {
    for (const u of [null, undefined, {}]) {
      const n = normalizeCacheUsage(u as Record<string, unknown> | null);
      expect(n.promptTotal).toBe(0);
      expect(n.reported).toBe(false);
    }
  });

  it("不上报 cache 的模型：无 cache 字段 → reported=false", () => {
    const n = normalizeCacheUsage({ prompt_tokens: 5000, completion_tokens: 20 });
    expect(n.promptTotal).toBe(5000);
    expect(n.cacheRead).toBe(0);
    expect(n.reported).toBe(false);
  });

  it("命中数超总量（脏数据）被 clamp，不产出 >100%", () => {
    const n = normalizeCacheUsage({ prompt_tokens: 0, cached_tokens: 500 });
    expect(n.cacheRead).toBeLessThanOrEqual(n.promptTotal);
    expect(cacheHitPct(n.cacheRead, n.promptTotal)).toBe(100);
  });

  it("负数 / NaN / 字符串数字", () => {
    const n = normalizeCacheUsage({
      prompt_tokens: "1000" as unknown as number,
      cached_tokens: -5 as unknown as number,
      completion_tokens: Number.NaN,
    });
    expect(n.promptTotal).toBe(1000);
    expect(n.cacheRead).toBe(0);
    expect(n.output).toBe(0);
  });

  it("OpenAI 字段名 + Anthropic 命中字段且命中属于总量 → 不重复叠加", () => {
    const n = normalizeCacheUsage({
      prompt_tokens: 6135,
      cache_read_input_tokens: 5504,
    });
    expect(n.promptTotal).toBe(6135);
    expect(n.cacheRead).toBe(5504);
  });
});

describe("cacheHitPct", () => {
  it("分母 0 → null（显示 c—）", () => {
    expect(cacheHitPct(0, 0)).toBeNull();
    expect(cacheHitPct(100, 0)).toBeNull();
  });

  it("四舍五入并 clamp 到 0–100", () => {
    expect(cacheHitPct(900, 1000)).toBe(90);
    expect(cacheHitPct(818, 1000)).toBe(82);
    expect(cacheHitPct(9000, 100)).toBe(100);
    expect(cacheHitPct(-5, 100)).toBe(0);
  });
});
