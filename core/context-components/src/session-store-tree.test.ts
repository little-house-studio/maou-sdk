import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionStore } from "./session-store.js";
import { readLedgerRecords } from "./session-ledger.js";

describe("SessionStore tree compat", () => {
  const dirs: string[] = [];
  const prevHome = process.env.MAOU_HOME;
  afterEach(() => {
    if (prevHome === undefined) delete process.env.MAOU_HOME;
    else process.env.MAOU_HOME = prevHome;
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function store(): SessionStore {
    const dir = mkdtempSync(join(tmpdir(), "maou-sess-"));
    dirs.push(dir);
    process.env.MAOU_HOME = dir;
    return new SessionStore(dir);
  }

  it("stamps id/parentId and can branch then hide the abandoned side", () => {
    const s = store();
    const session = s.create({ title: "t" });
    s.appendMessage(session.id, "user", "one");
    const mid = s.appendMessage(session.id, "assistant", "two");
    const branchPoint = mid.messages[0]!.id!;
    s.branchTo(session.id, branchPoint);
    s.appendMessage(session.id, "user", "alt");
    const llm = s.getLlmHistoryMessages(session.id);
    expect(llm.map((m) => m.content)).toEqual(["one", "alt"]);
    expect(llm.every((m) => m.id)).toBe(true);
  });

  it("keeps custom ui entries out of LLM history", () => {
    const s = store();
    const session = s.create({ title: "t" });
    s.appendMessage(session.id, "user", "hello");
    s.appendCustomEntry(session.id, "status-card", { n: 1 });
    const llm = s.getLlmHistoryMessages(session.id);
    expect(llm.map((m) => m.content)).toEqual(["hello"]);
  });

  it("forks from an entry boundary", () => {
    const s = store();
    const session = s.create({ title: "src" });
    s.appendMessage(session.id, "user", "a");
    const b = s.appendMessage(session.id, "assistant", "b");
    s.appendMessage(session.id, "user", "c");
    const boundary = b.messages[1]!.id!;
    const child = s.forkFromEntry(session.id, boundary, { title: "child" });
    expect(child.parentSessionId).toBe(session.id);
    expect(child.messages.map((m) => m.content)).toEqual(["a", "b"]);
    const listed = s.list().find((x) => x.id === child.id);
    expect(listed?.parentSessionId).toBe(session.id);
    const childMeta = s.readMeta(child.id);
    expect(childMeta?.prefix_ref).toEqual(
      expect.objectContaining({ sessionId: session.id }),
    );
    expect(childMeta?.fork_boundary_id).toBe(boundary);
  });

  it("pins permission preset on create; later patch does not rewrite others", () => {
    const s = store();
    const a = s.create({ title: "a", permissionPreset: "workspace+ask" });
    const b = s.create({ title: "b", permissionPreset: "open+yolo" });
    expect(s.readMeta(a.id)?.permission_preset).toBe("workspace+ask");
    expect(s.setPermissionPreset(b.id, "workspace+auto")).toBe(true);
    expect(s.readMeta(a.id)?.permission_preset).toBe("workspace+ask");
    expect(s.readMeta(b.id)?.permission_preset).toBe("workspace+auto");
  });

  it("flags feedback conflict when the vote flips", () => {
    const s = store();
    const session = s.create({ title: "fb" });
    expect(s.noteFeedback(session.id, "m1", "up")).toEqual({ conflict: false });
    expect(s.noteFeedback(session.id, "m1", "down")).toEqual({ conflict: true });
    expect(s.noteFeedback(session.id, "m1", "down")).toEqual({ conflict: false });
    const events = readLedgerRecords(s.sessionDir, session.id);
    const fb = events.filter((e) => e.type === "message/feedback");
    expect(fb.length).toBeGreaterThan(0);
    expect(typeof fb[0]?.data?.anonFeedbackId).toBe("string");
    expect(String(fb[0]?.data?.anonFeedbackId).length).toBeGreaterThan(8);
    const hist = s.getLlmHistoryMessages(session.id);
    expect(JSON.stringify(hist)).not.toContain(String(fb[0]?.data?.anonFeedbackId));
  });

  it("create writes parent_session_id into list()", () => {
    const s = store();
    const root = s.create({ title: "root" });
    const child = s.create({
      title: "fork: npc",
      sessionId: `${root.id}::fork::npc::abc`,
      parentSessionId: root.id,
    });
    expect(child.parentSessionId).toBe(root.id);
    expect(s.list().find((x) => x.id === child.id)?.parentSessionId).toBe(root.id);
  });
});
