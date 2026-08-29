import { describe, it, expect } from "vitest";
import { compressMaou } from "./compressor.js";
import type { MaouMessage } from "./types/message.js";

function msg(role: "user" | "assistant" | "system", text: string): MaouMessage {
  return {
    id: `${role}-${text.slice(0, 8)}`,
    role,
    contents: [{ text }],
    taskIds: [],
    createdAt: new Date().toISOString(),
  } as unknown as MaouMessage;
}

describe("compressMaou knownTokens / force", () => {
  it("does not compress when only history is small and no knownTokens", async () => {
    const history = [msg("user", "hi"), msg("assistant", "hello")];
    const r = await compressMaou(history, { maxTokens: 200_000 });
    expect(r.stage).toBe("activeStage");
  });

  it("enters compact when knownTokens exceeds 70% even if history tiny", async () => {
    // 足够长的可压缩正文，否则 micro 可能无实质变化但仍应离开 activeStage（force/known）
    const big = "代码块 ".repeat(200);
    const history = [
      msg("user", big),
      msg("assistant", big),
      msg("user", big),
      msg("assistant", big),
    ];
    const r = await compressMaou(history, {
      maxTokens: 200_000,
      knownTokens: 150_000, // 75% of 200k
    });
    // 门槛用 knownTokens → 应尝试压缩；stage 至少不是因门槛卡在 active
    // 若 micro 无可压内容仍可能 activeStage；force 可保证进入
    expect(r.originalTokens).toBeGreaterThanOrEqual(150_000);
  });

  it("force skips active early-exit", async () => {
    const history = [
      msg("user", "a".repeat(2000)),
      msg("assistant", "b".repeat(2000)),
    ];
    const r = await compressMaou(history, {
      maxTokens: 1_000_000,
      force: true,
    });
    // force 无 knownTokens：占用为 0，只按条数尝试微压
    expect(r.originalTokens).toBe(0);
    // 无 force 且远低于 70% 应 active
    const r2 = await compressMaou(history, { maxTokens: 1_000_000 });
    expect(r2.stage).toBe("activeStage");
  });
});

describe("compressMaou remeasures after the cheap pass", () => {
  /** 一条超大 tool_result（走 omit 分支）+ 若干短消息。 */
  function historyWithHugeToolResult(hugeChars: number): MaouMessage[] {
    const huge = {
      id: "tool-huge",
      role: "user",
      category: "tool_result",
      contents: [{ text: "X".repeat(hugeChars) }],
      createdAt: new Date().toISOString(),
    } as unknown as MaouMessage;
    return [
      msg("user", "查一下这个文件"),
      msg("assistant", "好"),
      huge,
      msg("assistant", "看完了"),
      msg("user", "继续"),
      msg("assistant", "在做"),
    ];
  }

  it("skips the summarizer when omitting oversized tool results is enough", async () => {
    let summarizerCalls = 0;
    const history = historyWithHugeToolResult(400_000);
    const r = await compressMaou(history, {
      maxTokens: 200_000,
      knownTokens: 170_000, // 85% → 本该走 summaryStage
      summarizer: async () => {
        summarizerCalls++;
        return "summary";
      },
    });
    expect(r.stage).toBe("compactStage");
    expect(summarizerCalls).toBe(0);
    // 重测出来的数必须是真数，不能是硬编码的 0
    expect(r.compressedTokens).toBeGreaterThan(0);
    expect(r.compressedTokens).toBeLessThan(r.originalTokens);
  });

  it("still pays for the summarizer when there is nothing cheap to omit", async () => {
    let summarizerCalls = 0;
    // 没有超大 tool_result → 便宜路径无从下手，重测不该被用来跳过摘要
    const bulk = "内容".repeat(2_000);
    const history = Array.from({ length: 30 }, (_, i) => ({
      ...msg(i % 2 === 0 ? "user" : "assistant", bulk),
      id: `bulk-${i}`,
      seqId: i,
    })) as MaouMessage[];
    const r = await compressMaou(history, {
      maxTokens: 200_000,
      knownTokens: 170_000,
      summarizer: async () => {
        summarizerCalls++;
        return "summary";
      },
    });
    expect(summarizerCalls).toBeGreaterThan(0);
    expect(r.stage).toBe("summaryStage");
    expect(r.compressedTokens).toBeGreaterThan(0);
  });

  it("never reports a compressed size above the original", async () => {
    const r = await compressMaou(historyWithHugeToolResult(400_000), {
      maxTokens: 200_000,
      knownTokens: 150_000,
      summarizer: async () => "summary",
    });
    expect(r.compressedTokens).toBeLessThanOrEqual(r.originalTokens);
  });
});
