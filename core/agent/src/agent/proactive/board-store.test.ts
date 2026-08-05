/**
 * Run: pnpm exec tsx --test src/server/proactive/board-store.test.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, after } from "node:test";
import {
  readBoard,
  readSettings,
  writeBoard,
  writeSettings,
} from "./board-store.js";
import {
  mergeSuggestions,
  serializeProactiveBoard,
} from "./board-format.js";

describe("proactive board-store", () => {
  const dir = mkdtempSync(join(tmpdir(), "maou-proactive-"));
  after(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("creates empty board and settings on first read", () => {
    const board = readBoard(dir);
    assert.equal(board.zones.length, 4);
    assert.equal(board.items.length, 0);
    const s = readSettings(dir);
    assert.equal(s.enabled, false);
    assert.equal(s.frequency, "off");
  });

  it("persists merged suggestions and settings", () => {
    let board = readBoard(dir);
    board = mergeSuggestions(board, [
      {
        zone: "安全无风险修复与优化",
        title: "补 lint",
        risk: "低",
        comment: "eslint",
      },
    ]);
    board = writeBoard(dir, board);
    const again = readBoard(dir);
    assert.equal(again.items.length, 1);
    assert.equal(again.items[0]!.title, "补 lint");
    assert.match(serializeProactiveBoard(again), /补 lint/);

    const s = writeSettings(dir, {
      ...readSettings(dir),
      enabled: true,
      frequency: "interval",
      intervalMinutes: 15,
    });
    assert.equal(s.enabled, true);
    assert.equal(readSettings(dir).intervalMinutes, 15);
  });
});
