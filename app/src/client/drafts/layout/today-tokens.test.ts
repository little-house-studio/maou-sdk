/**
 * 顶栏今日 token 文案。
 * Run: pnpm exec tsx --test src/client/drafts/layout/today-tokens.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatCompactTokenCount,
  formatTodayInArrow,
  formatTodayOutArrow,
  formatTodayTokenTitle,
  localDayKey,
} from "./today-tokens";

describe("today-tokens format", () => {
  it("shows 0 when empty", () => {
    assert.equal(formatCompactTokenCount(0), "0");
    assert.equal(formatCompactTokenCount(Number.NaN), "0");
    assert.equal(formatTodayInArrow(0), "↑ 0");
    assert.equal(formatTodayOutArrow(0), "↓ 0");
  });

  it("keeps small numbers exact and compact K/M/B", () => {
    assert.equal(formatCompactTokenCount(500), "500");
    assert.equal(formatCompactTokenCount(1200), "1.2K");
    assert.equal(formatCompactTokenCount(1000), "1K");
    assert.equal(formatCompactTokenCount(12_300), "12K");
    assert.equal(formatCompactTokenCount(1_200_000), "1.2M");
    assert.equal(formatCompactTokenCount(12_300_000), "12M");
    assert.equal(formatCompactTokenCount(1_200_000_000), "1.2B");
    assert.equal(formatCompactTokenCount(12_000_000_000), "12B");
    assert.equal(formatTodayInArrow(1200), "↑ 1.2K");
    assert.equal(formatTodayOutArrow(500), "↓ 500");
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
