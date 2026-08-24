/**
 * DESIGN 对齐：active 原文区在 micro / summary / archive 后仍保留最新消息原文。
 */
import { describe, it, expect } from "vitest";
import {
  compressMaou,
  retainTailBoundary,
  activeWindowSeqIds,
  assignTaskIds,
} from "./compressor.js";
import { RETAIN_TAIL_RATIO } from "./constants.js";
import type { MaouMessage } from "./types/message.js";
import { estimateTokens } from "./token-estimate.js";

function msg(
  seqId: number,
  category: MaouMessage["category"],
  text: string,
  extra?: Partial<MaouMessage>,
): MaouMessage {
  return {
    seqId,
    taskIds: [],
    contents: [{ text }],
    keepAfterCompress: false,
    category,
    originalRole:
      category === "tool_result"
        ? "tool"
        : category === "assistant" || category === "tool_call"
          ? "assistant"
          : category === "system"
            ? "system"
            : "user",
    ...extra,
  };
}

function buildHistory(n: number): MaouMessage[] {
  const out: MaouMessage[] = [];
  for (let i = 0; i < n; i++) {
    const user = i % 2 === 0;
    out.push(
      msg(
        i,
        user ? "user" : "assistant",
        user
          ? `用户轮 ${i} 请处理长任务 ${"x".repeat(400)}`
          : `助手轮 ${i} 已完成检查 ${"y".repeat(600)}`,
      ),
    );
  }
  return assignTaskIds(out);
}

describe("DESIGN active window", () => {
  it("retainTailBoundary keeps the newest unit and a token-sized tail", () => {
    expect(retainTailBoundary([], 100)).toBe(0);
    const short = buildHistory(4);
    expect(retainTailBoundary(short, 50_000)).toBe(0);
    const long = buildHistory(20);
    const b = retainTailBoundary(long, 400);
    expect(b).toBeGreaterThan(0);
    expect(b).toBeLessThan(20);
    expect(20 - b).toBeGreaterThanOrEqual(1);
  });

  it("summary stage keeps tail active messages as raw text", async () => {
    const history = buildHistory(24);
    const tailMarker = "UNIQUE_ACTIVE_TAIL_MARKER_999";
    history[history.length - 1] = msg(
      history.length - 1,
      "user",
      tailMarker + " " + "z".repeat(100),
    );
    const headMarker = "UNIQUE_OLD_HEAD_MARKER_000";
    history[0] = msg(0, "user", headMarker + " " + "w".repeat(500));
    const assigned = assignTaskIds(history);

    const before = estimateTokens(assigned);
    const r = await compressMaou(assigned, {
      maxTokens: Math.max(800, Math.floor(before * 0.5)),
      knownTokens: before * 2,
      retainTokens: Math.max(80, Math.floor(before * RETAIN_TAIL_RATIO)),
      force: true,
    });

    expect(["summaryStage", "archiveStage", "compactStage"]).toContain(r.stage);

    // 最新原文区必须还在工作集里
    const texts = r.history.map((m) => m.contents.map((c) => c.text).join("\n")).join("\n");
    expect(texts).toContain(tailMarker);

    // active 边界内的 seq 应出现在 history
    const activeSeq = activeWindowSeqIds(assigned);
    const histSeq = new Set(r.history.map((m) => m.seqId));
    for (const id of activeSeq) {
      // 若该消息被 keep 的摘要替换，seq 可能变；至少 tail 用户消息在
      if (id === assigned[assigned.length - 1]!.seqId) {
        expect(histSeq.has(id) || texts.includes(tailMarker)).toBe(true);
      }
    }

    // 旧侧应出现 task_summary 或被缩短（不一定还含 head 全文）
    const headStillFull = texts.includes(headMarker + " " + "w".repeat(100));
    // 大压缩后旧头不应以全文长串保留（允许摘要里出现短片段）
    if (r.stage === "summaryStage" || r.stage === "archiveStage") {
      expect(headStillFull).toBe(false);
    }
  });

  it("micro stage does not rewrite active-zone messages", async () => {
    const history = buildHistory(20);
    const retain = Math.max(80, Math.floor(estimateTokens(history) * RETAIN_TAIL_RATIO));
    const b = retainTailBoundary(history, retain);
    const activeText = history[b]!.contents[0]!.text;
    const r = await compressMaou(history, {
      maxTokens: 50_000,
      knownTokens: 40_000,
      retainTokens: retain,
      force: true,
    });
    // 找 boundary 对应原 seq 的消息
    const m = r.history.find((x) => x.seqId === history[b]!.seqId);
    if (m) {
      expect(m.contents.map((c) => c.text).join("")).toContain(activeText.slice(0, 40));
    }
  });
});
