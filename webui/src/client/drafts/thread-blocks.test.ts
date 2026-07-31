import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { groupThreadBlocks } from "./thread-blocks";
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
});
