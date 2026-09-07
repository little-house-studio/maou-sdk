import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContextEngine } from "./context-engine.js";
import { HarnessSessionStore } from "./harness-session-store.js";

describe("ContextEngine round micro-compact clock", () => {
  let root: string;
  let harness: HarnessSessionStore;
  const sessionId = "sess-micro";

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "maou-micro-"));
    harness = new HarnessSessionStore({ maouRoot: root });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function engine(microRounds?: number) {
    return new ContextEngine({ sessionId, harnessStore: harness, microRounds });
  }

  it("reader result born on turn 1 shrinks after turn 4", async () => {
    const body = "阅读内容".repeat(300);
    const e = engine();
    e.seedWorkingSet([{ role: "user", content: "读一下", createdAt: "t" }]);
    e.beginAgentMicroTurn();
    expect(e.getMicroTurn()).toBe(1);
    e.sync([
      {
        seqId: 0,
        taskIds: [],
        contents: [{ text: body }],
        keepAfterCompress: false,
        category: "tool_result",
        toolName: "reader",
      },
    ]);
    expect(e.applyRoundMicroCompact()).toBe(false);

    e.beginAgentMicroTurn();
    expect(e.applyRoundMicroCompact()).toBe(false);
    e.noteUserMicroTurn();
    expect(e.applyRoundMicroCompact()).toBe(false);
    e.beginAgentMicroTurn();
    expect(e.getMicroTurn()).toBe(4);
    expect(e.applyRoundMicroCompact()).toBe(true);
    const reader = e.getHistory().find((m) => m.category === "tool_result");
    const summary = reader?.contents[0]?.microCompact?.summary;
    expect(summary && summary.length < body.length).toBe(true);
    expect(reader?.microFrozen).toBe(true);

    const frozenText = reader?.contents[0]?.microCompact?.summary;
    expect(frozenText).toMatch(/省略 \d+ 字/);
    expect(frozenText).not.toContain("再次阅读");
    e.beginAgentMicroTurn();
    const hinted = e.toLLMHistory();
    expect(e.unlockPrefixIfDue()).toContain("再次阅读");
    expect(hinted[hinted.length - 1]?.content).toContain("再次阅读");
    expect(e.getHistory().find((m) => m.category === "tool_result")?.contents[0]?.microCompact?.summary).toBe(
      frozenText,
    );
    e.beginAgentMicroTurn();
    expect(e.unlockPrefixIfDue()).toBe("");
    e.sync([
      {
        seqId: 0,
        taskIds: [],
        contents: [{ text: "动态层新消息" }],
        keepAfterCompress: false,
        category: "user",
      },
    ]);
    await e.compress(1000, { knownTokens: 750, force: true });
    const after = e.getHistory().find((m) => m.category === "tool_result");
    expect(after?.contents[0]?.microCompact?.summary).toBe(frozenText);
    expect(after?.microFrozen).toBe(true);
  });

  it("honors agent-level microRounds for all compact features", async () => {
    const body = "阅读内容".repeat(300);
    const e = engine(5);
    expect(e.getMicroRounds()).toBe(5);
    e.seedWorkingSet([{ role: "user", content: "读一下", createdAt: "t" }]);
    e.beginAgentMicroTurn();
    e.sync([
      {
        seqId: 0,
        taskIds: [],
        contents: [{ text: body }],
        keepAfterCompress: false,
        category: "tool_result",
        toolName: "reader",
      },
    ]);
    e.beginAgentMicroTurn();
    e.noteUserMicroTurn();
    e.beginAgentMicroTurn();
    expect(e.getMicroTurn()).toBe(4);
    expect(e.applyRoundMicroCompact()).toBe(false);
    e.beginAgentMicroTurn();
    e.beginAgentMicroTurn();
    expect(e.getMicroTurn()).toBe(6);
    expect(e.applyRoundMicroCompact()).toBe(true);
  });
});
