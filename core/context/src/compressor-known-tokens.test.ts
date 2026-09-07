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

  it("stays idle at 75% and only acts at the 80% DSH pressure line", async () => {
    const big = "代码块 ".repeat(200);
    const history = [
      msg("user", big),
      msg("assistant", big),
      msg("user", big),
      msg("assistant", big),
    ];
    const below = await compressMaou(history, {
      maxTokens: 200_000,
      knownTokens: 150_000,
    });
    expect(below.stage).toBe("activeStage");
    const atLine = await compressMaou(history, {
      maxTokens: 200_000,
      knownTokens: 160_000,
    });
    expect(atLine.originalTokens).toBeGreaterThanOrEqual(160_000);
    expect(atLine.stage).not.toBe("activeStage");
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
    // 无 force 且远低于 80% 应 active
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

  it("auto pressure at 80% keeps a 16% verbatim tail; force keeps one", async () => {
    const bulk = "内容".repeat(2_000);
    const history = Array.from({ length: 30 }, (_, i) => ({
      ...msg(i % 2 === 0 ? "user" : "assistant", `${i} ${bulk}`),
      id: `tail-${i}`,
      seqId: i,
    })) as MaouMessage[];
    const auto = await compressMaou(history, {
      maxTokens: 200_000,
      knownTokens: 160_000,
    });
    expect(auto.stage).toBe("summaryStage");
    const autoTail = auto.history.filter((m) => m.compact?.type !== "fold" && m.compact?.type !== "archive");
    expect(autoTail.length).toBeGreaterThanOrEqual(Math.floor(30 * 0.16));
    expect(auto.history.some((m) => m.contents[0]?.text.startsWith("29 "))).toBe(true);
    expect(auto.history.some((m) => m.contents[0]?.text.startsWith("0 "))).toBe(false);

    const forced = await compressMaou(history, {
      maxTokens: 200_000,
      knownTokens: 160_000,
      force: true,
    });
    const forcedTail = forced.history.filter((m) => m.compact?.type !== "fold" && m.compact?.type !== "archive");
    expect(forcedTail.length).toBe(1);
    expect(forcedTail[0]!.contents[0]!.text.startsWith("29 ")).toBe(true);
  });

  it("folds the unfolded span at 80% without calling the summarizer", async () => {
    let summarizerCalls = 0;
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
    expect(summarizerCalls).toBe(0);
    expect(r.stage).toBe("summaryStage");
    expect(r.history.some((m) => m.compact?.type === "fold")).toBe(true);
    expect(r.compressedTokens).toBeGreaterThan(0);
  });

  it("llm scheme summarizes at 80% and leaves an archive card", async () => {
    let summarizerCalls = 0;
    const bulk = "内容".repeat(2_000);
    const history = Array.from({ length: 30 }, (_, i) => ({
      ...msg(i % 2 === 0 ? "user" : "assistant", bulk),
      id: `llm-${i}`,
      seqId: i,
    })) as MaouMessage[];
    const r = await compressMaou(history, {
      maxTokens: 200_000,
      knownTokens: 170_000,
      majorScheme: "llm",
      summarizer: async () => {
        summarizerCalls++;
        return "## Primary Request\n- llm-scheme";
      },
    });
    expect(summarizerCalls).toBe(1);
    expect(r.stage).toBe("archiveStage");
    expect(r.history.some((m) => m.compact?.type === "archive")).toBe(true);
    expect(r.history.some((m) => m.compact?.type === "fold")).toBe(false);
    expect(r.droppedSummary).toContain("archived-context");
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
