import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AutoCompressSession } from "../auto-compress.js";
import { ContextEngine } from "../context-engine.js";
import { HarnessSessionStore } from "../harness-session-store.js";
import type { MaouMessage } from "../types/message.js";
import {
  registerContextModule,
  resetContextModulesForTest,
  type ContextModule,
} from "./index.js";
import { DEFAULT_LEGACY_CONFIG } from "./legacy.js";
import { DEFAULT_STAGED_CONFIG } from "./staged.js";

function sessionMsgs(n: number, latest = "LATEST_KEEP"): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (let i = 0; i < n; i++) {
    out.push({
      role: "user",
      content: `用户 ${i} ${"问".repeat(60)}`,
      createdAt: new Date(Date.now() + i * 3).toISOString(),
    });
    out.push({
      role: "assistant",
      content: `助手 ${i}`,
      createdAt: new Date(Date.now() + i * 3 + 1).toISOString(),
      toolCalls: [
        {
          id: `c${i}`,
          type: "function",
          name: "use_terminal",
          arguments: { command: `echo ${i}` },
        },
      ],
    });
    out.push({
      role: "tool",
      toolCallId: `c${i}`,
      content: `<terminal-message>\n${"dump\n".repeat(80)}`,
      createdAt: new Date(Date.now() + i * 3 + 2).toISOString(),
    });
  }
  out.push({
    role: "user",
    content: latest,
    createdAt: new Date().toISOString(),
  });
  return out;
}

function maou(category: MaouMessage["category"], text: string, i: number): MaouMessage {
  return {
    seqId: i,
    taskIds: [],
    category,
    contents: [{ text }],
    keepAfterCompress: false,
    createdAt: new Date(Date.now() + i).toISOString(),
  };
}

describe("ContextEngine × 模块", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "maou-eng-mod-"));
  });
  afterEach(() => {
    resetContextModulesForTest();
    rmSync(root, { recursive: true, force: true });
  });

  it("force 空压：短会话不落 harness / 压缩区", async () => {
    const sessionId = "noop";
    const harness = new HarnessSessionStore({ maouRoot: root });
    const session = [
      { role: "user", content: "hi", createdAt: new Date().toISOString() },
      { role: "assistant", content: "ok", createdAt: new Date().toISOString() },
    ];
    const engine = new ContextEngine({ sessionId, harnessStore: harness });
    engine.seedWorkingSet(session);
    const report = await engine.compress(500_000, {
      force: true,
      sourceSessionMessages: session,
    });
    expect(report.stage).toBe("activeStage");
    expect(harness.getCurrent(sessionId)).toBeNull();
    expect(harness.getCompressedZone(sessionId)).toBeNull();
  });

  it("默认 staged：强制压缩变矮并保留最新 user", async () => {
    const sessionId = "def";
    const harness = new HarnessSessionStore({ maouRoot: root });
    const session = sessionMsgs(18);
    const engine = new ContextEngine({ sessionId, harnessStore: harness });
    engine.seedWorkingSet(session);
    const beforeLen = engine.getHistory().length;
    const beforeChars = engine
      .getHistory()
      .map((m) => m.contents.map((c) => c.text).join(""))
      .join("").length;
    const report = await engine.compress(1500, {
      knownTokens: 20_000,
      force: true,
      sourceSessionMessages: session,
    });
    expect(report.stage).not.toBe("activeStage");
    const afterChars = engine
      .getHistory()
      .map((m) => m.contents.map((c) => c.text).join(""))
      .join("").length;
    expect(engine.getHistory().length).toBeLessThanOrEqual(beforeLen);
    expect(afterChars).toBeLessThan(beforeChars);
    const text = engine
      .getHistory()
      .map((m) => m.contents.map((c) => c.text).join(""))
      .join("\n");
    expect(text).toContain("LATEST_KEEP");
    expect(harness.getCurrent(sessionId)?.length).toBeGreaterThan(0);
  });

  it("自动压不过 force：尾巴按条数 16% 留原文", async () => {
    const sessionId = "auto-tail";
    const harness = new HarnessSessionStore({ maouRoot: root });
    const session = sessionMsgs(18);
    const engine = new ContextEngine({ sessionId, harnessStore: harness });
    engine.seedWorkingSet(session);
    const before = engine.getHistory().length;
    const report = await engine.compress(10_000, {
      knownTokens: 8_000,
      sourceSessionMessages: session,
    });
    expect(report.stage).not.toBe("activeStage");
    const after = engine.getHistory();
    const tail = after.filter((m) => m.compact?.type !== "fold" && m.compact?.type !== "archive");
    expect(tail.length).toBeGreaterThanOrEqual(Math.floor(before * 0.16));
    expect(after.map((m) => m.contents.map((c) => c.text).join("")).join("\n")).toContain("LATEST_KEEP");
  });

  it("module=legacy：只留最近轮，最新 user 还在", async () => {
    const sessionId = "leg";
    const harness = new HarnessSessionStore({ maouRoot: root });
    const session = sessionMsgs(10, "LEGACY_LATEST");
    const engine = new ContextEngine({
      sessionId,
      harnessStore: harness,
      module: "legacy",
      moduleConfig: { ...DEFAULT_LEGACY_CONFIG, triggerPercent: 1, keepRecentRounds: 2 },
    });
    engine.seedWorkingSet(session);
    const before = engine.getHistory().length;
    const report = await engine.compress(500, { force: true, sourceSessionMessages: session });
    expect(report.stage).toBe("summaryStage");
    const hist = engine.getHistory();
    expect(hist.length).toBeLessThan(before);
    expect(hist[0]?.category).toBe("compact");
    expect(hist.filter((m) => m.category === "user").length).toBeLessThanOrEqual(3);
    const text = hist.map((m) => m.contents.map((c) => c.text).join("")).join("\n");
    expect(text).toContain("LEGACY_LATEST");
  });

  it("传入自定义模块对象，宿主不走内置压法", async () => {
    let calls = 0;
    const mine: ContextModule = {
      id: "mine",
      shouldCompress: () => true,
      compress: async ({ history }) => {
        calls += 1;
        return {
          compressed: true,
          stage: "compactStage",
          history: history.slice(-2),
          droppedSummary: "custom-mod",
          originalTokens: 99,
          compressedTokens: 2,
          blockIds: [],
        };
      },
    };
    const sessionId = "mine";
    const harness = new HarnessSessionStore({ maouRoot: root });
    const session = sessionMsgs(6);
    const engine = new ContextEngine({
      sessionId,
      harnessStore: harness,
      module: mine,
    });
    engine.seedWorkingSet(session);
    const report = await engine.compress(1000, { force: true, sourceSessionMessages: session });
    expect(calls).toBe(1);
    expect(report.droppedSummary).toBe("custom-mod");
    expect(engine.getHistory().length).toBe(2);
  });
});

describe("AutoCompressSession × 模块", () => {
  afterEach(() => {
    resetContextModulesForTest();
  });

  it("legacy 模式通过 session 宿主压一轮", async () => {
    const session = new AutoCompressSession({
      mode: "legacy",
      maxTokens: 200,
      enabled: true,
      knownTokens: 200,
      legacy: { ...DEFAULT_LEGACY_CONFIG, triggerPercent: 1, keepRecentRounds: 1 },
    });
    for (let i = 0; i < 6; i++) {
      session.addMessage(maou("user", `u${i} ${"x".repeat(300)}`, i * 2));
      session.addMessage(maou("assistant", `a${i} ${"y".repeat(300)}`, i * 2 + 1));
    }
    await session.getMessages();
    const r = session.getLastCompressResult();
    expect(r?.mode).toBe("legacy");
    expect(r?.compressed).toBe(true);
    expect(session.getHistoryLength()).toBeLessThan(12);
  });

  it("staged 未过阈值不压", async () => {
    const session = new AutoCompressSession({
      mode: "staged",
      maxTokens: 1_000_000,
      enabled: true,
      staged: DEFAULT_STAGED_CONFIG,
    });
    session.addMessage(maou("user", "hi", 0));
    await session.getMessages();
    expect(session.getLastCompressResult()).toBeNull();
    expect(session.getHistoryLength()).toBe(1);
  });

  it("enabled=false 不压", async () => {
    const session = new AutoCompressSession({
      mode: "legacy",
      maxTokens: 10,
      enabled: false,
      legacy: { ...DEFAULT_LEGACY_CONFIG, triggerPercent: 1, keepRecentRounds: 1 },
    });
    session.addMessage(maou("user", "x".repeat(2000), 0));
    await session.getMessages();
    expect(session.getLastCompressResult()).toBeNull();
  });

  it("覆盖 staged 后 ContextEngine 走新实现", async () => {
    let hit = 0;
    registerContextModule({
      id: "staged",
      defaultConfig: {},
      shouldCompress: () => true,
      compress: async ({ history }) => {
        hit += 1;
        return {
          compressed: true,
          stage: "summaryStage",
          history,
          droppedSummary: "patched",
          originalTokens: 8,
          compressedTokens: 7,
          blockIds: [],
        };
      },
    });
    const root = mkdtempSync(join(tmpdir(), "maou-patch-"));
    try {
      const harness = new HarnessSessionStore({ maouRoot: root });
      const engine = new ContextEngine({
        sessionId: "p",
        harnessStore: harness,
        module: "staged",
      });
      engine.seedWorkingSet(sessionMsgs(3));
      const report = await engine.compress(100, { force: true });
      expect(hit).toBe(1);
      expect(report.droppedSummary).toBe("patched");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
