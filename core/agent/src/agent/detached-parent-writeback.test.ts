import { describe, expect, it } from "vitest";
import { buildDetachedParentWriteback } from "./detached-parent-writeback.js";

describe("buildDetachedParentWriteback", () => {
  it("skips non-detached fork_end", () => {
    expect(
      buildDetachedParentWriteback({
        kind: "fork_end",
        taskId: "t",
        subSessionId: "child",
        ok: true,
        elapsedMs: 1,
        parentSessionId: "parent",
      }),
    ).toBeNull();
  });

  it("builds an agent_message for the parent session", () => {
    const built = buildDetachedParentWriteback({
      kind: "fork_end",
      taskId: "t",
      subSessionId: "child-9",
      ok: true,
      elapsedMs: 12,
      detached: true,
      parentSessionId: "ops-1",
      output: "lint clean",
      agentName: "coding",
    });
    expect(built?.parentSessionId).toBe("ops-1");
    expect(built?.event.kind).toBe("agent_message");
    expect(built?.event.content).toMatch(/sessionId: child-9/);
    expect(built?.event.content).toMatch(/lint clean/);
    expect(built?.event.content).toMatch(/from="coding"/);
  });
});
