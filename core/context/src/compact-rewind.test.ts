import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compressMaou } from "./compressor.js";
import { ContextEngine } from "./context-engine.js";
import { HarnessSessionStore } from "./harness-session-store.js";
import {
  contextStructure,
  describeContextDrift,
  noteContextStructure,
  takeContextStructure,
  type ContextAssertRecord,
} from "./context-assert.js";
import { removedSeqRange, seqRangeOf, type MaouMessage } from "./types/message.js";

function msg(seqId: number, text: string, category: MaouMessage["category"] = "user"): MaouMessage {
  return {
    seqId,
    taskIds: [`t${seqId}`],
    category,
    contents: [{ text }],
    originalRole: category === "assistant" ? "assistant" : "user",
  };
}

describe("seqRangeOf / removedSeqRange", () => {
  it("takes the closed interval and ignores unassigned seqIds", () => {
    expect(seqRangeOf([msg(4, "a"), msg(9, "b"), msg(7, "c")])).toEqual({ start: 4, end: 9 });
    expect(seqRangeOf([{ ...msg(-1, "x") }])).toBeNull();
    expect(seqRangeOf([])).toBeNull();
  });

  it("reports what a compression dropped, regardless of which stage did it", () => {
    const before = [msg(1, "a"), msg(2, "b"), msg(3, "c"), msg(4, "d")];
    const after = [msg(1, "a"), msg(4, "d")];
    expect(removedSeqRange(before, after)).toEqual({ start: 2, end: 3 });
  });

  it("says nothing was dropped when every message survived", () => {
    const before = [msg(1, "a"), msg(2, "b")];
    expect(removedSeqRange(before, before)).toBeNull();
  });
});

describe("summaries point back at the seq range they replaced", () => {
  it("fills compact.seqRange on the summary message", async () => {
    const history: MaouMessage[] = [];
    for (let i = 0; i < 40; i++) {
      const m = msg(i, `第 ${i} 条：${"内容".repeat(400)}`, i % 2 === 0 ? "user" : "assistant");
      m.taskIds = [`task-${Math.floor(i / 10)}`];
      history.push(m);
    }
    const res = await compressMaou(history, {
      maxTokens: 1000,
      knownTokens: 900,
      summarizer: async () => "摘要",
      force: true,
    });
    expect(res.stage).not.toBe("activeStage");
    const summaries = res.history.filter((m) => m.compact?.seqRange);
    expect(summaries.length).toBeGreaterThan(0);
    for (const s of summaries) {
      const r = s.compact!.seqRange!;
      expect(r.end).toBeGreaterThanOrEqual(r.start);
      expect(r.start).toBeGreaterThanOrEqual(0);
      expect(r.end).toBeLessThan(history.length);
    }
  });
});

describe("getCompactedRange", () => {
  let dir: string;
  const SID = "sess-rewind";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "maou-rewind-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns the pre-compression originals for the range the report names", async () => {
    const harnessStore = new HarnessSessionStore({ maouRoot: dir });
    const engine = new ContextEngine({
      sessionId: SID,
      harnessStore,
      summarizer: async () => "摘要",
    });

    const source: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 40; i++) {
      source.push({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `第 ${i} 条：${"内容".repeat(400)}`,
      });
    }
    engine.seedWorkingSet(source);
    const report = await engine.compress(1000, { knownTokens: 900, force: true });

    expect(report.seqFrom).toBeTypeOf("number");
    expect(report.seqTo).toBeTypeOf("number");
    const back = engine.getCompactedRange(report.seqFrom!, report.seqTo!);
    expect(back).not.toBeNull();
    expect(back!.length).toBeGreaterThan(0);
    for (const m of back!) {
      expect(m.seqId).toBeGreaterThanOrEqual(report.seqFrom!);
      expect(m.seqId).toBeLessThanOrEqual(report.seqTo!);
    }
    // 原文必须是压缩前的样子，而不是摘要
    expect(back!.some((m) => m.contents.some((c) => c.text.includes("内容内容")))).toBe(true);
  });

  it("refuses to pass off the compressed history as the original", () => {
    const harnessStore = new HarnessSessionStore({ maouRoot: dir });
    expect(harnessStore.getSeqRange("never-compressed", 0, 10)).toBeNull();
  });
});

describe("MAOU_CONTEXT_ASSERT replay check", () => {
  const prefix = [
    { role: "system", content: "SYSTEM" },
    { role: "user", content: "FILE CACHE" },
  ];
  const rec = (
    messages: Array<Record<string, unknown>>,
    prefixCount: number,
    generation: number,
  ): ContextAssertRecord => ({ ...contextStructure(messages, prefixCount), generation });

  it("stays quiet when the stable prefix is unchanged and the tail grew", () => {
    const a = rec([...prefix, { role: "user", content: "第一轮" }], 2, 0);
    const b = rec([...prefix, { role: "user", content: "第一轮" }, { role: "user", content: "第二轮" }], 2, 0);
    expect(describeContextDrift(a, b)).toBeNull();
  });

  it("shouts when the prefix changed without a compression", () => {
    const a = rec(prefix, 2, 0);
    const b = rec([{ role: "system", content: "SYSTEM 改过了" }, prefix[1]!], 2, 0);
    const drift = describeContextDrift(a, b);
    expect(drift).toBeTruthy();
    expect(drift).toContain("没有压缩");
  });

  it("accepts a prefix change that a compression explains", () => {
    const a = rec(prefix, 2, 0);
    const b = rec([...prefix, { role: "system", content: "<prior_context_summary>…" }], 3, 1);
    expect(describeContextDrift(a, b)).toBeNull();
  });

  it("has no previous record on the first build", () => {
    expect(describeContextDrift(null, rec(prefix, 2, 0))).toBeNull();
  });

  it("ignores image bytes so a re-encode does not read as drift", () => {
    const withImage = (data: string): Array<Record<string, unknown>> => [
      { role: "system", content: "SYSTEM" },
      { role: "user", content: [{ type: "text", text: "看图" }, { type: "image_url", image_url: { url: data } }] },
    ];
    expect(contextStructure(withImage("data:a"), 2).prefixHash).toBe(
      contextStructure(withImage("data:b"), 2).prefixHash,
    );
  });

  it("latches nothing while the assertion is off", () => {
    delete process.env.MAOU_CONTEXT_ASSERT;
    noteContextStructure(prefix, 2);
    expect(takeContextStructure()).toBeNull();
  });

  it("latches once and hands it over when the assertion is on", () => {
    process.env.MAOU_CONTEXT_ASSERT = "1";
    try {
      noteContextStructure(prefix, 2);
      const got = takeContextStructure();
      expect(got?.prefixCount).toBe(2);
      expect(takeContextStructure()).toBeNull();
    } finally {
      delete process.env.MAOU_CONTEXT_ASSERT;
    }
  });
});
