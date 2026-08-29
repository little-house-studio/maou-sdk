/**
 * session-stats unit tests (shipped helper).
 * Run: pnpm exec tsx --test src/server/session-stats.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  collectSessionStats,
  formatSessionStats,
  formatSessionAnalyze,
} from "./session-stats.js";

const root = join(tmpdir(), `maou-sess-stats-${process.pid}`);
const sid = "test-session-1";

before(() => {
  const dir = join(root, ".maou", "sessions", sid);
  mkdirSync(dir, { recursive: true });
  const lines = [
    JSON.stringify({
      type: "message",
      role: "user",
      content: "hi",
    }),
    JSON.stringify({
      type: "message",
      role: "assistant",
      content: "hello",
      usage: { prompt_tokens: 100, completion_tokens: 20, cache_read: 40 },
    }),
    JSON.stringify({ type: "tool_call", name: "reader" }),
  ];
  writeFileSync(join(dir, "events.jsonl"), lines.join("\n") + "\n", "utf8");
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("session-stats", () => {
  it("collects turns and tokens from jsonl", () => {
    const s = collectSessionStats(root, sid);
    assert.equal(s.userTurns, 1);
    assert.equal(s.assistantTurns, 1);
    assert.ok(s.toolCalls >= 1);
    assert.equal(s.inputTokens, 100);
    assert.equal(s.outputTokens, 20);
    assert.equal(s.cacheRead, 40);
    assert.equal(s.lastInputTokens, 100);
    assert.equal(s.lastOutputTokens, 20);
    assert.equal(s.lastCacheRead, 40);
    assert.equal(s.contextUsed, 120);
    assert.ok(s.contextBreakdown.messages > 0);
    assert.equal(s.contextBreakdown.used, 120);
    assert.equal(s.contextBreakdown.cacheHitPct, 40);
  });

  it("clears occupancy after a later compress event", () => {
    const sid2 = "test-session-compact";
    const dir = join(root, ".maou", "sessions", sid2);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "events.jsonl"),
      [
        JSON.stringify({
          type: "message",
          role: "assistant",
          usage: { prompt_tokens: 100, completion_tokens: 20 },
        }),
        JSON.stringify({ type: "compact", content: "上下文已压缩" }),
      ].join("\n") + "\n",
      "utf8",
    );
    const s = collectSessionStats(root, sid2);
    assert.equal(s.inputTokens, 100);
    assert.equal(s.outputTokens, 20);
    assert.equal(s.contextUsed, 0);
    assert.equal(s.lastInputTokens, 0);
    assert.equal(s.lastOutputTokens, 0);
    assert.equal(s.contextBreakdown.used, 0);
    assert.equal(s.contextBreakdown.messages, 0);
    assert.equal(s.lifetime.inputTokens, 100);
    assert.equal(s.lifetime.outputTokens, 20);
  });

  it("formats readable text", () => {
    const s = collectSessionStats(root, sid);
    const t = formatSessionStats(s);
    assert.ok(t.includes("Session"));
    assert.ok(t.includes("100"));
    const a = formatSessionAnalyze(s);
    assert.ok(a.includes("Heuristics"));
  });
});
