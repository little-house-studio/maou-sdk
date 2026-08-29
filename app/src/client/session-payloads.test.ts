/**
 * 落盘账本索引 → transcript 尾对齐回填。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  alignmentTrustworthy,
  applySessionPayloadIndex,
  type PayloadIndex,
  type PayloadTurn,
} from "./session-payloads";

function turn(
  kind: "user" | "assistant",
  index: number,
  id: string,
  usage: Partial<PayloadTurn["usage"]> = {},
): PayloadTurn {
  return {
    kind,
    index,
    id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      reported: false,
      ...usage,
    },
    toolCalls: 0,
    hasRequest: kind === "assistant",
    hasResponse: kind === "assistant",
  };
}

function index(users: PayloadTurn[], turns: PayloadTurn[]): PayloadIndex {
  return { ok: true, file: "/tmp/events.jsonl", users, turns };
}

describe("applySessionPayloadIndex", () => {
  it("pairs disk turns onto live lines from the end and fills payload ids", () => {
    const lines = [
      { role: "user", id: "local-1" },
      { role: "assistant", id: "local-2", usageOutput: 40 },
      { role: "tool", id: "local-3" },
      { role: "assistant", id: "local-4", usageOutput: 10 },
    ];
    const next = applySessionPayloadIndex(lines as never[], index(
      [turn("user", 0, "u1")],
      [
        turn("assistant", 0, "a1", { output: 40, input: 1000, cacheRead: 600, reported: true }),
        turn("assistant", 1, "a2", { output: 10 }),
      ],
    )) as Array<Record<string, unknown>>;
    assert.equal(next[0]!.payloadId, "u1");
    assert.equal(next[0]!.ordinal, 1);
    assert.equal(next[1]!.payloadId, "a1");
    assert.equal(next[1]!.cacheRead, 600);
    assert.equal(next[1]!.cacheReported, true);
    assert.equal(next[1]!.usageInput, 1000);
    assert.equal(next[3]!.payloadId, "a2");
    // 工具行不参与配对
    assert.equal(next[2]!.payloadId, undefined);
  });

  it("keeps session-true ordinals when the client only loaded the tail", () => {
    // 磁盘上有 5 条提问，前端只加载了最后 2 条
    const lines = [
      { role: "user", id: "l1" },
      { role: "assistant", id: "l2" },
      { role: "user", id: "l3" },
      { role: "assistant", id: "l4" },
    ];
    const users = [0, 1, 2, 3, 4].map((i) => turn("user", i, `u${i}`));
    const turns = [0, 1, 2, 3].map((i) => turn("assistant", i, `a${i}`));
    const next = applySessionPayloadIndex(lines as never[], index(users, turns)) as Array<
      Record<string, unknown>
    >;
    assert.equal(next[0]!.ordinal, 4);
    assert.equal(next[2]!.ordinal, 5);
    assert.equal(next[0]!.payloadId, "u3");
    assert.equal(next[2]!.payloadId, "u4");
  });

  it("does not overwrite usage the stream already reported", () => {
    const lines = [{ role: "assistant", id: "l1", usageInput: 77, usageOutput: 9 }];
    const next = applySessionPayloadIndex(lines as never[], index([], [
      turn("assistant", 0, "a1", { input: 999, output: 9, reported: true }),
    ])) as Array<Record<string, unknown>>;
    assert.equal(next[0]!.usageInput, 77);
    assert.equal(next[0]!.usageOutput, 9);
  });

  it("is a no-op when the index could not be read", () => {
    const lines = [{ role: "assistant", id: "l1" }];
    const out = applySessionPayloadIndex(lines as never[], {
      ok: false,
      file: null,
      users: [],
      turns: [],
    });
    assert.equal(out, lines);
  });

  it("refuses to pair when output tokens disagree — wrong payload beats no payload", () => {
    const lines = [
      { role: "assistant", id: "l1", usageOutput: 11 },
      { role: "assistant", id: "l2", usageOutput: 22 },
      { role: "assistant", id: "l3", usageOutput: 33 },
    ];
    const shifted = [
      turn("assistant", 0, "a0", { output: 99 }),
      turn("assistant", 1, "a1", { output: 88 }),
      turn("assistant", 2, "a2", { output: 77 }),
    ];
    const out = applySessionPayloadIndex(lines as never[], index([], shifted));
    assert.equal(out, lines);
  });
});

describe("alignmentTrustworthy", () => {
  it("passes with too few comparable pairs", () => {
    assert.equal(alignmentTrustworthy([{ usageOutput: 5 }], [turn("assistant", 0, "a")]), true);
  });

  it("passes when the tail agrees", () => {
    const lines = [{ usageOutput: 5 }, { usageOutput: 6 }, { usageOutput: 7 }];
    const turns = [
      turn("assistant", 0, "a0", { output: 5 }),
      turn("assistant", 1, "a1", { output: 6 }),
      turn("assistant", 2, "a2", { output: 7 }),
    ];
    assert.equal(alignmentTrustworthy(lines, turns), true);
  });

  it("fails on an off-by-one shift", () => {
    const lines = [{ usageOutput: 5 }, { usageOutput: 6 }, { usageOutput: 7 }];
    const turns = [
      turn("assistant", 0, "a0", { output: 6 }),
      turn("assistant", 1, "a1", { output: 7 }),
      turn("assistant", 2, "a2", { output: 8 }),
    ];
    assert.equal(alignmentTrustworthy(lines, turns), false);
  });
});
