import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildImInbox } from "./AgentList";
import type { DraftAgent } from "../types";

function agent(
  over: Partial<DraftAgent> & Pick<DraftAgent, "id" | "name" | "status">,
): DraftAgent {
  return {
    role: "coding",
    group: "system",
    ...over,
  };
}

describe("buildImInbox", () => {
  it("drops stale and ranks needs_reply first", () => {
    const rows = buildImInbox([
      agent({ id: "a", name: "alpha", status: "idle" }),
      agent({ id: "b", name: "bravo", status: "needs_reply" }),
      agent({ id: "c", name: "charlie", status: "running", stale: true }),
      agent({ id: "d", name: "delta", status: "blocked" }),
    ]);
    assert.deepEqual(
      rows.map((a) => a.id),
      ["b", "d", "a"],
    );
  });
});
