import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  backfillUserLoopDuration,
  historyToLines,
  inferToolDurationsFromStartGaps,
  mergeOlderChatLines,
  oldestSeqFromLines,
  resolveOldestSeq,
  stampLoopWallClock,
  type ChatLine,
} from "./ChatPanel";

function tool(
  id: string,
  startedAt: number,
  durationMs?: number,
): ChatLine {
  return {
    id,
    role: "tool",
    text: id,
    startedAt,
    ...(durationMs != null ? { durationMs } : {}),
  };
}

describe("inferToolDurationsFromStartGaps", () => {
  it("assigns the start-to-start gap to the earlier tool", () => {
    const a = tool("a", 1_000);
    const b = tool("b", 1_400);
    const c = tool("c", 2_000);
    inferToolDurationsFromStartGaps([a, b, c]);
    assert.equal(a.durationMs, 400);
    assert.equal(b.durationMs, 600);
    assert.equal(c.durationMs, undefined);
  });

  it("does not overwrite an existing duration", () => {
    const a = tool("a", 1_000, 50);
    const b = tool("b", 1_400);
    inferToolDurationsFromStartGaps([a, b]);
    assert.equal(a.durationMs, 50);
    assert.equal(b.durationMs, undefined);
  });

  it("does not infer across a user or assistant turn", () => {
    const a = tool("a", 1_000);
    const user: ChatLine = { id: "u", role: "user", text: "next" };
    const b = tool("b", 1_400);
    inferToolDurationsFromStartGaps([a, user, b]);
    assert.equal(a.durationMs, undefined);
    assert.equal(b.durationMs, undefined);
  });

  it("ignores gaps that are too small or too large", () => {
    const shortA = tool("sa", 1_000);
    const shortB = tool("sb", 1_050);
    inferToolDurationsFromStartGaps([shortA, shortB]);
    assert.equal(shortA.durationMs, undefined);

    const longA = tool("la", 1_000);
    const longB = tool("lb", 1_000 + 30 * 60 * 1000);
    inferToolDurationsFromStartGaps([longA, longB]);
    assert.equal(longA.durationMs, undefined);
  });
});

describe("historyToLines / stampLoopWallClock", () => {
  it("maps assistant duration and user send time from history", () => {
    const lines = historyToLines([
      {
        id: "u",
        role: "user",
        content: "咕咕嘎嘎",
        ts: "2026-08-29T08:00:00.000Z",
      },
      {
        id: "a",
        role: "assistant",
        content: "hi",
        ts: "2026-08-29T08:00:02.500Z",
        durationMs: 1800,
      },
    ]);
    assert.equal(lines[0]!.startedAt, Date.parse("2026-08-29T08:00:00.000Z"));
    assert.equal(lines[1]!.durationMs, 1800);
    assert.equal(lines[1]!.startedAt, Date.parse("2026-08-29T08:00:02.500Z"));
  });

  it("keeps toolArgs so the card can title from path", () => {
    const lines = historyToLines([
      {
        id: "t",
        role: "tool",
        content: "✓ read_file\n#",
        toolName: "read_file",
        toolArgs: JSON.stringify({ path: "/tmp/secrets.json" }),
      },
    ]);
    assert.equal(lines[0]!.toolArgs, JSON.stringify({ path: "/tmp/secrets.json" }));
  });

  it("restores cache buckets from history so a finished ask can show a rate", () => {
    const lines = historyToLines([
      { id: "u", role: "user", content: "go" },
      {
        id: "a",
        role: "assistant",
        content: "done",
        usageInput: 1000,
        usageOutput: 40,
        cacheRead: 250,
        cacheReported: true,
      },
    ]);
    assert.equal(lines[1]!.cacheRead, 250);
    assert.equal(lines[1]!.cacheReported, true);
    assert.equal(lines[1]!.usageInput, 1000);
  });

  it("maps terminal-notification user rows to tool, not a user card", () => {
    const lines = historyToLines([
      { id: "u", role: "user", source: "human", content: "后台编译 Rust" },
      {
        id: "n",
        role: "user",
        source: "terminal-notification",
        authorType: "tool",
        kind: "tool_async_notify",
        toolName: "use_terminal",
        content:
          "<terminal-message>\n终端「后台编译 Rust terminal-engine」已完成。\n</terminal-message>",
      },
      {
        id: "fake",
        role: "user",
        source: "human",
        content:
          "<terminal-message>\n这是用户粘贴的协议正文\n</terminal-message>",
      },
      {
        id: "legacy",
        role: "user",
        content:
          "<terminal-message>\n旧盘终端完成通知\n</terminal-message>",
      },
    ]);
    assert.equal(lines[0]!.role, "user");
    assert.equal(lines[1]!.role, "tool");
    assert.equal(lines[1]!.toolName, "use_terminal");
    assert.equal(lines[1]!.text.includes("<terminal-message>"), false);
    assert.match(lines[1]!.text, /已完成/);
    assert.equal(lines[2]!.role, "user");
    assert.match(lines[2]!.text, /用户粘贴/);
    assert.equal(lines[3]!.role, "tool");
    assert.match(lines[3]!.text, /旧盘终端完成通知/);
  });

  it("drops tool-loop control lines from restored history", () => {
    const lines = historyToLines([
      { id: "u", role: "user", content: "go" },
      {
        id: "hint",
        role: "user",
        source: "tool_loop",
        content:
          "<continue>系统检测到工具调用可能陷入死循环（重复模式近似：project_manage）。请换策略。</continue>",
      },
      { id: "a", role: "assistant", content: "ok" },
    ]);
    assert.equal(lines.length, 2);
    assert.equal(lines.some((l) => /请换策略/.test(l.text)), false);
  });

  it("backfills user duration from ledger loopDurationMs", () => {
    const lines = historyToLines([
      {
        id: "u",
        role: "user",
        content: "go",
        ts: "2026-08-29T08:00:00.000Z",
      },
      {
        id: "a",
        role: "assistant",
        content: "ok",
        ts: "2026-08-29T08:00:01.200Z",
        loopDurationMs: 1200,
      },
    ]);
    assert.equal(lines[0]!.durationMs, 1200);
  });

  it("stampLoopWallClock writes send→now onto the user row", () => {
    const user: ChatLine = {
      id: "u",
      role: "user",
      text: "go",
      startedAt: 1000,
    };
    const asst: ChatLine = {
      id: "a",
      role: "assistant",
      text: "partial",
      startedAt: 1300,
    };
    const out = stampLoopWallClock([user, asst], 1800);
    assert.equal(out[0]!.durationMs, 800);
    assert.equal(out[1]!.durationMs, 500);
  });

  it("stampLoopWallClock does not overwrite an existing assistant duration", () => {
    const user: ChatLine = {
      id: "u",
      role: "user",
      text: "go",
      startedAt: 1000,
    };
    const asst: ChatLine = {
      id: "a",
      role: "assistant",
      text: "ok",
      startedAt: 1100,
      durationMs: 200,
    };
    const out = stampLoopWallClock([user, asst], 2000);
    assert.equal(out[0]!.durationMs, 1000);
    assert.equal(out[1]!.durationMs, 200);
  });

  it("stampLoopWallClock skips terminal-notification rows", () => {
    const user: ChatLine = {
      id: "u",
      role: "user",
      text: "go",
      startedAt: 1000,
      source: "human",
    };
    const notify: ChatLine = {
      id: "n",
      role: "user",
      text: "已完成",
      source: "terminal-notification",
      authorType: "tool",
    };
    const out = stampLoopWallClock([user, notify], 2500);
    assert.equal(out[0]!.durationMs, 1500);
    assert.equal(out[1]!.durationMs, undefined);
  });

  it("backfillUserLoopDuration keeps an existing user duration", () => {
    const user: ChatLine = {
      id: "u",
      role: "user",
      text: "go",
      durationMs: 50,
    };
    const asst: ChatLine = {
      id: "a",
      role: "assistant",
      text: "ok",
      loopDurationMs: 900,
    };
    backfillUserLoopDuration([user, asst]);
    assert.equal(user.durationMs, 50);
  });

  it("keeps seq so older pages can prepend", () => {
    const lines = historyToLines([
      { id: "a", role: "assistant", content: "old", seq: 11 },
      { id: "b", role: "user", content: "new", seq: 12 },
    ]);
    assert.equal(oldestSeqFromLines(lines), 11);
    const merged = mergeOlderChatLines(lines, [
      { id: "z", role: "user", text: "earlier", seq: 10 },
      { id: "a", role: "assistant", text: "dup", seq: 11 },
    ]);
    assert.equal(merged.map((l) => l.id).join(","), "z,a,b");
  });

  it("resolveOldestSeq falls back to page lines when server omits the cursor", () => {
    const older = historyToLines([
      { id: "z", role: "user", content: "earlier", seq: 10 },
      { id: "a", role: "assistant", content: "old", seq: 11 },
    ]);
    assert.equal(resolveOldestSeq(null, older), 10);
    assert.equal(resolveOldestSeq(8, older), 8);
    assert.equal(resolveOldestSeq(null, []), null);
  });
});
