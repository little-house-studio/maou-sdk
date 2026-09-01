import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionStore, readLedgerRecords } from "@little-house-studio/context";
import { MessageQueue } from "./message-queue.js";

describe("inbox ledger", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("writes enqueue / claim / cancel rows", () => {
    const dir = mkdtempSync(join(tmpdir(), "maou-inbox-"));
    dirs.push(dir);
    const store = new SessionStore(dir);
    const session = store.create({ title: "inbox" });
    const q = new MessageQueue({ defaultMode: "after_round_complete" });
    const enq = q.enqueue(session.id, "hello", { sessionDir: dir, mode: "after_round_complete" });
    const claimed = q.dequeueIfReady(session.id, "round_end");
    expect(claimed.map((m) => m.id)).toEqual([enq.id]);
    const cancel = q.enqueue(session.id, "bye", { sessionDir: dir, mode: "after_round_complete" });
    expect(q.remove(session.id, cancel.id)).toBe(true);
    const types = readLedgerRecords(dir, session.id).map((e) => e.type);
    expect(types).toContain("inbox/enqueue");
    expect(types).toContain("inbox/claim");
    expect(types).toContain("inbox/cancel");
  });

  it("delivers report_to_parent as agent_message", () => {
    const dir = mkdtempSync(join(tmpdir(), "maou-inbox-"));
    dirs.push(dir);
    const store = new SessionStore(dir);
    const session = store.create({ title: "inbox" });
    const q = new MessageQueue({ defaultMode: "after_round_complete" });
    const { id } = q.enqueue(session.id, `<message from="help" type="report">查完了</message>`, {
      sessionDir: dir,
      mode: "after_round_complete",
      source: "report_to_parent",
      metadata: { fromAgent: "help", fromSessionId: "child-1" },
    });
    const ready = q.dequeueIfReady(session.id, "round_end");
    expect(ready).toHaveLength(1);
    const r = q.deliver(session.id, ready[0]!, store);
    expect(r.delivered).toBe(true);
    const last = store.load(session.id)?.messages.at(-1) as
      | { kind?: string; author?: { type?: string; id?: string }; content?: string }
      | undefined;
    expect(last?.kind).toBe("agent_message");
    expect(last?.author).toMatchObject({ type: "agent", id: "help" });
    expect(last?.content).toBe(`<message from="help" type="report">查完了</message>`);
    expect(id).toBeGreaterThan(0);
  });
});
