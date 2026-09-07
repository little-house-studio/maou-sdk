import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionStore } from "./session-store.js";
import {
  appendToolResult,
  findToolCallIdByPayload,
  formatToolFollowupText,
  isToolCallIdPaired,
  pendingToolCallIdsAtTail,
} from "./tool-result.js";

describe("appendToolResult", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function store(): SessionStore {
    const dir = mkdtempSync(join(tmpdir(), "maou-tool-"));
    dirs.push(dir);
    return new SessionStore(dir);
  }

  function seedCalls(
    s: SessionStore,
    sid: string,
    calls: Array<{ id: string; name: string; parameters?: Record<string, unknown> }>,
  ): void {
    s.appendMessage(sid, "assistant", "", {
      toolCalls: calls.map((c) => ({
        id: c.id,
        type: "function",
        name: c.name,
        arguments: c.parameters ?? {},
      })),
    });
  }

  function msgs(s: SessionStore, sid: string): Array<Record<string, unknown>> {
    return (s.load(sid)?.messages ?? []) as Array<Record<string, unknown>>;
  }

  it("pairs the first result as role=tool", () => {
    const s = store();
    const { id } = s.create({ title: "t" });
    seedCalls(s, id, [{ id: "c1", name: "grep" }]);
    const out = appendToolResult(s, id, {
      name: "grep",
      content: "hit",
      ok: true,
      toolCallId: "c1",
    });
    expect(out).toMatchObject({ wireRole: "tool", firstPair: true, patchedOrphans: 0 });
    const last = msgs(s, id).at(-1)!;
    expect(last.role).toBe("tool");
    expect(last.kind).toBe("tool_result");
    expect(last.toolCallId).toBe("c1");
    expect(last.content).toBe("hit");
    expect(isToolCallIdPaired(msgs(s, id), "c1")).toBe(true);
    expect(pendingToolCallIdsAtTail(msgs(s, id))).toEqual([]);
  });

  it("writes the same toolCallId again as role=user follow-up", () => {
    const s = store();
    const { id } = s.create({ title: "t" });
    seedCalls(s, id, [{ id: "c1", name: "use_terminal" }]);
    appendToolResult(s, id, {
      name: "use_terminal",
      content: "started",
      ok: true,
      toolCallId: "c1",
    });
    const out = appendToolResult(s, id, {
      name: "use_terminal",
      content: "done later",
      ok: true,
      toolCallId: "c1",
    });
    expect(out).toMatchObject({ wireRole: "user", firstPair: false });
    const last = msgs(s, id).at(-1)!;
    expect(last.role).toBe("user");
    expect(last.kind).toBe("tool_async_notify");
    expect(String(last.content)).toContain("<tool-followup");
    expect(String(last.content)).toContain('id="c1"');
    expect(String(last.content)).toContain("done later");
  });

  it("writes user when there is no pending tool_call", () => {
    const s = store();
    const { id } = s.create({ title: "t" });
    s.appendMessage(id, "user", "hi");
    const out = appendToolResult(s, id, {
      name: "use_terminal",
      content: "orphan notify",
      ok: true,
      toolCallId: "missing",
    });
    expect(out.wireRole).toBe("user");
    expect(msgs(s, id).at(-1)!.role).toBe("user");
  });

  it("patches leftover pending ids before inserting a user follow-up", () => {
    const s = store();
    const { id } = s.create({ title: "t" });
    seedCalls(s, id, [
      { id: "a", name: "grep" },
      { id: "b", name: "glob" },
    ]);
    appendToolResult(s, id, { name: "grep", content: "a-ok", ok: true, toolCallId: "a" });
    expect(pendingToolCallIdsAtTail(msgs(s, id))).toEqual(["b"]);

    const out = appendToolResult(s, id, {
      name: "grep",
      content: "a-again",
      ok: true,
      toolCallId: "a",
    });
    expect(out.wireRole).toBe("user");
    expect(out.patchedOrphans).toBe(1);
    const all = msgs(s, id);
    expect(all[all.length - 2]).toMatchObject({
      role: "tool",
      toolCallId: "b",
    });
    expect(String(all[all.length - 2]!.content)).toMatch(/仍在执行|打断/);
    expect(all.at(-1)).toMatchObject({ role: "user", kind: "tool_async_notify" });
    expect(isToolCallIdPaired(all, "b")).toBe(true);
  });

  it("keeps first results of two different ids as tool", () => {
    const s = store();
    const { id } = s.create({ title: "t" });
    seedCalls(s, id, [
      { id: "a", name: "grep" },
      { id: "b", name: "glob" },
    ]);
    const ra = appendToolResult(s, id, { name: "grep", content: "A", ok: true, toolCallId: "a" });
    const rb = appendToolResult(s, id, { name: "glob", content: "B", ok: true, toolCallId: "b" });
    expect(ra.wireRole).toBe("tool");
    expect(rb.wireRole).toBe("tool");
    const roles = msgs(s, id).filter((m) => m.toolCallId).map((m) => [m.toolCallId, m.role]);
    expect(roles).toEqual([
      ["a", "tool"],
      ["b", "tool"],
    ]);
  });

  it("finds the original toolCallId from payload / assistant arguments", () => {
    const s = store();
    const { id } = s.create({ title: "t" });
    seedCalls(s, id, [
      { id: "term-call", name: "use_terminal", parameters: { command: "sleep 1" } },
    ]);
    appendToolResult(s, id, {
      name: "use_terminal",
      content: "started",
      ok: true,
      toolCallId: "term-call",
      payload: { terminal_id: "pty-9" },
    });
    const found = findToolCallIdByPayload(msgs(s, id), "terminal_id", "pty-9");
    expect(found).toBe("term-call");
  });

  it("injectPendingToolInterrupts patches via the same writer", () => {
    const s = store();
    const { id } = s.create({ title: "t" });
    seedCalls(s, id, [{ id: "c1", name: "grep" }]);
    expect(s.injectPendingToolInterrupts(id)).toBe(true);
    const last = msgs(s, id).at(-1)!;
    expect(last.role).toBe("tool");
    expect(last.toolCallId).toBe("c1");
    expect(String(last.content)).toContain("打断");
    expect(s.injectPendingToolInterrupts(id)).toBe(false);
  });

  it("leaves <terminal-message> body unwrapped", () => {
    const text = formatToolFollowupText({
      name: "use_terminal",
      content: "<terminal-message>\ndone\n</terminal-message>",
      ok: true,
      toolCallId: "c1",
    });
    expect(text).toBe("<terminal-message>\ndone\n</terminal-message>");
  });
});
