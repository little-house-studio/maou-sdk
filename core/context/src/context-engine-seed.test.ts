/**
 * B1：压缩工作集复用 —— seedWorkingSet 从 harness 恢复 + append session 增量
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContextEngine } from "./context-engine.js";
import { HarnessSessionStore, sessionMessageFingerprint } from "./harness-session-store.js";
import { TaskSessionStore } from "./task-session-store.js";
import { estimateTokens } from "./token-estimate.js";

function makeSessionMsgs(n: number): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (let i = 0; i < n; i++) {
    const isUser = i % 2 === 0;
    out.push({
      role: isUser ? "user" : "assistant",
      content: isUser
        ? `用户消息 ${i}：请处理一长串运维任务与日志 ${"x".repeat(200)}`
        : `助手回复 ${i}：已执行检查，结果如下 ${"y".repeat(400)}`,
      createdAt: new Date(Date.now() + i).toISOString(),
    });
  }
  return out;
}

describe("ContextEngine.seedWorkingSet (B1)", () => {
  let root: string;
  let harness: HarnessSessionStore;
  let taskStore: TaskSessionStore;
  const sessionId = "sess-b1-test";

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "maou-b1-"));
    harness = new HarnessSessionStore({ maouRoot: root });
    taskStore = new TaskSessionStore(root, "coding");
  });

  afterEach(() => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  function engine() {
    return new ContextEngine({
      sessionId,
      harnessStore: harness,
      taskStore,
    });
  }

  it("首次无 harness → fromHarness=false，不写 harness", async () => {
    const e = engine();
    const msgs = makeSessionMsgs(6);
    const seed = e.seedWorkingSet(msgs);
    expect(seed.fromHarness).toBe(false);
    expect(seed.useAsLlmHistory).toBe(false);
    expect(seed.appended).toBe(0);
    expect(e.getHistory().length).toBe(6);
    expect(harness.getCurrent(sessionId)).toBeNull();
  });

  it("压缩后落盘 meta；下轮复用 harness 且只 append 增量", async () => {
    const e1 = engine();
    const msgs1 = makeSessionMsgs(20);
    e1.seedWorkingSet(msgs1);
    const beforeTok = estimateTokens(e1.getHistory());
    // force 压缩写入 harness
    const report = await e1.compress(Math.max(512, Math.floor(beforeTok * 0.3)), {
      knownTokens: beforeTok,
      force: true,
      sourceSessionMessages: msgs1,
    });
    expect(report.stage).not.toBe("activeStage");
    const harnessLen = e1.getHistory().length;
    expect(harnessLen).toBeGreaterThan(0);
    expect(harnessLen).toBeLessThanOrEqual(msgs1.length);

    const rec = harness.getCurrentRecord(sessionId);
    expect(rec).not.toBeNull();
    expect(rec!.sourceSessionMessageCount).toBe(msgs1.length);
    expect(rec!.sourceTailFingerprint).toBe(
      sessionMessageFingerprint(msgs1[msgs1.length - 1]),
    );

    // 第二轮：session 多 2 条
    const msgs2 = [
      ...msgs1,
      {
        role: "user",
        content: "新用户增量消息 unique-delta-1",
        createdAt: new Date().toISOString(),
      },
      {
        role: "assistant",
        content: "新助手增量回复 unique-delta-2",
        createdAt: new Date().toISOString(),
      },
    ];
    const e2 = engine();
    const seed2 = e2.seedWorkingSet(msgs2);
    expect(seed2.fromHarness).toBe(true);
    expect(seed2.useAsLlmHistory).toBe(true);
    expect(seed2.appended).toBe(2);
    // 工作集 = 压缩后基座 + 2，仍应远小于全量 session
    expect(e2.getHistory().length).toBe(harnessLen + 2);
    expect(e2.getHistory().length).toBeLessThan(msgs2.length);
    const texts = e2
      .getHistory()
      .map((m) => m.contents.map((c) => c.text).join(""))
      .join("\n");
    expect(texts).toContain("unique-delta-1");
    expect(texts).toContain("unique-delta-2");

    // 第三轮：无新消息 → appended=0，仍 fromHarness
    const e3 = engine();
    const seed3 = e3.seedWorkingSet(msgs2);
    expect(seed3.fromHarness).toBe(true);
    expect(seed3.appended).toBe(0);
    expect(e3.getHistory().length).toBe(e2.getHistory().length);
  });

  it("session 被截断/指纹不匹配 → 回退全量 session", async () => {
    const e1 = engine();
    const msgs1 = makeSessionMsgs(10);
    e1.seedWorkingSet(msgs1);
    await e1.compress(2000, {
      knownTokens: 50_000,
      force: true,
      sourceSessionMessages: msgs1,
    });

    // 模拟 /new 或重写：更短且尾不同
    const rewritten = makeSessionMsgs(3).map((m, i) => ({
      ...m,
      content: `rewritten-${i}`,
    }));
    const e2 = engine();
    const seed = e2.seedWorkingSet(rewritten);
    expect(seed.fromHarness).toBe(false);
    expect(seed.useAsLlmHistory).toBe(false);
    expect(e2.getHistory().length).toBe(3);
  });

  it("无 meta 的旧 harness 文件在 session 已增长时不可复用", async () => {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const oldCtx = [
      {
        seqId: 0,
        taskIds: [],
        contents: [{ text: "old harness only" }],
        keepAfterCompress: false,
        category: "user" as const,
        originalRole: "user" as const,
      },
    ];
    const dir = join(root, "sessions", sessionId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "harness_session.json"),
      JSON.stringify({ sessionId, updatedAt: new Date().toISOString(), context: oldCtx }),
      "utf-8",
    );

    const msgs = makeSessionMsgs(5);
    const e = engine();
    const seed = e.seedWorkingSet(msgs);
    // 无 fingerprint + count=0 → 回退全量 session（安全）
    expect(seed.fromHarness).toBe(false);
    expect(seed.useAsLlmHistory).toBe(false);
    expect(e.getHistory().length).toBe(5);
  });
});
