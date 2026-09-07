import { mkdirSync, writeFileSync, utimesSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupExpiredFiles,
  writeArchiveLookup,
  writeOriginalRecord,
} from "./original-record.js";

describe("original record", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("writes the uncut text and cleans expired files", () => {
    const dir = mkdtempSync(join(tmpdir(), "maou-orig-"));
    dirs.push(dir);
    const path = writeOriginalRecord(dir, "reader-1", "FULL_BODY");
    expect(path).toBeTruthy();
    expect(existsSync(path!)).toBe(true);

    const spill = join(dir, "spill");
    mkdirSync(spill, { recursive: true });
    const stale = join(spill, "old.txt");
    writeFileSync(stale, "gone");
    const past = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    utimesSync(stale, past, past);
    expect(cleanupExpiredFiles(spill, 7 * 24 * 60 * 60 * 1000)).toBe(1);
    expect(existsSync(stale)).toBe(false);
  });

  it("writes an archive lookup table", () => {
    const dir = mkdtempSync(join(tmpdir(), "maou-arch-"));
    dirs.push(dir);
    const path = writeArchiveLookup(dir, {
      id: "fold-0-3-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      seqRange: { start: 0, end: 3 },
      summary: "checkpoint",
      entries: [{ seq: 0, category: "user", stub: "- [user #0] hi", path: "/tmp/a.txt" }],
    });
    expect(path).toBeTruthy();
    expect(existsSync(path!)).toBe(true);
  });
});
