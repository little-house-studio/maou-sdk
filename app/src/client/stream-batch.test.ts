import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyAssistantDelta,
  applyThinkingDelta,
  type ChatLine,
} from "./ChatPanel";
import {
  coalesceStreamEvents,
  createFrameBatcher,
  streamDeltaKind,
  type FrameScheduler,
} from "./stream-batch";

function manualScheduler(): FrameScheduler & { fire(): void; pending(): number } {
  let cbs: Array<() => void> = [];
  return {
    schedule(cb) {
      cbs.push(cb);
      return cb;
    },
    cancel(h) {
      cbs = cbs.filter((c) => c !== h);
    },
    fire() {
      const run = cbs;
      cbs = [];
      for (const cb of run) cb();
    },
    pending: () => cbs.length,
  };
}

describe("coalesceStreamEvents", () => {
  it("merges adjacent same-kind deltas and keeps order around other events", () => {
    const out = coalesceStreamEvents([
      { type: "thinking_delta", delta: "th" },
      { type: "reasoning_delta", content: "ink" },
      { type: "text_delta", delta: "a" },
      { type: "assistant_delta", delta: "b" },
      { type: "tool_call", tool: { name: "read" } },
      { type: "text_delta", delta: "c" },
    ]);
    assert.deepEqual(
      out.map((e) => [e.type, e.delta ?? e.content ?? null]),
      [
        ["thinking_delta", "think"],
        ["text_delta", "ab"],
        ["tool_call", null],
        ["text_delta", "c"],
      ],
    );
  });

  it("does not merge across kinds", () => {
    const out = coalesceStreamEvents([
      { type: "text_delta", delta: "a" },
      { type: "thinking_delta", delta: "t" },
      { type: "text_delta", delta: "b" },
    ]);
    assert.equal(out.length, 3);
    assert.equal(streamDeltaKind(out[0]!), "assistant");
    assert.equal(streamDeltaKind(out[1]!), "thinking");
  });

  it("merged delta produces the same lines as sequential application", () => {
    const seed: ChatLine[] = [
      { id: "u", role: "user", text: "go" },
      { id: "a1", role: "assistant", text: "" },
    ];
    const seq = applyAssistantDelta(applyAssistantDelta(seed, "Hel", 1), "lo", 2);
    const once = applyAssistantDelta(seed, "Hello", 2);
    assert.equal(once[1]!.text, seq[1]!.text);
    assert.equal(once[1]!.raw, seq[1]!.raw);
    assert.equal(once.length, seq.length);

    const thSeq = applyThinkingDelta(applyThinkingDelta(seed, "th", 5), "ink", 6);
    const thOnce = applyThinkingDelta(seed, "think", 6);
    assert.equal(thOnce[thOnce.length - 1]!.text, thSeq[thSeq.length - 1]!.text);
    assert.equal(thOnce.length, thSeq.length);
  });
});

describe("createFrameBatcher", () => {
  it("applies queued items once per frame in order", () => {
    const sched = manualScheduler();
    const applied: number[][] = [];
    const b = createFrameBatcher<number>((items) => applied.push(items), sched);
    b.push(1);
    b.push(2);
    assert.equal(sched.pending(), 1);
    assert.deepEqual(applied, []);
    sched.fire();
    assert.deepEqual(applied, [[1, 2]]);
    b.push(3);
    sched.fire();
    assert.deepEqual(applied, [[1, 2], [3]]);
  });

  it("flush applies synchronously and cancels the pending frame", () => {
    const sched = manualScheduler();
    const applied: string[][] = [];
    const b = createFrameBatcher<string>((items) => applied.push(items), sched);
    b.push("a");
    b.flush();
    assert.deepEqual(applied, [["a"]]);
    assert.equal(sched.pending(), 0);
    b.flush();
    assert.deepEqual(applied, [["a"]]);
    sched.fire();
    assert.deepEqual(applied, [["a"]]);
  });

  it("cancel drops queued items", () => {
    const sched = manualScheduler();
    const applied: string[][] = [];
    const b = createFrameBatcher<string>((items) => applied.push(items), sched);
    b.push("a");
    b.cancel();
    assert.equal(b.size(), 0);
    sched.fire();
    b.flush();
    assert.deepEqual(applied, []);
  });
});
