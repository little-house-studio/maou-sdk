/**
 * 顶栏今日 token 文案。
 * Run: pnpm exec tsx --test src/client/drafts/layout/today-tokens.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatCompactTokenCount,
  formatTodayTokenLine,
  formatTodayTokenTitle,
  localDayKey,
} from "./today-tokens";

describe("today-tokens format", () => {
  it("shows 0 when empty", () => {
    assert.equal(formatCompactTokenCount(0), "0");
    assert.equal(formatCompactTokenCount(Number.NaN), "0");
    assert.equal(formatTodayTokenLine(0, 0), "今日 0 / 0");
  });

  it("keeps small numbers exact and compact k", () => {
    assert.equal(formatCompactTokenCount(500), "500");
    assert.equal(formatCompactTokenCount(1200), "1.2k");
    assert.equal(formatCompactTokenCount(1000), "1k");
    assert.equal(formatCompactTokenCount(12_300), "12k");
    assert.equal(formatCompactTokenCount(1_200_000), "1.2m");
    assert.equal(formatTodayTokenLine(1200, 500), "今日 1.2k / 500");
  });

  it("title uses exact counts", () => {
    const title = formatTodayTokenTitle(1200, 500);
    assert.match(title, /今日输入/);
    assert.match(title, /1200|1,200/);
    assert.match(title, /输出 500/);
  });

  it("localDayKey is YYYY-MM-DD", () => {
    assert.match(localDayKey(new Date(2026, 7, 29)), /^2026-08-29$/);
  });
});
