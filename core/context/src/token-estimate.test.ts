import { describe, it, expect } from "vitest";
import {
  parsePromptTokensFromUsage,
  parseUsageTokens,
  occupancyFromUsage,
  estimateFullPromptTokens,
  resolveContextUsedTokens,
  estimateTokensFromText,
} from "./token-estimate.js";

describe("parsePromptTokensFromUsage", () => {
  it("reads prompt_tokens", () => {
    expect(parsePromptTokensFromUsage({ prompt_tokens: 196700 })).toBe(196700);
  });
  it("reads input_tokens / input aliases", () => {
    expect(parsePromptTokensFromUsage({ input_tokens: 100 })).toBe(100);
    expect(parsePromptTokensFromUsage({ input: 50 })).toBe(50);
  });
  it("derives from total - completion when needed", () => {
    expect(
      parsePromptTokensFromUsage({ total_tokens: 210, completion_tokens: 10 }),
    ).toBe(200);
  });
  it("returns 0 for empty", () => {
    expect(parsePromptTokensFromUsage(null)).toBe(0);
    expect(parsePromptTokensFromUsage({})).toBe(0);
  });
});

describe("occupancyFromUsage / resolveContextUsedTokens", () => {
  it("adds last input + output and ignores estimates", () => {
    expect(occupancyFromUsage({ prompt_tokens: 100, completion_tokens: 20 })).toBe(120);
    expect(parseUsageTokens({ input_tokens: 80, output_tokens: 5 })).toEqual({
      input: 80,
      output: 5,
    });
    expect(resolveContextUsedTokens({ apiPromptTokens: 180_000, estimatedPromptTokens: 90_000 })).toBe(180_000);
    expect(resolveContextUsedTokens({ apiPromptTokens: 10_000, estimatedPromptTokens: 50_000 })).toBe(10_000);
    expect(resolveContextUsedTokens({ input: 100, output: 20, estimatedPromptTokens: 9_999 })).toBe(120);
    expect(resolveContextUsedTokens({})).toBe(0);
  });
});

describe("estimateFullPromptTokens", () => {
  it("adds system and tools on top of history", () => {
    const hist = 1000;
    const system = "x".repeat(400); // ~100 tokens ascii
    const tools = [{ name: "reader", parameters: { type: "object" } }];
    const full = estimateFullPromptTokens({
      historyTokens: hist,
      systemPrompt: system,
      toolSchemas: tools,
    });
    expect(full).toBeGreaterThan(hist);
    expect(full).toBeGreaterThanOrEqual(hist + estimateTokensFromText(system));
  });
});
