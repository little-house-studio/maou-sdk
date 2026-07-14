import { describe, it, expect } from "vitest";
import {
  avgCacheHitPct,
  formatCacheLabel,
  isMainAgentMainModelUsage,
  modelReportsPromptCache,
} from "./prompt-cache.js";

describe("prompt-cache helpers", () => {
  it("xopqwen 等不支持 cache 上报", () => {
    expect(modelReportsPromptCache("xopqwen36v35b", "xfyun")).toBe(false);
    expect(modelReportsPromptCache("xopqwen36v35", "")).toBe(false);
    expect(modelReportsPromptCache("gpt-4o", "openai")).toBe(true);
    expect(modelReportsPromptCache("claude-sonnet-4-5", "anthropic")).toBe(true);
    expect(modelReportsPromptCache("deepseek-chat", "deepseek")).toBe(true);
  });

  it("formatCacheLabel: 无能力 → c—；有样本 → cN%", () => {
    expect(formatCacheLabel("xopqwen36v35b", "xfyun", [{ cacheRead: 0, input: 1000 }]).label).toBe(" c—");
    expect(formatCacheLabel("gpt-4o", "openai", []).label).toBe(" c—");
    expect(
      formatCacheLabel("gpt-4o", "openai", [
        { cacheRead: 900, input: 1000 },
        { cacheRead: 0, input: 100 },
      ]).pct,
    ).toBe(82);
  });

  it("isMainAgentMainModelUsage 过滤 helper / 错 agent", () => {
    expect(
      isMainAgentMainModelUsage({
        role: "helper",
        usageModel: "gpt-4o",
        mainModel: "gpt-4o",
        agentName: "coding",
        mainAgentName: "coding",
      }),
    ).toBe(false);
    expect(
      isMainAgentMainModelUsage({
        role: "main",
        usageModel: "gpt-4o",
        mainModel: "gpt-4o",
        agentName: "supervisor",
        mainAgentName: "coding",
      }),
    ).toBe(false);
    expect(
      isMainAgentMainModelUsage({
        role: "main",
        usageModel: "gpt-4o",
        mainModel: "gpt-4o",
        agentName: "coding",
        mainAgentName: "coding",
      }),
    ).toBe(true);
  });

  it("avgCacheHitPct 合并分母", () => {
    expect(avgCacheHitPct([{ cacheRead: 900, input: 1000 }, { cacheRead: 0, input: 100 }])).toBe(82);
  });
});
