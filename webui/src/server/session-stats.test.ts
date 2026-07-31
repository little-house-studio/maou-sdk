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
  const dir = join(root, ".maou", "sessions");
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
  writeFileSync(join(dir, `${sid}.jsonl`), lines.join("\n") + "\n", "utf8");
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
