import { describe, expect, it } from "vitest";
import {
  getPresetMaxConcurrent,
  normalizeApiPreset,
  resolvePricingFromPreset,
} from "./preset-normalize.js";

describe("normalizeApiPreset", () => {
  it("folds sampling into extraBody and dual-writes reasoning", () => {
    const n = normalizeApiPreset({
      model: "m",
      url: "https://x",
      temperature: 0.3,
      top_p: 0.95,
      reasoningParams: { thinking: { type: "enabled" } },
    });
    expect(n.extraBody?.temperature).toBe(0.3);
    expect(n.extraBody?.top_p).toBe(0.95);
    expect(n.reasoning_params).toEqual({ thinking: { type: "enabled" } });
    expect((n as Record<string, unknown>).reasoningParams).toEqual({
      thinking: { type: "enabled" },
    });
  });

  it("builds nested pricing from flat fields", () => {
    const n = normalizeApiPreset({
      model: "m",
      url: "https://x",
      input_price: 2,
      outputPrice: 8,
      cache_hit_price: 0.5,
    });
    const pricing = (n as Record<string, unknown>).pricing as {
      inputPrice: number;
      outputPrice: number;
      cacheHitPrice: number;
    };
    expect(pricing.inputPrice).toBe(2);
    expect(pricing.outputPrice).toBe(8);
    expect(pricing.cacheHitPrice).toBe(0.5);
    expect(resolvePricingFromPreset(n)?.inputPrice).toBe(2);
  });

  it("reads registry-style pricing.input / pricing.output", () => {
    const n = normalizeApiPreset({
      model: "m",
      url: "https://x",
      pricing: { input: 1.1, output: 4.4, cacheRead: 0.2 },
    });
    expect(resolvePricingFromPreset(n)).toMatchObject({
      inputPrice: 1.1,
      outputPrice: 4.4,
      cacheHitPrice: 0.2,
    });
  });

  it("getPresetMaxConcurrent", () => {
    expect(getPresetMaxConcurrent({})).toBe(0);
    expect(getPresetMaxConcurrent({ maxConcurrent: 3 })).toBe(3);
    expect(getPresetMaxConcurrent({ max_concurrent: 2 })).toBe(2);
    expect(getPresetMaxConcurrent({ maxConcurrent: 0 })).toBe(0);
  });
});
