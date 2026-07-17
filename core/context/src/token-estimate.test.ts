import { describe, it, expect } from "vitest";
import {
  parsePromptTokensFromUsage,
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

describe("resolveContextUsedTokens", () => {
  it("takes max of api and estimate", () => {
    expect(resolveContextUsedTokens({ apiPromptTokens: 180_000, estimatedPromptTokens: 90_000 })).toBe(180_000);
    expect(resolveContextUsedTokens({ apiPromptTokens: 10_000, estimatedPromptTokens: 50_000 })).toBe(50_000);
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
