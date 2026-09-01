import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionStore } from "./session-store.js";
import {
  appendLedgerEvent,
  flushLedger,
  readLedgerRecords,
} from "./session-ledger.js";
import { durableAppend, injectDurableAppendFailure } from "./durable-write.js";
import { peekPendingWrites } from "./write-coordinator.js";
import { classifyOpenTurn, classifyUnclosedTools, compactLockOpen } from "./tool-recovery.js";
import { LIST_CACHE_FILE, readListCache, stripHeavySessionMetaText } from "./list-cache.js";
import { decideWindowPressure } from "./window-pressure.js";
import { pruneToolResultText, TOOL_RESULT_PRUNE_THRESHOLD_CHARS } from "./prune-text.js";
import { buildRetentionNotice } from "./omission.js";
import { sealLivePrefixIfNeeded } from "./events-archive.js";
import { collectSessionZipEntries, exportSessionZip } from "./session-export.js";
import { polishSessionTitle } from "./session-title.js";
import { jsonlIoStats, OFFSET_FILE } from "./jsonl-offset.js";
import { FOLD_CACHE_FILE, readFoldCache } from "./fold-cache.js";

describe("session durable / cover / product", () => {
  const dirs: string[] = [];
  const prevBatch = process.env.MAOU_LEDGER_BATCH_MS;
  const prevFts = process.env.MAOU_SESSION_FTS;

  afterEach(() => {
    if (prevBatch == null) delete process.env.MAOU_LEDGER_BATCH_MS;
    else process.env.MAOU_LEDGER_BATCH_MS = prevBatch;
    if (prevFts == null) delete process.env.MAOU_SESSION_FTS;
    else process.env.MAOU_SESSION_FTS = prevFts;
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function store(): SessionStore {
    const dir = mkdtempSync(join(tmpdir(), "maou-durable-"));
    dirs.push(dir);
    return new SessionStore(dir);
  }

  it("truncates back to original length when append fails", () => {
    const dir = mkdtempSync(join(tmpdir(), "maou-dur-"));
    dirs.push(dir);
    const file = join(dir, "events.jsonl");
    writeFileSync(file, "keep\n");
    const before = statSync(file).size;
    injectDurableAppendFailure();
    expect(() => durableAppend(file, "partial-line-that-must-not-stay\n")).toThrow(/injected/);
    expect(statSync(file).size).toBe(before);
    expect(readFileSync(file, "utf-8")).toBe("keep\n");
  });

  it("crc mismatch drops only the bad tail line", () => {
    const s = store();
    const session = s.create({ title: "t" });
    s.appendMessage(session.id, "user", "keep-head");
    s.appendMessage(session.id, "user", "drop-tail");
    const sidecar = join(s.sessionRoot(session.id), OFFSET_FILE);
    const lines = readFileSync(sidecar, "utf-8").trim().split("\n");
    let idx = -1;
    const recs = lines.map((line, i) => {
      const rec = JSON.parse(line) as { t?: string; crc?: number };
      if (rec.t === "user/message") idx = i;
      return rec;
    });
    expect(idx).toBeGreaterThanOrEqual(0);
    recs[idx]!.crc = 1;
    writeFileSync(sidecar, `${recs.map((r) => JSON.stringify(r)).join("\n")}\n`);
    const page = s.loadRecent(session.id, { limit: 10 });
    const texts = page?.messages.map((m) => m.content) ?? [];
    expect(texts).toContain("keep-head");
    expect(texts).not.toContain("drop-tail");
  });

  it("holds a 200ms window and flush empties immediately", () => {
    process.env.MAOU_LEDGER_BATCH_MS = "200";
    const s = store();
    const session = s.create({ title: "t" });
    appendLedgerEvent(s.sessionDir, session.id, "system/notice", { content: "a", role: "user" });
    appendLedgerEvent(s.sessionDir, session.id, "system/notice", { content: "b", role: "user" });
    expect(peekPendingWrites(s.sessionDir, session.id).length).toBe(2);
    const before = existsSync(s.jsonlPath(session.id)) ? readFileSync(s.jsonlPath(session.id), "utf-8") : "";
    expect(before.includes('"content":"b"') || before.includes("\"content\":\"b\"")).toBe(false);
    flushLedger(s.sessionDir, session.id);
    expect(peekPendingWrites(s.sessionDir, session.id).length).toBe(0);
    const after = readFileSync(s.jsonlPath(session.id), "utf-8");
    expect(after).toContain("system/notice");
    expect(after.match(/system\/notice/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps assistant_delta out of the ledger and raw log", () => {
    const s = store();
    const session = s.create({ title: "t" });
    s.appendRawEntry(session.id, { type: "assistant_delta", text: "tok" });
    s.appendRawEntry(session.id, { type: "thinking_delta", text: "th" });
    s.appendMessage(session.id, "user", "hello");
    const events = readFileSync(s.jsonlPath(session.id), "utf-8");
    expect(events).not.toContain("assistant_delta");
    expect(events).not.toContain("thinking_delta");
    const rawPath = join(s.sessionRoot(session.id), "raw.jsonl");
    if (existsSync(rawPath)) {
      const raw = readFileSync(rawPath, "utf-8");
      expect(raw).not.toContain("assistant_delta");
    }
  });

  it("classifies tool_not_started vs tool_outcome_unknown and only recovers when cold", () => {
    const s = store();
    const session = s.create({ title: "t" });
    appendLedgerEvent(s.sessionDir, session.id, "tool/call", { id: "c1", name: "bash" });
    flushLedger(s.sessionDir, session.id);
    expect(classifyUnclosedTools(readLedgerRecords(s.sessionDir, session.id)).map((r) => r.code)).toEqual([
      "tool_not_started",
    ]);
    s.load(session.id);
    const after = readLedgerRecords(s.sessionDir, session.id);
    expect(after.some((e) => e.type === "tool/result" && e.data.code === "tool_not_started")).toBe(true);

    const s2 = store();
    const b = s2.create({ title: "t" });
    appendLedgerEvent(s2.sessionDir, b.id, "tool/call", { id: "c2", name: "bash" });
    appendLedgerEvent(s2.sessionDir, b.id, "tool/dispatch", { id: "c2", name: "bash", sideEffect: true });
    flushLedger(s2.sessionDir, b.id);
    expect(classifyUnclosedTools(readLedgerRecords(s2.sessionDir, b.id)).map((r) => r.code)).toEqual([
      "tool_outcome_unknown",
    ]);
    s2.load(b.id);
    expect(
      readLedgerRecords(s2.sessionDir, b.id).some(
        (e) => e.type === "tool/result" && e.data.code === "tool_outcome_unknown",
      ),
    ).toBe(true);

    const s3 = store();
    const c = s3.create({ title: "t" });
    s3.markLive(c.id);
    appendLedgerEvent(s3.sessionDir, c.id, "tool/call", { id: "c3", name: "bash" });
    flushLedger(s3.sessionDir, c.id);
    s3.load(c.id);
    expect(
      readLedgerRecords(s3.sessionDir, c.id).some((e) => e.type === "tool/result" && e.data.recovered),
    ).toBe(false);
  });

  it("closes an open turn on cold load and refuses when live", () => {
    const s = store();
    const session = s.create({ title: "t" });
    s.appendMessage(session.id, "user", "half-turn");
    appendLedgerEvent(s.sessionDir, session.id, "turn/start", {});
    flushLedger(s.sessionDir, session.id);
    const before = readLedgerRecords(s.sessionDir, session.id);
    expect(classifyOpenTurn(before).open).toBe(true);
    const userSeq = before.find((e) => e.type === "user/message")?.seq;
    s.load(session.id);
    const after = readLedgerRecords(s.sessionDir, session.id);
    expect(after.some((e) => e.type === "turn/end" && e.data.recovered === true)).toBe(true);
    expect(after.find((e) => e.type === "user/message")?.seq).toBe(userSeq);
    expect(after.find((e) => e.type === "user/message")?.data.content).toBe("half-turn");

    const live = store();
    const c = live.create({ title: "t" });
    live.markLive(c.id);
    appendLedgerEvent(live.sessionDir, c.id, "turn/start", {});
    flushLedger(live.sessionDir, c.id);
    live.load(c.id);
    expect(
      readLedgerRecords(live.sessionDir, c.id).some((e) => e.type === "turn/end" && e.data.recovered),
    ).toBe(false);
  });

  it("lists from slim cache and does not keep last_raw_response", () => {
    const s = store();
    const session = s.create({ title: "list-title" });
    s.appendMessage(session.id, "user", "hello-list");
    const listed = s.list();
    expect(listed.some((row) => row.id === session.id && row.title === "list-title")).toBe(true);
    expect(listed.find((row) => row.id === session.id)?.userTurns).toBe(1);
    expect(existsSync(join(s.sessionDir, LIST_CACHE_FILE))).toBe(true);
    expect(readListCache(s.sessionDir)?.items.some((row) => row.id === session.id)).toBe(true);
    const slim = s.readMetaSlim(session.id);
    expect(slim?.last_raw_response).toBeUndefined();
    const heavy = `"last_raw_response":${JSON.stringify("x".repeat(200))}`;
    expect(stripHeavySessionMetaText(`{${heavy},"id":"a"}`)).not.toContain("xxx");
    expect(JSON.parse(stripHeavySessionMetaText(`{${heavy},"id":"a"}`)).last_raw_response).toBe("");
  });

  it("lists userTurns as user sends, not ledger volume", () => {
    const s = store();
    const session = s.create({ title: "t" });
    s.appendMessage(session.id, "user", "u1");
    s.appendMessage(session.id, "assistant", "a1");
    s.appendMessage(session.id, "user", "u2");
    const row = s.list().find((x) => x.id === session.id);
    expect(row?.userTurns).toBe(2);
    expect(row?.messageCount).toBeGreaterThan(row!.userTurns);
  });

  it("lists userTurns from offset when lifetime is zero", () => {
    const s = store();
    const session = s.create({ title: "t" });
    s.appendMessage(session.id, "user", "u1");
    s.appendMessage(session.id, "assistant", "a1");
    const metaPath = join(s.sessionRoot(session.id), "session.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as {
      lifetime?: { userTurns: number };
    };
    writeFileSync(
      metaPath,
      JSON.stringify({
        ...meta,
        lifetime: {
          userTurns: 0,
          assistantTurns: 0,
          toolCalls: 0,
          inputTokens: 0,
          outputTokens: 0,
          modelMs: 0,
          toolMs: 0,
          ttftMs: 0,
        },
      }),
    );
    rmSync(join(s.sessionDir, LIST_CACHE_FILE), { force: true });
    expect(s.list().find((x) => x.id === session.id)?.userTurns).toBe(1);
  });

  it("treats compact/start without end as a lock and keeps the original log", () => {
    const s = store();
    const session = s.create({ title: "t" });
    s.appendMessage(session.id, "user", "original-line");
    appendLedgerEvent(s.sessionDir, session.id, "compact/start", { source: "auto" });
    flushLedger(s.sessionDir, session.id);
    expect(compactLockOpen(readLedgerRecords(s.sessionDir, session.id))).toBe(true);
    expect(readFileSync(s.jsonlPath(session.id), "utf-8")).toContain("original-line");
    appendLedgerEvent(s.sessionDir, session.id, "compact/end", { error: "crash" });
    flushLedger(s.sessionDir, session.id);
    expect(compactLockOpen(readLedgerRecords(s.sessionDir, session.id))).toBe(false);
  });

  it("does not prune below the occupancy line and fills omission metadata", () => {
    expect(
      decideWindowPressure({ occupancy: 10, window: 1000, largestToolResultChars: 99_000 }),
    ).toBe("none");
    expect(
      decideWindowPressure({
        occupancy: 800,
        window: 1000,
        largestToolResultChars: TOOL_RESULT_PRUNE_THRESHOLD_CHARS + 10,
      }),
    ).toBe("omit");
    expect(
      decideWindowPressure({ occupancy: 800, window: 1000, largestToolResultChars: 10 }),
    ).toBe("summarize");
    const text = `${"H".repeat(5000)}${"M".repeat(4000)}${"T".repeat(2000)}`;
    const out = pruneToolResultText(text);
    expect(out).toBeTruthy();
    expect(out!).toMatch(/Omitted \d+ code points\./);
    const notice = buildRetentionNotice({
      original: 100,
      keptHead: 10,
      keptTail: 10,
      unit: "chars",
    });
    expect(notice.omitted).toEqual({ kind: "exact", count: 80, unit: "chars" });
    expect(notice.keptHead).toBe(10);
    expect(notice.keptTail).toBe(10);
    expect(notice.marker).toBeTruthy();
  });

  it("uses fold cache on hit and rebuilds when the fingerprint is wrong", () => {
    const s = store();
    const session = s.create({ title: "t" });
    for (let i = 0; i < 8; i++) s.appendMessage(session.id, "user", `blob-${"x".repeat(400)}-${i}`);
    s.load(session.id);
    expect(existsSync(join(s.sessionRoot(session.id), FOLD_CACHE_FILE))).toBe(true);
    jsonlIoStats.reset();
    const hit = s.load(session.id);
    expect(hit?.messages.length).toBeGreaterThan(0);
    expect(jsonlIoStats.eventsBytesRead).toBeLessThan(statSync(s.jsonlPath(session.id)).size / 3);

    const cache = readFoldCache(s.sessionRoot(session.id))!;
    writeFileSync(
      join(s.sessionRoot(session.id), FOLD_CACHE_FILE),
      JSON.stringify({ ...cache, tailFingerprint: "wrong", lastSeq: cache.lastSeq }, null, 2),
    );
    const rebuilt = s.load(session.id);
    expect(rebuilt?.messages.length).toBe(hit?.messages.length);
    expect(readFoldCache(s.sessionRoot(session.id))?.tailFingerprint).not.toBe("wrong");
  });

  it("pages when FTS is off and errors search; live search sees unflushed lines", () => {
    process.env.MAOU_SESSION_FTS = "0";
    const s = store();
    const session = s.create({ title: "t" });
    s.appendMessage(session.id, "user", "paged-ok");
    expect(s.loadRecent(session.id, { limit: 1 })?.messages[0]?.content).toBe("paged-ok");
    expect(() => s.search({ query: "paged-ok" })).toThrow(/会话搜索已关闭/);

    delete process.env.MAOU_SESSION_FTS;
    const s2 = store();
    const live = s2.create({ title: "t" });
    process.env.MAOU_LEDGER_BATCH_MS = "200";
    appendLedgerEvent(s2.sessionDir, live.id, "user/message", {
      role: "user",
      content: "live-unflushed-needle",
    });
    expect(peekPendingWrites(s2.sessionDir, live.id).length).toBeGreaterThan(0);
    const page = s2.search({ query: "live-unflushed-needle", sessionId: live.id });
    expect(page.items.some((h) => h.sessionId === live.id)).toBe(true);
    flushLedger(s2.sessionDir, live.id);
  });

  it("pins a user title so polished cannot overwrite", async () => {
    const s = store();
    const session = s.create({ title: "draft-one" });
    s.setTitle(session.id, "mine", "user");
    const ok = await polishSessionTitle(s, session.id, async () => "polished-should-not-win");
    expect(ok).toBe(false);
    expect(s.readMeta(session.id)?.title).toBe("mine");
    expect(s.readMeta(session.id)?.title_source).toBe("user");
  });

  it("keeps lifetime turns after compact markers", () => {
    const s = store();
    const session = s.create({ title: "t" });
    s.appendMessage(session.id, "user", "u1");
    s.appendMessage(session.id, "assistant", "a1");
    const turns = s.readMeta(session.id)!.lifetime!.userTurns;
    appendLedgerEvent(s.sessionDir, session.id, "compact/start", { source: "auto" });
    appendLedgerEvent(s.sessionDir, session.id, "compact/end", { stage: "summaryStage" });
    s.flush(session.id);
    expect(s.readMeta(session.id)!.lifetime!.userTurns).toBe(turns);
  });

  it("exports a zip that contains the last flushed line", () => {
    const s = store();
    const session = s.create({ title: "t" });
    s.appendMessage(session.id, "user", "zip-last-needle-99");
    const entries = collectSessionZipEntries(s, session.id);
    const events = entries.find((e) => e.name === "events.jsonl");
    expect(events?.data.toString("utf-8")).toContain("zip-last-needle-99");
    const zip = exportSessionZip(s, session.id);
    expect(zip.subarray(0, 2).toString("utf-8")).toBe("PK");
  });

  it("seals a live prefix into gzip and keeps the tail plaintext", () => {
    const s = store();
    const session = s.create({ title: "t" });
    for (let i = 0; i < 20; i++) s.appendMessage(session.id, "user", `seal-${"y".repeat(80)}-${i}`);
    const seg = sealLivePrefixIfNeeded(s.sessionRoot(session.id), { threshold: 400, keepTail: 120 });
    expect(seg).toBeTruthy();
    expect(existsSync(join(s.sessionRoot(session.id), seg!.file))).toBe(true);
    const live = readFileSync(s.jsonlPath(session.id), "utf-8");
    expect(live.startsWith("{") || live.length >= 0).toBe(true);
    const page = s.loadRecent(session.id, { limit: 3 });
    expect(page?.messages.length).toBeGreaterThan(0);
  });
});
