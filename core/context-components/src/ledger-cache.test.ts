import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdtempSync, renameSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearLedgerCache,
  configureLedgerCache,
  ledgerCacheStats,
  readLedgerFileCached,
  type LedgerRow,
} from "./ledger-cache.js";
import { appendLedgerEvent, flushLedger, readLedgerFileRows, readLedgerRecords } from "./session-ledger.js";

const line = (seq: number, extra = "") =>
  `${JSON.stringify({ seq, type: "user/message", ts: "t", sessionId: "s", surface: "model", data: { content: `m${seq}${extra}` } })}\n`;

const seqs = (rows: readonly LedgerRow[]) => rows.map((r) => r.seq);

describe("ledger parse cache", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "maou-ledger-cache-"));
    file = join(dir, "events.jsonl");
    clearLedgerCache();
    configureLedgerCache({ budgetBytes: 96 * 1024 * 1024, freeze: false });
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    clearLedgerCache();
  });

  it("hits when unchanged and parses only the appended tail", () => {
    writeFileSync(file, line(1) + line(2));
    expect(seqs(readLedgerFileCached(file))).toEqual([1, 2]);
    const first = readLedgerFileCached(file);
    expect(ledgerCacheStats()).toMatchObject({ fullReads: 1, hits: 1, appends: 0 });

    appendFileSync(file, line(3));
    const after = readLedgerFileCached(file);
    expect(seqs(after)).toEqual([1, 2, 3]);
    // 旧事件对象原样复用，没重解析
    expect(after[0]).toBe(first[0]);
    expect(ledgerCacheStats()).toMatchObject({ fullReads: 1, appends: 1 });
  });

  it("leaves a half-written last line for the next read", () => {
    writeFileSync(file, line(1) + line(2).slice(0, 10));
    expect(seqs(readLedgerFileCached(file))).toEqual([1]);
    appendFileSync(file, line(2).slice(10) + line(3));
    expect(seqs(readLedgerFileCached(file))).toEqual([1, 2, 3]);
    expect(ledgerCacheStats().fullReads).toBe(1);
  });

  it("re-reads when the file is replaced (sealing rewrites it)", () => {
    writeFileSync(file, line(1) + line(2) + line(3));
    readLedgerFileCached(file);
    const next = join(dir, "events.next");
    writeFileSync(next, line(3) + line(4));
    renameSync(next, file);
    expect(seqs(readLedgerFileCached(file))).toEqual([3, 4]);
    expect(ledgerCacheStats().fullReads).toBe(2);
  });

  it("re-reads after truncation or an in-place rewrite", () => {
    writeFileSync(file, line(1) + line(2));
    readLedgerFileCached(file);
    truncateSync(file, 0);
    expect(readLedgerFileCached(file)).toEqual([]);

    writeFileSync(file, line(7) + line(8));
    readLedgerFileCached(file);
    // 同 inode 原地改写成更长的内容：头部变了，不能当追加
    writeFileSync(file, line(9, "x".repeat(50)) + line(10) + line(11));
    expect(seqs(readLedgerFileCached(file))).toEqual([9, 10, 11]);
  });

  it("returns [] for a missing file and forgets it", () => {
    expect(readLedgerFileCached(join(dir, "nope.jsonl"))).toEqual([]);
  });

  it("evicts least recently used files beyond the byte budget but keeps the latest", () => {
    const a = join(dir, "a.jsonl");
    const b = join(dir, "b.jsonl");
    writeFileSync(a, line(1));
    writeFileSync(b, line(2));
    configureLedgerCache({ budgetBytes: 1 });
    readLedgerFileCached(a);
    readLedgerFileCached(b);
    readLedgerFileCached(b);
    expect(ledgerCacheStats()).toMatchObject({ fullReads: 2, hits: 1 });
    readLedgerFileCached(a);
    expect(ledgerCacheStats().fullReads).toBe(3);
  });

  it("freeze mode turns in-place mutation into an error", () => {
    configureLedgerCache({ freeze: true });
    writeFileSync(file, line(1));
    const [rec] = readLedgerFileCached(file);
    expect(() => {
      (rec!.data as Record<string, unknown>).content = "changed";
    }).toThrow(TypeError);
  });

  it("keeps legacy rows for raw readers but readLedgerRecords only returns ledger events", () => {
    const sessionDir = join(dir, "sessions");
    const legacyFile = join(sessionDir, "old", "events.jsonl");
    appendLedgerEvent(sessionDir, "old", "user/message", { role: "user", content: "new" });
    flushLedger(sessionDir, "old");
    appendFileSync(legacyFile, `${JSON.stringify({ type: "message", role: "user", content: "legacy" })}\nnot json\n[1,2]\n`);
    expect(readLedgerFileRows(legacyFile).map((r) => (r.data as { content?: string } | undefined)?.content ?? r.content)).toEqual([
      "new",
      "legacy",
    ]);
    expect(readLedgerRecords(sessionDir, "old").map((e) => e.data.content)).toEqual(["new"]);
  });

  it("readLedgerRecords merges pending writes and hands out a fresh array", () => {
    const sessionDir = join(dir, "sessions");
    appendLedgerEvent(sessionDir, "s1", "user/message", { role: "user", content: "a" });
    flushLedger(sessionDir, "s1");
    appendLedgerEvent(sessionDir, "s1", "user/message", { role: "user", content: "b" });
    const withPending = readLedgerRecords(sessionDir, "s1");
    expect(withPending.map((e) => e.data.content)).toEqual(["a", "b"]);
    withPending.push(withPending[0]!);
    flushLedger(sessionDir, "s1");
    expect(readLedgerRecords(sessionDir, "s1").map((e) => e.data.content)).toEqual(["a", "b"]);
  });
});
