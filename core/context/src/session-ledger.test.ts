import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionStore } from "./session-store.js";
import { CheckpointStore } from "./checkpoint-store.js";
import {
  appendLedgerEvent,
  bindSessionLedgerPort,
  queryLedgerEvents,
  registerLedgerEvent,
  resetExtraLedgerCatalogForTests,
} from "./session-ledger.js";
import { appendSessionEvent } from "./session-event.js";

describe("session ledger catalog + sidecar", () => {
  const dirs: string[] = [];
  afterEach(() => {
    resetExtraLedgerCatalogForTests();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function store(): SessionStore {
    const dir = mkdtempSync(join(tmpdir(), "maou-ledger-"));
    dirs.push(dir);
    return new SessionStore(dir);
  }

  it("rejects unknown event types", () => {
    const s = store();
    const session = s.create({ title: "t" });
    const result = appendLedgerEvent(s.sessionDir, session.id, "nope/unknown", { x: 1 });
    expect(result).toEqual({ error: expect.stringContaining("未登记") });
  });

  it("register + append is enough for query (no per-feature reader)", () => {
    registerLedgerEvent({
      type: "demo/feature",
      surface: "model",
      description: "示例新功能",
      describe: (d) => `demo/feature ${d.flag}`,
    });
    const s = store();
    const session = s.create({ title: "t" });
    const wrote = appendLedgerEvent(s.sessionDir, session.id, "demo/feature", { flag: "on" });
    expect(wrote).toEqual({ seq: expect.any(Number) });

    const port = bindSessionLedgerPort(s.sessionDir, session.id);
    expect(port.catalog().some((row) => row.type === "demo/feature")).toBe(true);
    const found = port.query({ types: ["demo/feature"], surface: "model" });
    expect(found.total).toBe(1);
    expect(found.events[0]?.data).toMatchObject({ flag: "on" });
    expect(found.events[0]?.summary).toContain("demo/feature on");
  });

  it("appendMessage and appendSessionEvent dual-write the ledger", () => {
    const s = store();
    const session = s.create({ title: "t" });
    s.appendMessage(session.id, "user", "hello world", { kind: "human_user", source: "human" });
    appendSessionEvent(s, session.id, {
      kind: "system_notice",
      content: "todo updated",
      source: "todo_notice",
    });
    s.appendMessage(session.id, "assistant", "calling", {
      kind: "assistant_turn",
      toolCalls: [{ id: "c1", type: "function", name: "grep", arguments: { pattern: "foo" } }],
    });

    const q = queryLedgerEvents(s.sessionDir, session.id, { surface: "model" });
    const types = q.events.map((e) => e.type);
    expect(types).toContain("user/message");
    expect(types).toContain("system/notice");
    expect(types).toContain("assistant/message");
    expect(types).toContain("tool/call");
    expect(q.events.find((e) => e.type === "user/message")?.data.content).toContain("hello world");
    expect(q.events.find((e) => e.type === "tool/call")?.data).toMatchObject({
      name: "grep",
      id: "c1",
    });
  });

  it("save() rewrite of jsonl does not wipe the ledger sidecar", () => {
    const s = store();
    const session = s.create({ title: "t" });
    s.appendMessage(session.id, "user", "keep-me");
    const before = queryLedgerEvents(s.sessionDir, session.id, { types: ["user/message"] });
    expect(before.total).toBe(1);

    const loaded = s.load(session.id);
    expect(loaded).toBeTruthy();
    s.save(loaded!);

    const after = queryLedgerEvents(s.sessionDir, session.id, { types: ["user/message"] });
    expect(after.total).toBe(1);
    expect(after.events[0]?.data.content).toContain("keep-me");
  });

  it("fork copies ledger; clear empties it", () => {
    const s = store();
    const src = s.create({ title: "src" });
    s.appendMessage(src.id, "user", "origin");
    const child = s.forkSession(src.id, "child");
    const copied = queryLedgerEvents(s.sessionDir, child.id, { types: ["user/message"] });
    expect(copied.total).toBeGreaterThanOrEqual(1);

    s.clearSession(src.id);
    const cleared = queryLedgerEvents(s.sessionDir, src.id, { surface: "all" });
    expect(cleared.total).toBe(0);
  });

  it("checkpoint copies and restores the ledger sidecar", () => {
    const s = store();
    const session = s.create({ title: "cp" });
    s.appendMessage(session.id, "user", "before-checkpoint");
    const cps = new CheckpointStore(s);
    const meta = cps.createCheckpoint(session.id, "snap");
    s.appendMessage(session.id, "user", "after-checkpoint");
    expect(
      queryLedgerEvents(s.sessionDir, session.id, { q: "after-checkpoint", surface: "model" }).total,
    ).toBe(1);

    cps.rollbackToCheckpoint(session.id, meta.id);
    const restored = queryLedgerEvents(s.sessionDir, session.id, { surface: "model" });
    expect(restored.events.some((e) => String(e.data.content ?? "").includes("before-checkpoint"))).toBe(true);
    expect(restored.events.some((e) => String(e.data.content ?? "").includes("after-checkpoint"))).toBe(false);
  });
});
