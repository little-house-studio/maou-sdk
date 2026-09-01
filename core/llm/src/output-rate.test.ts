/**
 * 输出吞吐：缺 usage 不采样；decodeMs=0 不算 tok/s。
 * 跑：cd core/llm && pnpm vitest run src/output-rate.test.ts
 */
import { describe, it, expect } from "vitest";
import {
  usageOutputTokens,
  OutputRateClock,
  settleOutputRate,
  addOutputRateSample,
  emptyOutputRateFold,
  foldTokensPerSecond,
  foldTtftAverageMs,
  formatTokensPerSecond,
} from "./output-rate.js";

describe("usageOutputTokens", () => {
  it("字段缺失返回 null，不当成 0", () => {
    expect(usageOutputTokens(null)).toBeNull();
    expect(usageOutputTokens(undefined)).toBeNull();
    expect(usageOutputTokens({})).toBeNull();
    expect(usageOutputTokens({ prompt_tokens: 100 })).toBeNull();
  });

  it("只认真实出现且合法的输出字段", () => {
    expect(usageOutputTokens({ outputTokens: 42 })).toBe(42);
    expect(usageOutputTokens({ output_tokens: 7 })).toBe(7);
    expect(usageOutputTokens({ completion_tokens: 3 })).toBe(3);
    expect(usageOutputTokens({ candidatesTokenCount: 11 })).toBe(11);
    expect(usageOutputTokens({ candidates_token_count: 8 })).toBe(8);
    expect(usageOutputTokens({ output: 5 })).toBe(5);
    expect(usageOutputTokens({ outputTokens: 0 })).toBe(0);
  });

  it("非法值跳过，改读下一个合法键", () => {
    expect(usageOutputTokens({ outputTokens: Number.NaN, completion_tokens: 9 })).toBe(9);
    expect(usageOutputTokens({ outputTokens: Number.POSITIVE_INFINITY })).toBeNull();
    expect(usageOutputTokens({ outputTokens: -1 })).toBeNull();
    expect(usageOutputTokens({ outputTokens: "12" })).toBeNull();
  });

  it("outputTokens 优先于 completion_tokens", () => {
    expect(usageOutputTokens({ outputTokens: 0, completion_tokens: 50 })).toBe(0);
  });
});

describe("OutputRateClock", () => {
  it("无首 token：TTFT / decode / tok/s 都省略", () => {
    const clock = new OutputRateClock();
    clock.start(1000);
    clock.complete(1800);
    expect(clock.settle({ completion_tokens: 40 })).toEqual({
      ttftMs: null,
      decodeMs: null,
      outputTokens: 40,
      tokensPerSecond: null,
    });
  });

  it("有首 token + usage：tok/s = output / (decodeMs/1000)", () => {
    const clock = new OutputRateClock();
    clock.start(1000);
    clock.noteTokenDelta(1300);
    clock.noteTokenDelta(1400);
    clock.complete(2300);
    const rate = clock.settle({ output_tokens: 80 });
    expect(rate.ttftMs).toBe(300);
    expect(rate.decodeMs).toBe(1000);
    expect(rate.outputTokens).toBe(80);
    expect(rate.tokensPerSecond).toBe(80);
  });

  it("decodeMs 为 0 时不算 tok/s", () => {
    const clock = new OutputRateClock();
    clock.start(0);
    clock.noteTokenDelta(10);
    clock.complete(10);
    expect(clock.settle({ outputTokens: 12 }).tokensPerSecond).toBeNull();
  });

  it("usage 缺失时不算 tok/s，墙钟仍保留", () => {
    const clock = new OutputRateClock();
    clock.start(0);
    clock.noteTokenDelta(200);
    clock.complete(700);
    expect(clock.settle(null)).toEqual({
      ttftMs: 200,
      decodeMs: 500,
      outputTokens: null,
      tokensPerSecond: null,
    });
    expect(clock.settle({})).toEqual({
      ttftMs: 200,
      decodeMs: 500,
      outputTokens: null,
      tokensPerSecond: null,
    });
  });

  it("未 complete 则 decode / tok/s 省略", () => {
    const clock = new OutputRateClock();
    clock.start(0);
    clock.noteTokenDelta(100);
    expect(clock.settle({ completion_tokens: 20 })).toEqual({
      ttftMs: 100,
      decodeMs: null,
      outputTokens: 20,
      tokensPerSecond: null,
    });
  });
});

describe("settleOutputRate / fold", () => {
  it("settleOutputRate 与 clock 同口径", () => {
    expect(
      settleOutputRate({ ttftMs: 120, decodeMs: 2000, usage: { completion_tokens: 50 } }),
    ).toEqual({
      ttftMs: 120,
      decodeMs: 2000,
      outputTokens: 50,
      tokensPerSecond: 25,
    });
  });

  it("多步：TTFT 取平均，吞吐用累加 decode", () => {
    let fold = emptyOutputRateFold();
    fold = addOutputRateSample(fold, {
      ttftMs: 200,
      decodeMs: 1000,
      outputTokens: 40,
      tokensPerSecond: 40,
    });
    fold = addOutputRateSample(fold, {
      ttftMs: 400,
      decodeMs: 3000,
      outputTokens: 60,
      tokensPerSecond: 20,
    });
    fold = addOutputRateSample(fold, {
      ttftMs: null,
      decodeMs: null,
      outputTokens: null,
      tokensPerSecond: null,
    });
    expect(foldTtftAverageMs(fold)).toBe(300);
    expect(foldTokensPerSecond(fold)).toBe(25);
  });

  it("缺 decode 采样时 fold tok/s 为 null", () => {
    let fold = emptyOutputRateFold();
    fold = addOutputRateSample(fold, {
      ttftMs: 80,
      decodeMs: null,
      outputTokens: 10,
      tokensPerSecond: null,
    });
    expect(foldTtftAverageMs(fold)).toBe(80);
    expect(foldTokensPerSecond(fold)).toBeNull();
  });
});

describe("formatTokensPerSecond", () => {
  it("≥10 取整，<10 一位小数", () => {
    expect(formatTokensPerSecond(9.44)).toBe("9.4");
    expect(formatTokensPerSecond(9.46)).toBe("9.5");
    expect(formatTokensPerSecond(10.4)).toBe("10");
    expect(formatTokensPerSecond(10.5)).toBe("11");
    expect(formatTokensPerSecond(0)).toBe("0");
    expect(formatTokensPerSecond(-3)).toBe("0");
  });
});
