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

  it("modelReportsPromptCache: 讯飞 xopglm/xopqwen 默认可上报（靠 usage 字段定 c—）", () => {
    // 实测 xfyun MaaS 会回 cached_tokens；旧黑名单 /xop/ 误伤 xopglm51
    expect(modelReportsPromptCache("xopglm51", "xfyun-glm-coding")).toBe(true);
    expect(modelReportsPromptCache("xopglm51", "xfyun")).toBe(true);
    expect(modelReportsPromptCache("xopqwen36v35b", "xfyun")).toBe(true);
    expect(modelReportsPromptCache("gpt-4o", "openai")).toBe(true);
    expect(modelReportsPromptCache("sparkdesk", "")).toBe(false);
  });

  it("xopglm51 + 讯飞 usage 含 cached_tokens → 样本与命中率", () => {
    const L = PromptCacheLedger.global();
    L.recordUsage({
      agentName: "ops",
      sessionId: "s-xfyun",
      model: "xopglm51",
      provider: "xfyun-glm-coding",
      role: "main",
      usage: {
        prompt_tokens: 17793,
        completion_tokens: 125,
        prompt_tokens_details: { cached_tokens: 17664 },
        cached_tokens: 17664,
      },
    });
    const mid = L.snapshot("ops", "s-xfyun", "xopglm51");
    expect(mid.sawCacheField).toBe(true);
    expect(mid.avgHitPct).toBe(99); // 含未 seal current
    L.sealRound("ops", "s-xfyun", "xopglm51");
    const sealed = L.snapshot("ops", "s-xfyun", "xopglm51");
    expect(sealed.samples).toHaveLength(1);
    expect(sealed.avgHitPct).toBe(99);
    expect(sealed.label).toBe(" c99%");
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

  it("xopqwen + usage 带 cached_tokens:0 → c0%（字段在即上报，不是假 c—）", () => {
    const L = PromptCacheLedger.global();
    L.recordUsage({
      agentName: "coding",
      sessionId: "s1",
      model: "xopqwen36v35b",
      provider: "xfyun",
      role: "main",
      // 字段存在但值为 0 = 本轮未命中，应显示 c0% 而非永久 c—
      usage: { prompt_tokens: 5000, completion_tokens: 20, cached_tokens: 0 },
    });
    const afterSeal = L.sealRound("coding", "s1", "xopqwen36v35b");
    expect(afterSeal.reportsCache).toBe(true);
    expect(afterSeal.sawCacheField).toBe(true);
    expect(afterSeal.samples).toHaveLength(1);
    expect(afterSeal.label).toBe(" c0%");
    expect(afterSeal.avgHitPct).toBe(0);
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

  it("Anthropic 形状：命中率不再爆表（input_tokens 不含命中）", () => {
    const L = PromptCacheLedger.global();
    // 首轮建缓存：200 新输入 + 5000 写入 → 命中 0%
    L.recordUsage({
      agentName: "coding",
      sessionId: "s1",
      model: "claude-sonnet-4-5",
      provider: "anthropic",
      role: "main",
      usage: {
        input_tokens: 200,
        output_tokens: 100,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 5000,
      },
    });
    L.sealRound("coding", "s1", "claude-sonnet-4-5");
    // 次轮全命中：100 新输入 + 5200 命中
    L.recordUsage({
      agentName: "coding",
      sessionId: "s1",
      model: "claude-sonnet-4-5",
      provider: "anthropic",
      role: "main",
      usage: {
        input_tokens: 100,
        output_tokens: 80,
        cache_read_input_tokens: 5200,
        cache_creation_input_tokens: 0,
      },
    });
    const snap = L.sealRound("coding", "s1", "claude-sonnet-4-5");

    expect(snap.samples).toHaveLength(2);
    // 分母是 prompt 总量：(200+5000) + (100+5200) = 10500，命中 5200 → 50%
    expect(snap.samples[0]!.input).toBe(5200);
    expect(snap.samples[1]!.input).toBe(5300);
    expect(snap.avgHitPct).toBe(50);
    expect(snap.label).toBe(" c50%");
    // 旧算法 5200/(200+100) = 1733%
    expect(snap.avgHitPct!).toBeLessThanOrEqual(100);
  });

  it("模型可能上报但 usage 无 cache 字段 → 不写假 0%，label c—", () => {
    const L = PromptCacheLedger.global();
    // 模型名不在黑名单（reportsCache=true），但端点从不返回 cache 字段
    L.recordUsage({
      agentName: "coding",
      sessionId: "s1",
      model: "some-relay-model-v2",
      provider: "customrelay",
      role: "main",
      usage: { prompt_tokens: 4000, completion_tokens: 30 },
    });
    const snap = L.sealRound("coding", "s1", "some-relay-model-v2");
    expect(snap.reportsCache).toBe(true); // 未被黑名单排除
    expect(snap.sawCacheField).toBe(false); // 但从未上报
    expect(snap.samples).toHaveLength(0);
    expect(snap.label).toBe(" c—");
    expect(snap.avgHitPct).toBeNull();
  });

  it("上报了但恒为 0 → c0%（与「不上报」区分开）", () => {
    const L = PromptCacheLedger.global();
    L.recordUsage({
      agentName: "coding",
      sessionId: "s1",
      model: "gpt-4o",
      role: "main",
      usage: { prompt_tokens: 4000, completion_tokens: 30, cached_tokens: 0 },
    });
    const snap = L.sealRound("coding", "s1", "gpt-4o");
    expect(snap.sawCacheField).toBe(true);
    expect(snap.samples).toHaveLength(1);
    expect(snap.avgHitPct).toBe(0);
    expect(snap.label).toBe(" c0%");
  });

  it("clearSession 清得掉空 sessionId 的桶（/new 后不串上一会话）", () => {
    const L = PromptCacheLedger.global();
    L.recordUsage({
      agentName: "coding",
      sessionId: "",
      model: "gpt-4o",
      role: "main",
      usage: { prompt_tokens: 1000, cached_tokens: 800 },
    });
    L.sealRound("coding", "", "gpt-4o");
    expect(L.snapshot("coding", "", "gpt-4o").samples).toHaveLength(1);

    L.clearSession("coding", "");
    expect(L.snapshot("coding", "", "gpt-4o").samples).toHaveLength(0);
    expect(L.bucketCount()).toBe(0);
  });

  it("clearSession 只清目标会话，不误伤同 agent 其他会话", () => {
    const L = PromptCacheLedger.global();
    for (const sid of ["s1", "s2"]) {
      L.recordUsage({
        agentName: "coding",
        sessionId: sid,
        model: "gpt-4o",
        role: "main",
        usage: { prompt_tokens: 1000, cached_tokens: 500 },
      });
      L.sealRound("coding", sid, "gpt-4o");
    }
    L.clearSession("coding", "s1");
    expect(L.snapshot("coding", "s1", "gpt-4o").samples).toHaveLength(0);
    expect(L.snapshot("coding", "s2", "gpt-4o").samples).toHaveLength(1);
  });
});
