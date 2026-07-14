/**
 * PromptCacheLedger 分桶测试（agent 层）。
 * 跑：cd core/agent && npx vitest run src/agent/prompt-cache-ledger.test.ts
 * 或由 monorepo 根测试收集。
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  PromptCacheLedger,
  modelReportsPromptCache,
  isMainAgentMainModelUsage,
} from "./prompt-cache-ledger.js";

describe("PromptCacheLedger", () => {
  beforeEach(() => {
    PromptCacheLedger.resetGlobal();
  });

  it("modelReportsPromptCache: xopqwen 无能力", () => {
    expect(modelReportsPromptCache("xopqwen36v35b", "xfyun")).toBe(false);
    expect(modelReportsPromptCache("gpt-4o", "openai")).toBe(true);
  });

  it("按 agent+session+model 分桶，切回可恢复", () => {
    const L = PromptCacheLedger.global();
    L.recordUsage({
      agentName: "coding",
      sessionId: "s1",
      model: "gpt-4o",
      role: "main",
      usage: { prompt_tokens: 1000, completion_tokens: 10, cached_tokens: 800 },
    });
    L.sealRound("coding", "s1", "gpt-4o");

    L.recordUsage({
      agentName: "coding",
      sessionId: "s1",
      model: "gpt-4o",
      role: "main",
      usage: { prompt_tokens: 100, completion_tokens: 5, cached_tokens: 0 },
    });
    L.sealRound("coding", "s1", "gpt-4o");

    const snap = L.snapshot("coding", "s1", "gpt-4o");
    expect(snap.samples).toHaveLength(2);
    // 800/(1000+100) = 72.7 → 73
    expect(snap.avgHitPct).toBe(73);

    // 另一会话桶独立
    expect(L.snapshot("coding", "s2", "gpt-4o").samples).toHaveLength(0);

    // 另一 agent 独立
    expect(L.snapshot("maou", "s1", "gpt-4o").samples).toHaveLength(0);

    // 切回原桶仍在
    expect(L.snapshot("coding", "s1", "gpt-4o").avgHitPct).toBe(73);
  });

  it("helper / 不同 model 不入主桶", () => {
    const L = PromptCacheLedger.global();
    expect(
      L.recordUsage({
        agentName: "coding",
        sessionId: "s1",
        model: "gpt-4o-mini",
        role: "helper",
        usage: { prompt_tokens: 50, cached_tokens: 40 },
      }),
    ).toBeNull();

    L.recordUsage({
      agentName: "coding",
      sessionId: "s1",
      model: "gpt-4o",
      role: "main",
      usage: { prompt_tokens: 200, cached_tokens: 100 },
    });
    L.sealRound("coding", "s1", "gpt-4o");
    expect(L.snapshot("coding", "s1", "gpt-4o").samples).toHaveLength(1);
    expect(L.snapshot("coding", "s1", "gpt-4o-mini").samples).toHaveLength(0);
  });

  it("xopqwen 不写假 0% 样本，label 为 c—", () => {
    const L = PromptCacheLedger.global();
    L.recordUsage({
      agentName: "coding",
      sessionId: "s1",
      model: "xopqwen36v35b",
      provider: "xfyun",
      role: "main",
      usage: { prompt_tokens: 5000, completion_tokens: 20, cached_tokens: 0 },
    });
    const afterSeal = L.sealRound("coding", "s1", "xopqwen36v35b");
    expect(afterSeal.reportsCache).toBe(false);
    expect(afterSeal.samples).toHaveLength(0);
    expect(afterSeal.label).toBe(" c—");
    expect(afterSeal.avgHitPct).toBeNull();
  });

  it("isMainAgentMainModelUsage 过滤 supervisor", () => {
    expect(
      isMainAgentMainModelUsage({
        role: "main",
        agentName: "supervisor",
        mainAgentName: "coding",
        usageModel: "gpt-4o",
        mainModel: "gpt-4o",
      }),
    ).toBe(false);
  });
});
