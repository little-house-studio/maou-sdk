import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  groupLoopTurns,
  groupThreadBlocks,
  isPlaceholderAssistantBody,
  replyTurnVisible,
} from "./thread-blocks";
import { FULL_CONTEXT_MESSAGES } from "./fixtures";
import type { DraftMessage } from "./types";

describe("groupThreadBlocks", () => {
  it("nests thinking + tool under preceding assistant", () => {
    const msgs: DraftMessage[] = [
      { id: "u", role: "user", body: "hi" },
      { id: "a", role: "assistant", body: "ok **md**" },
      { id: "t", role: "thinking", body: "scan…" },
      {
        id: "tool",
        role: "tool",
        tag: "use_terminal",
        body: "$ rg foo",
        clickable: true,
      },
      { id: "u2", role: "user", body: "next" },
    ];
    const blocks = groupThreadBlocks(msgs);
    assert.equal(blocks.length, 3);
    assert.equal(blocks[0]!.kind, "solo");
    assert.equal(blocks[1]!.kind, "reply");
    if (blocks[1]!.kind === "reply") {
      assert.equal(blocks[1]!.assistant?.id, "a");
      assert.equal(blocks[1]!.internals.length, 2);
      assert.equal(blocks[1]!.internals[0]!.role, "thinking");
      assert.equal(blocks[1]!.internals[1]!.role, "tool");
    }
    assert.equal(blocks[2]!.kind, "solo");
  });

  it("groups orphan tools without assistant", () => {
    const msgs: DraftMessage[] = [
      { id: "tool", role: "tool", tag: "x", body: "out" },
    ];
    const blocks = groupThreadBlocks(msgs);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.kind, "reply");
    if (blocks[0]!.kind === "reply") {
      assert.equal(blocks[0]!.assistant, null);
      assert.equal(blocks[0]!.internals[0]!.id, "tool");
    }
  });

  it("FULL_CONTEXT_MESSAGES yields nested + orphan reply blocks", () => {
    const blocks = groupThreadBlocks(FULL_CONTEXT_MESSAGES);
    assert.ok(blocks.length >= 6);
    const nested = blocks.find(
      (b) =>
        b.kind === "reply" &&
        b.assistant !== null &&
        b.internals.some((i) => i.role === "thinking") &&
        b.internals.some((i) => i.role === "tool"),
    );
    assert.ok(nested, "expected nested thinking+tool under assistant");
    const orphan = blocks.find(
      (b) =>
        b.kind === "reply" &&
        b.assistant === null &&
        b.internals.some((i) => i.role === "tool"),
    );
    assert.ok(orphan, "expected orphan tool group");
    assert.ok(
      blocks.some((b) => b.kind === "solo" && b.message.role === "user"),
    );
    assert.ok(
      blocks.some((b) => b.kind === "solo" && b.message.role === "system"),
    );
    const clean = blocks.find(
      (b) =>
        b.kind === "reply" &&
        b.assistant?.id === "fc-a4-clean" &&
        b.internals.length === 0,
    );
    assert.ok(clean, "clean assistant bubble without internals");
  });

  it("groupLoopTurns folds user + following replies until the next user/system", () => {
    const msgs: DraftMessage[] = [
      { id: "u", role: "user", body: "hi" },
      { id: "a1", role: "assistant", body: "one" },
      { id: "t", role: "tool", tag: "x", body: "out" },
      { id: "a2", role: "assistant", body: "two" },
      { id: "sys", role: "system", body: "note" },
      { id: "u2", role: "user", body: "next" },
      { id: "a3", role: "assistant", body: "ok" },
    ];
    const segs = groupLoopTurns(groupThreadBlocks(msgs));
    assert.equal(segs.length, 3);
    assert.equal(segs[0]!.kind, "loop");
    if (segs[0]!.kind === "loop") {
      assert.equal(segs[0]!.user?.id, "u");
      assert.equal(segs[0]!.replies.length, 2);
    }
    assert.equal(segs[1]!.kind, "solo");
    if (segs[1]!.kind === "solo") {
      assert.equal(segs[1]!.message.id, "sys");
    }
    assert.equal(segs[2]!.kind, "loop");
    if (segs[2]!.kind === "loop") {
      assert.equal(segs[2]!.user?.id, "u2");
      assert.equal(segs[2]!.replies.length, 1);
    }
  });

  it("replyTurnVisible hides blank finished assistants and keeps live/tool turns", () => {
    assert.equal(isPlaceholderAssistantBody(""), true);
    assert.equal(isPlaceholderAssistantBody("…"), true);
    assert.equal(isPlaceholderAssistantBody("ok"), false);

    assert.equal(
      replyTurnVisible({
        kind: "reply",
        assistant: { id: "a", role: "assistant", body: "" },
        internals: [],
      }),
      false,
    );
    assert.equal(
      replyTurnVisible({
        kind: "reply",
        assistant: {
          id: "a",
          role: "assistant",
          body: "",
          meta: { streaming: true },
        },
        internals: [],
      }),
      true,
    );
    assert.equal(
      replyTurnVisible({
        kind: "reply",
        assistant: { id: "a", role: "assistant", body: "" },
        internals: [{ id: "t", role: "tool", body: "ls" }],
      }),
      true,
    );
  });
});
