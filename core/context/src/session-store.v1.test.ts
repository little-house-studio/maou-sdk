import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionStore, SESSION_FORMAT } from "./session-store.js";

describe("SessionStore v1", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function store(): SessionStore {
    const dir = mkdtempSync(join(tmpdir(), "maou-v1-"));
    dirs.push(dir);
    return new SessionStore(dir);
  }

  it("writes session.json + events.jsonl and never exposes save()", () => {
    const s = store();
    const session = s.create({ title: "t" });
    expect(s.readMeta(session.id)?.format).toBe(SESSION_FORMAT);
    expect(existsSync(join(s.sessionRoot(session.id), "session.json"))).toBe(true);
    expect(existsSync(join(s.sessionRoot(session.id), "events.jsonl"))).toBe(true);
    expect(typeof (s as unknown as { save?: unknown }).save).toBe("undefined");
  });

  it("appends only; loadRecent pages newest first", () => {
    const s = store();
    const session = s.create({ title: "t" });
    for (let i = 1; i <= 5; i++) s.appendMessage(session.id, "user", `m${i}`);
    const page = s.loadRecent(session.id, { limit: 2 });
    expect(page?.messages.map((m) => m.content)).toEqual(["m4", "m5"]);
    expect(page?.hasMore).toBe(true);
    const older = s.loadOlder(session.id, page!.oldestSeq!, 2);
    expect(older?.messages.map((m) => m.content)).toEqual(["m2", "m3"]);
    expect(older?.hasMore).toBe(true);
  });

  it("fork shares prefix and materializes before deleting parent", () => {
    const s = store();
    const parent = s.create({ title: "p" });
    s.appendMessage(parent.id, "user", "shared");
    const child = s.forkSession(parent.id, "c");
    s.appendMessage(child.id, "user", "only-child");
    expect(s.readMeta(child.id)?.prefix_ref?.sessionId).toBe(parent.id);
    expect(s.listDependents(parent.id).map((d) => d.id)).toEqual([child.id]);
    const preview = s.previewDelete(parent.id);
    expect(preview.warning).toContain("子会话");

    const result = s.deleteSession(parent.id);
    expect(result.deleted).toBe(true);
    expect(result.materialized).toEqual([child.id]);
    expect(s.exists(parent.id)).toBe(false);
    expect(s.readMeta(child.id)?.prefix_ref).toBeUndefined();
    const loaded = s.load(child.id);
    expect(loaded?.messages.map((m) => m.content)).toEqual(["shared", "only-child"]);
    const childEvents = readFileSync(s.jsonlPath(child.id), "utf-8");
    expect(childEvents).toContain("shared");
    expect(childEvents).toContain("only-child");
  });

  it("clearSession deletes the volume", () => {
    const s = store();
    const session = s.create({ title: "gone" });
    s.appendMessage(session.id, "user", "bye");
    s.clearSession(session.id);
    expect(s.exists(session.id)).toBe(false);
    expect(existsSync(s.sessionRoot(session.id))).toBe(false);
  });

  it("pin is an event overlay, not a rewrite", () => {
    const s = store();
    const session = s.create({ title: "t" });
    s.appendMessage(session.id, "user", "keep");
    const before = readFileSync(s.jsonlPath(session.id), "utf-8");
    expect(s.pinMessage(session.id, 0)).toBe(true);
    const after = readFileSync(s.jsonlPath(session.id), "utf-8");
    expect(after.startsWith(before.trim())).toBe(true);
    expect(after).toContain("message/pin");
    expect(s.load(session.id)?.messages[0]?.pinned).toBe(true);
  });

  it("loadOlder walks prefix_ref into the parent file", () => {
    const s = store();
    const parent = s.create({ title: "p" });
    s.appendMessage(parent.id, "user", "p1");
    s.appendMessage(parent.id, "user", "p2");
    s.appendMessage(parent.id, "user", "p3");
    const child = s.forkSession(parent.id, "c");
    s.appendMessage(child.id, "user", "c1");
    s.appendMessage(child.id, "user", "c2");
    const page = s.loadRecent(child.id, { limit: 2 });
    expect(page?.messages.map((m) => m.content)).toEqual(["c1", "c2"]);
    expect(page?.hasMore).toBe(true);
    const older = s.loadOlder(child.id, page!.oldestSeq!, 2);
    expect(older?.messages.map((m) => m.content)).toEqual(["p2", "p3"]);
    expect(older?.hasMore).toBe(true);
  });

  it("does not delete parent if materialize fails", () => {
    const s = store();
    const parent = s.create({ title: "p" });
    s.appendMessage(parent.id, "user", "shared");
    s.forkSession(parent.id, "c");
    s.materializePrefix = () => {
      throw new Error("copy failed");
    };
    expect(() => s.deleteSession(parent.id)).toThrow(/copy failed/);
    expect(s.exists(parent.id)).toBe(true);
  });

  it("rollback changes leaf but keeps regretted turns on disk", () => {
    const s = store();
    const session = s.create({ title: "t" });
    const first = s.appendMessage(session.id, "user", "keep");
    const leafId = first.messages[0]!.id!;
    s.appendMessage(session.id, "user", "regret");
    expect(s.rollbackTo(session.id, leafId)).toBe(true);
    expect(s.load(session.id)?.messages.map((m) => m.content)).toEqual(["keep"]);
    expect(readFileSync(s.jsonlPath(session.id), "utf-8")).toContain("regret");
    expect(readFileSync(s.jsonlPath(session.id), "utf-8")).toContain("session/rollback");
  });
});
