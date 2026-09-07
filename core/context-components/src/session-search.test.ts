import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { jsonlIoStats } from "./jsonl-offset.js";
import { highlightSnippet } from "./session-search-index.js";
import { SessionStore } from "./session-store.js";

describe("session search + paged tail read", () => {
  const dirs: string[] = [];
  afterEach(() => {
    delete process.env.MAOU_SESSION_FTS;
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function store(): SessionStore {
    const dir = mkdtempSync(join(tmpdir(), "maou-search-"));
    dirs.push(dir);
    return new SessionStore(dir);
  }

  it("indexes on append and finds without scanning events.jsonl", () => {
    const s = store();
    const session = s.create({ title: "t" });
    s.appendMessage(session.id, "user", "hello unique-needle-42");
    const eventsSize = statSync(s.jsonlPath(session.id)).size;
    expect(eventsSize).toBeGreaterThan(0);
    jsonlIoStats.reset();
    const page = s.search({ query: "unique-needle-42" });
    expect(page.items.some((h) => h.sessionId === session.id)).toBe(true);
    expect(page.items[0]?.snippet).toMatch(/unique-needl/);
    expect(jsonlIoStats.eventsBytesRead).toBe(0);
  });

  it("keeps session_index file_size aligned after incremental append", () => {
    const s = store();
    const session = s.create({ title: "t" });
    s.appendMessage(session.id, "user", "first");
    const afterFirst = s.searchIndex.indexState(session.id);
    expect(afterFirst?.fileSize).toBe(statSync(s.jsonlPath(session.id)).size);
    expect(afterFirst?.nextByteOffset).toBe(afterFirst?.fileSize);
    s.appendMessage(session.id, "user", "second");
    const afterSecond = s.searchIndex.indexState(session.id);
    expect(afterSecond?.fileSize).toBe(statSync(s.jsonlPath(session.id)).size);
    expect(afterSecond!.fileSize).toBeGreaterThan(afterFirst!.fileSize);
  });

  it("quoted phrase is literal and ranks by hit count then length", () => {
    const s = store();
    const session = s.create({ title: "t" });
    s.appendMessage(session.id, "user", "foo bar once");
    s.appendMessage(session.id, "assistant", "foo bar foo bar extra words here");
    s.appendMessage(session.id, "user", "foo and also bar separately");
    const page = s.search({ query: '"foo bar"' });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((h) => /foo bar/i.test(h.snippet.replace(/\[|\]/g, "")))).toBe(true);
    expect(page.items.some((h) => h.snippet.includes("[foo bar]") || h.snippet.includes("[foo") )).toBe(true);
    const hits = page.items.filter((h) => h.sessionId === session.id);
    if (hits.length >= 2) {
      expect((hits[0]!.hitCount ?? 0) >= (hits[1]!.hitCount ?? 0)).toBe(true);
    }
  });

  it("does not double-bracket an already highlighted snippet", () => {
    expect(highlightSnippet("say [foo] now", ["foo"])).toBe("say [foo] now");
    expect(highlightSnippet("say foo now", ["foo"])).toBe("say [foo] now");
  });

  it("matches CJK substring and English substring (trigram / LIKE)", () => {
    const s = store();
    const session = s.create({ title: "t" });
    s.appendMessage(session.id, "user", "你好世界 BRAID token");
    const cjk = s.search({ query: "你好" });
    expect(cjk.items.some((h) => h.sessionId === session.id)).toBe(true);
    const en = s.search({ query: "token" });
    expect(en.items.some((h) => /token/i.test(h.snippet))).toBe(true);
  });

  it("keeps prefix text on the child after materialize; parent id leaves the index", () => {
    const s = store();
    const parent = s.create({ title: "p" });
    s.appendMessage(parent.id, "user", "shared-prefix-text");
    const child = s.forkSession(parent.id, "c");
    s.appendMessage(child.id, "user", "only-child-text");
    expect(s.search({ query: "shared-prefix-text" }).items.some((h) => h.sessionId === parent.id)).toBe(
      true,
    );
    s.deleteSession(parent.id);
    const hits = s.search({ query: "shared-prefix-text" });
    expect(hits.items.some((h) => h.sessionId === parent.id)).toBe(false);
    expect(hits.items.some((h) => h.sessionId === child.id)).toBe(true);
    expect(s.search({ query: "only-child-text" }).items.some((h) => h.sessionId === child.id)).toBe(
      true,
    );
  });

  it("loadRecent on a large file only reads the tail", () => {
    const s = store();
    const session = s.create({ title: "t" });
    const blob = "x".repeat(2048);
    for (let i = 0; i < 80; i++) s.appendMessage(session.id, "user", `${blob} m${i}`);
    const eventsSize = statSync(s.jsonlPath(session.id)).size;
    expect(eventsSize).toBeGreaterThan(100_000);
    jsonlIoStats.reset();
    const page = s.loadRecent(session.id, { limit: 2 });
    expect(page?.messages.map((m) => m.content.slice(-3))).toEqual(["m78", "m79"]);
    expect(jsonlIoStats.eventsBytesRead).toBeLessThan(eventsSize / 5);
    expect(jsonlIoStats.eventsBytesRead).toBeGreaterThan(0);
  }, 20_000);

  it("loadOlder walks prefix_ref without reading the parent tail past throughSeq", () => {
    const s = store();
    const parent = s.create({ title: "p" });
    s.appendMessage(parent.id, "user", "p1");
    s.appendMessage(parent.id, "user", "p2");
    s.appendMessage(parent.id, "user", "p3");
    const child = s.forkSession(parent.id, "c");
    s.appendMessage(parent.id, "user", "p4-after-fork");
    s.appendMessage(child.id, "user", "c1");
    s.appendMessage(child.id, "user", "c2");
    const page = s.loadRecent(child.id, { limit: 2 });
    expect(page?.messages.map((m) => m.content)).toEqual(["c1", "c2"]);
    const older = s.loadOlder(child.id, page!.oldestSeq!, 2);
    expect(older?.messages.map((m) => m.content)).toEqual(["p2", "p3"]);
    expect(older?.messages.some((m) => m.content === "p4-after-fork")).toBe(false);
  });

  it("pages without sqlite and fails search clearly", () => {
    process.env.MAOU_SESSION_FTS = "0";
    const dir = mkdtempSync(join(tmpdir(), "maou-search-nosql-"));
    dirs.push(dir);
    const s = new SessionStore(dir);
    expect(s.searchIndex.available).toBe(false);
    const session = s.create({ title: "t" });
    for (let i = 1; i <= 4; i++) s.appendMessage(session.id, "user", `m${i}`);
    const page = s.loadRecent(session.id, { limit: 2 });
    expect(page?.messages.map((m) => m.content)).toEqual(["m3", "m4"]);
    expect(existsSync(join(s.sessionRoot(session.id), "events.offset.jsonl"))).toBe(true);
    expect(() => s.search({ query: "m3" })).toThrow(/MAOU_SESSION_FTS=0|会话搜索已关闭/);
  });
});
