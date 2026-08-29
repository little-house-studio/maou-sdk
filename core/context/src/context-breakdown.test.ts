import { describe, it, expect } from "vitest";
import { estimateTokensFromText } from "@little-house-studio/types";
import {
  IMAGE_TOKEN_ESTIMATE,
  MSG_ROLE_OVERHEAD,
  composeContextBreakdown,
  contextBarShares,
  estimateSessionMessageTokens,
  estimateSystemTokens,
  estimateToolsTokens,
  formatContextBreakdownBlock,
  formatTokenCount,
} from "./context-breakdown.js";

describe("composeContextBreakdown", () => {
  it("anchors occupancy to vendor used/window and leaves residual as overhead", () => {
    const systemText = "you are a coding agent";
    const tools = [{ name: "reader", parameters: { type: "object" } }];
    const b = composeContextBreakdown({
      window: 100_000,
      used: 12_000,
      promptTotal: 10_000,
      output: 2_000,
      cacheRead: 4_000,
      cacheReported: true,
      systemText,
      toolSchemas: tools,
      messages: [{ role: "user", content: "hello world" }],
      toolCount: 1,
    });
    const composed = b.system + b.tools + b.messages;
    expect(b.occupancyPct).toBe(12);
    expect(b.free).toBe(88_000);
    expect(b.overhead).toBe(12_000 - composed);
    expect(b.system).toBe(estimateSystemTokens(systemText));
    expect(b.tools).toBe(estimateToolsTokens(tools));
    expect(b.cacheHitPct).toBe(40);
    expect(b.toolCount).toBe(1);
  });

  it("scales heuristic parts down when they exceed vendor used", () => {
    const b = composeContextBreakdown({
      window: 1000,
      used: 100,
      systemTokens: 80,
      toolsTokens: 80,
      messageTokens: 80,
    });
    expect(b.system + b.tools + b.messages + b.overhead).toBe(100);
    expect(b.system).toBe(33);
    expect(b.tools).toBe(33);
    expect(b.messages).toBe(33);
    expect(b.overhead).toBe(1);
    expect(b.free).toBe(900);
  });

  it("hides cache hit when usage never reported cache fields", () => {
    const b = composeContextBreakdown({
      window: 8000,
      used: 100,
      promptTotal: 80,
      cacheRead: 0,
      cacheReported: false,
    });
    expect(b.cacheHitPct).toBeNull();
  });

  it("counts images at 765 and skips ui-only messages", () => {
    const visible = estimateSessionMessageTokens({
      role: "user",
      content: "see this",
      images: [{ mimeType: "image/png", data: "AAA" }],
    });
    expect(visible.images).toBe(1);
    expect(visible.tokens).toBeGreaterThanOrEqual(
      MSG_ROLE_OVERHEAD + IMAGE_TOKEN_ESTIMATE,
    );
    const b = composeContextBreakdown({
      window: 10_000,
      used: 2000,
      messages: [
        { role: "user", content: "see this", images: [{ mimeType: "image/png", data: "x" }] },
        { role: "user", content: "secret", visibility: "ui" },
      ],
    });
    expect(b.imageCount).toBe(1);
    expect(b.messages).toBe(visible.tokens);
  });
});

describe("contextBarShares / format", () => {
  it("shares sum to about 100 against the window", () => {
    const b = composeContextBreakdown({
      window: 200,
      used: 50,
      systemTokens: 10,
      toolsTokens: 10,
      messageTokens: 20,
    });
    const shares = contextBarShares(b);
    const filled = shares.filter((s) => s.key !== "free");
    expect(filled.reduce((a, s) => a + s.widthPct, 0)).toBeCloseTo(25, 5);
    expect(shares.find((s) => s.key === "free")?.widthPct).toBeCloseTo(75, 5);
    expect(formatTokenCount(12_300)).toBe("12.3k");
    expect(formatContextBreakdownBlock(b)).toContain("System");
    expect(formatContextBreakdownBlock(b)).toContain("Free");
  });

  it("keeps the bar empty when occupancy is 0", () => {
    const b = composeContextBreakdown({
      window: 1000,
      used: 0,
      systemTokens: 40,
      toolsTokens: 20,
      messageTokens: 10,
    });
    const shares = contextBarShares(b);
    expect(b.system).toBe(40);
    expect(shares.find((s) => s.key === "free")?.widthPct).toBe(100);
    expect(shares.filter((s) => s.key !== "free").every((s) => s.widthPct === 0)).toBe(true);
  });

  it("uses CJK-aware estimate, not raw bytes/4", () => {
    const zh = "中文系统提示词";
    expect(estimateSystemTokens(zh)).toBe(zh.length + MSG_ROLE_OVERHEAD);
    expect(estimateTokensFromText(zh)).toBe(zh.length);
  });

  it("marks an estimated occupancy with ~ so nobody reads it as vendor truth", () => {
    const real = composeContextBreakdown({ window: 1000, used: 500, messageTokens: 100 });
    expect(real.usedIsEstimate).toBe(false);
    expect(formatContextBreakdownBlock(real)).not.toContain("~");

    const guessed = composeContextBreakdown({
      window: 1000,
      used: 500,
      usedIsEstimate: true,
      messageTokens: 100,
    });
    expect(guessed.usedIsEstimate).toBe(true);
    expect(formatContextBreakdownBlock(guessed)).toContain("~");
    // 估算与否只影响标注，不影响数字
    expect(guessed.used).toBe(real.used);
    expect(guessed.messages).toBe(real.messages);
  });
});
