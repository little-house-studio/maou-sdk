import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DraftMessage } from "../types";
import {
  groupLoopTurns,
  groupThreadBlocks,
  reuseThreadSegments,
} from "./thread-blocks";

function msg(id: string, role: DraftMessage["role"], body = ""): DraftMessage {
  return { id, role, body } as DraftMessage;
}

function segmentsOf(messages: DraftMessage[]) {
  return groupLoopTurns(groupThreadBlocks(messages));
}

describe("reuseThreadSegments", () => {
  it("keeps the previous segment object when its messages are identical", () => {
    const u1 = msg("u1", "user", "first");
    const a1 = msg("a1", "assistant", "done");
    const t1 = msg("t1", "tool", "✓ read");
    const u2 = msg("u2", "user", "second");
    const a2 = msg("a2", "assistant", "");

    const first = reuseThreadSegments([], segmentsOf([u1, a1, t1, u2, a2]));
    assert.equal(first.length, 2);

    // Stream a delta into the second loop only.
    const a2b = { ...a2, body: "typing" };
    const second = reuseThreadSegments(first, segmentsOf([u1, a1, t1, u2, a2b]));
    assert.notEqual(second, first, "array changes when any loop changed");
    assert.equal(second[0], first[0], "untouched loop keeps identity");
    assert.notEqual(second[1], first[1], "streaming loop is a new segment");
    assert.equal(second[1]!.kind, "loop");
    if (second[1]!.kind === "loop") {
      assert.equal(second[1]!.replies[0]!.assistant, a2b);
    }
  });

  it("returns the previous array when nothing changed", () => {
    const u = msg("u", "user", "q");
    const a = msg("a", "assistant", "x");
    const prev = reuseThreadSegments([], segmentsOf([u, a]));
    const again = reuseThreadSegments(prev, segmentsOf([u, a]));
    assert.equal(again, prev);
  });

  it("does not reuse across kind or reply-shape changes", () => {
    const u = msg("u", "user", "q");
    const a = msg("a", "assistant", "x");
    const s = msg("s", "system", "note");
    const prev = reuseThreadSegments([], segmentsOf([u, a]));
    // A tool appears under the assistant → internals differ → new segment.
    const t = msg("t", "tool", "▶ read");
    const next = reuseThreadSegments(prev, segmentsOf([u, a, t]));
    assert.notEqual(next[0], prev[0]);
    // Solo system row vs loop → no reuse.
    const solo = reuseThreadSegments(prev, segmentsOf([s]));
    assert.notEqual(solo[0], prev[0]);
    assert.equal(solo[0]!.kind, "solo");
  });
});
