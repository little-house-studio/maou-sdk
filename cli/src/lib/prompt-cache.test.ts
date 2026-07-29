import { describe, it, expect } from "vitest";
import {
  avgCacheHitPct,
  formatCacheLabel,
  isMainAgentMainModelUsage,
  modelReportsPromptCache,
} from "./prompt-cache.js";

describe("prompt-cache helpers", () => {
  it("讯飞 xop* 默认可显示 cache（不再宽黑名单）", () => {
    expect(modelReportsPromptCache("xopglm51", "xfyun-glm-coding")).toBe(true);
    expect(modelReportsPromptCache("xopqwen36v35b", "xfyun")).toBe(true);
    expect(modelReportsPromptCache("gpt-4o", "openai")).toBe(true);
    expect(modelReportsPromptCache("claude-sonnet-4-5", "anthropic")).toBe(true);
    expect(modelReportsPromptCache("deepseek-chat", "deepseek")).toBe(true);
  });

  it("formatCacheLabel: 无样本 → c—；有样本 → cN%（含讯飞模型名）", () => {
    // 无 history 时仍是 c—（eligible 但尚无样本）
    expect(formatCacheLabel("xopglm51", "xfyun", []).label).toBe(" c—");
    expect(formatCacheLabel("gpt-4o", "openai", []).label).toBe(" c—");
    expect(
      formatCacheLabel("xopglm51", "xfyun-glm-coding", [
        { cacheRead: 17664, input: 17793 },
      ]).pct,
    ).toBe(99);
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
