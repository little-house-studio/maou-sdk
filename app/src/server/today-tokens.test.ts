/**
 * today-tokens：TokenTracker 日桶加总。
 * Run: pnpm exec tsx --test src/server/today-tokens.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TokenTracker } from "@little-house-studio/agent";
import {
  collectTodayTokenTotals,
  tokenDayKey,
} from "./today-tokens.js";

const root = join(tmpdir(), `maou-today-tokens-${process.pid}`);

before(() => {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("collectTodayTokenTotals", () => {
  it("returns zeros when no agent token files exist", () => {
    const t = collectTodayTokenTotals(root);
    assert.equal(t.date, tokenDayKey());
    assert.equal(t.inputTokens, 0);
    assert.equal(t.outputTokens, 0);
  });

  it("sums today's TokenTracker daily_summary across agents", () => {
    const coding = new TokenTracker(root, "coding");
    coding.record(
      { prompt_tokens: 1200, completion_tokens: 80 },
      "m1",
    );
    const ops = new TokenTracker(root, "ops");
    ops.record({ prompt_tokens: 100, completion_tokens: 20 }, "m2");
    const t = collectTodayTokenTotals(root);
    assert.equal(t.date, tokenDayKey());
    assert.equal(t.inputTokens, 1300);
    assert.equal(t.outputTokens, 100);
  });

  it("ignores other day keys", () => {
    const other = "1999-01-01";
    const dir = join(root, "agents", "coding", "tokens");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${other}.json`),
      JSON.stringify({
        records: [],
        daily_summary: {
          date: other,
          total_input_tokens: 99999,
          total_output_tokens: 88888,
          total_cache_hit_tokens: 0,
          cache_hit_rate: 0,
          total_cost: 0,
          record_count: 1,
        },
      }),
      "utf8",
    );
    const t = collectTodayTokenTotals(root, tokenDayKey());
    assert.ok(t.inputTokens < 99999);
    const old = collectTodayTokenTotals(root, other);
    assert.equal(old.date, other);
    assert.equal(old.inputTokens, 99999);
    assert.equal(old.outputTokens, 88888);
  });
});
