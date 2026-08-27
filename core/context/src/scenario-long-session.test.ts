/**
 * 真实形态场景：长会话工具 dump 堆积 → 强制压缩 → 工作集应显著变矮且保留最新 user 原文。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContextEngine } from "./context-engine.js";
import { HarnessSessionStore } from "./harness-session-store.js";
import { TaskSessionStore } from "./task-session-store.js";

function makeLongSession(): Array<Record<string, unknown>> {
  const msgs: Array<Record<string, unknown>> = [];
  for (let i = 0; i < 30; i++) {
    msgs.push({
      role: "user",
      content: `用户请求 ${i}：分析系统状态 ${"问".repeat(80)}`,
      createdAt: new Date(Date.now() + i * 1000).toISOString(),
    });
    msgs.push({
      role: "assistant",
      content: `分析中 ${i}`,
      createdAt: new Date(Date.now() + i * 1000 + 1).toISOString(),
      toolCalls: [
        {
          id: `call_${i}`,
          type: "function",
          name: "use_terminal",
          arguments: { command: `echo ${i}`, description: `dump ${i}` },
        },
      ],
    });
    // 大工具结果（模拟飞书 jsonl / MCP catalog）
    msgs.push({
      role: "tool",
      toolCallId: `call_${i}`,
      content:
        i % 5 === 0
          ? `# MCP catalog dump\n` + "tool entry\n".repeat(800)
          : `<terminal-message>\n` + `line ${i} data\n`.repeat(200),
      createdAt: new Date(Date.now() + i * 1000 + 2).toISOString(),
    });
  }
  msgs.push({
    role: "user",
    content: "LATEST_USER_QUESTION_KEEP_ME 为什么 checkpoints 这么大？",
    createdAt: new Date().toISOString(),
  });
  return msgs;
}

describe("scenario: long session force compress", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "maou-scenario-"));
  });
  afterEach(() => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("shrinks working set a lot but keeps latest user text + reuses harness next seed", async () => {
    const sessionId = "long-1";
    const harness = new HarnessSessionStore({ maouRoot: root });
    const taskStore = new TaskSessionStore(root, "ops");
    const session = makeLongSession();

    const e1 = new ContextEngine({ sessionId, harnessStore: harness, taskStore });
    e1.seedWorkingSet(session);
    const beforeLen = e1.getHistory().length;
    const beforeChars = e1
      .getHistory()
      .map((m) => m.contents.map((c) => c.text).join("\n"))
      .join("\n").length;
    expect(beforeChars).toBeGreaterThan(5000);

    const report = await e1.compress(2000, {
      knownTokens: 40_000,
      force: true,
      sourceSessionMessages: session,
    });
    expect(report.stage).not.toBe("activeStage");
    const afterChars = e1
      .getHistory()
      .map((m) => m.contents.map((c) => c.text).join("\n"))
      .join("\n").length;
    expect(e1.getHistory().length).toBeLessThanOrEqual(beforeLen);
    expect(afterChars).toBeLessThan(beforeChars * 0.75);

    const histText = e1
      .getHistory()
      .map((m) => m.contents.map((c) => c.text).join("\n"))
      .join("\n");
    expect(histText).toContain("LATEST_USER_QUESTION_KEEP_ME");

    // 下轮 seed 复用 harness
    const session2 = [
      ...session,
      {
        role: "assistant",
        content: "继续",
        createdAt: new Date().toISOString(),
      },
      {
        role: "user",
        content: "DELTA_NEW_TURN",
        createdAt: new Date().toISOString(),
      },
    ];
    const e2 = new ContextEngine({ sessionId, harnessStore: harness, taskStore });
    const seed = e2.seedWorkingSet(session2);
    expect(seed.fromHarness).toBe(true);
    expect(seed.appended).toBeGreaterThanOrEqual(1);
    const t2 = e2
      .getHistory()
      .map((m) => m.contents.map((c) => c.text).join("\n"))
      .join("\n");
    expect(t2).toContain("DELTA_NEW_TURN");
    expect(t2).toContain("LATEST_USER_QUESTION_KEEP_ME");
  });
});
