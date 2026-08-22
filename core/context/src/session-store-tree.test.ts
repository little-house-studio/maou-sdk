import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionStore } from "./session-store.js";

describe("SessionStore tree compat", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function store(): SessionStore {
    const dir = mkdtempSync(join(tmpdir(), "maou-sess-"));
    dirs.push(dir);
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
