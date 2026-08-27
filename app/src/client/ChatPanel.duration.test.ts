import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  inferToolDurationsFromStartGaps,
  type ChatLine,
} from "./ChatPanel";

function tool(
  id: string,
  startedAt: number,
  durationMs?: number,
): ChatLine {
  return {
    id,
    role: "tool",
    text: id,
    startedAt,
    ...(durationMs != null ? { durationMs } : {}),
  };
}

describe("inferToolDurationsFromStartGaps", () => {
  it("assigns the start-to-start gap to the earlier tool", () => {
    const a = tool("a", 1_000);
    const b = tool("b", 1_400);
    const c = tool("c", 2_000);
    inferToolDurationsFromStartGaps([a, b, c]);
    assert.equal(a.durationMs, 400);
    assert.equal(b.durationMs, 600);
    assert.equal(c.durationMs, undefined);
  });

  it("does not overwrite an existing duration", () => {
    const a = tool("a", 1_000, 50);
    const b = tool("b", 1_400);
    inferToolDurationsFromStartGaps([a, b]);
    assert.equal(a.durationMs, 50);
    assert.equal(b.durationMs, undefined);
  });

  it("does not infer across a user or assistant turn", () => {
    const a = tool("a", 1_000);
    const user: ChatLine = { id: "u", role: "user", text: "next" };
    const b = tool("b", 1_400);
    inferToolDurationsFromStartGaps([a, user, b]);
    assert.equal(a.durationMs, undefined);
    assert.equal(b.durationMs, undefined);
  });

  it("ignores gaps that are too small or too large", () => {
    const shortA = tool("sa", 1_000);
    const shortB = tool("sb", 1_050);
    inferToolDurationsFromStartGaps([shortA, shortB]);
    assert.equal(shortA.durationMs, undefined);

    const longA = tool("la", 1_000);
    const longB = tool("lb", 1_000 + 30 * 60 * 1000);
    inferToolDurationsFromStartGaps([longA, longB]);
    assert.equal(longA.durationMs, undefined);
  });
});
