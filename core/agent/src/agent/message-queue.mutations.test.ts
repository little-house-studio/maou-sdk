import { describe, expect, it } from "vitest";
import { MessageQueue } from "./message-queue.js";

describe("pending message mutations", () => {
  it("rejects overflow without dropping the oldest message", () => {
    const queue = new MessageQueue({ maxQueuePerSession: 2 });
    queue.enqueue("a", "first"); queue.enqueue("a", "second");
    expect(() => queue.enqueue("a", "third")).toThrow(/队列已满/);
    expect(queue.list("a").map(m => m.message)).toEqual(["first", "second"]);
  });
  it("deduplicates retries before and after claim without repeating interruption", () => {
    const interrupts: string[] = [];
    const queue = new MessageQueue({ onInterrupt: sid => interrupts.push(sid) });
    const options = { requestId: "request", mode: "interrupt_immediately" as const };
    const first = queue.enqueue("a", "same", options);
    expect(queue.enqueue("a", "same", options).id).toBe(first.id);
    expect(queue.size("a")).toBe(1);
    queue.takeNext("a");
    expect(queue.enqueue("a", "same", options).id).toBe(first.id);
    expect(queue.size("a")).toBe(0);
    expect(interrupts).toEqual(["a"]);
    expect(queue.enqueue("b", "same", options).id).not.toBe(first.id);
  });
  it("does not resurrect a cancelled request", () => {
    const queue = new MessageQueue();
    const first = queue.enqueue("a", "same", { requestId: "request" });
    queue.remove("a", first.id);
    expect(queue.enqueue("a", "same", { requestId: "request" }).id).toBe(first.id);
    expect(queue.size("a")).toBe(0);
  });
  it("edits, reorders and promotes atomically, preserving stable identity", () => {
    const interrupts: string[] = [];
    const queue = new MessageQueue({ onInterrupt: sid => interrupts.push(sid) });
    const a = queue.enqueue("s", "same");
    const b = queue.enqueue("s", "same");
    expect(queue.update("s", b.id, { message: "edited", move: "up", mode: "interrupt_immediately" })).toBe(true);
    expect(queue.list("s").map(m => [m.id, m.message])).toEqual([[b.id, "edited"], [a.id, "same"]]);
    expect(interrupts).toEqual(["s"]);
    queue.takeNext("s");
    expect(queue.update("s", b.id, { message: "resurrect" })).toBe(false);
    expect(queue.update("other", a.id, { move: "up" })).toBe(false);
    expect(queue.size("s")).toBe(1);
  });
  it("snapshot edits cannot mutate the underlying queue", () => {
    const queue = new MessageQueue();
    queue.enqueue("s", "original", { requestId: "r" });
    const snapshot = queue.list("s"); snapshot[0]!.message = "bad"; snapshot[0]!.metadata.requestId = "bad";
    expect(queue.list("s")[0]).toMatchObject({ message: "original", metadata: { requestId: "r" } });
  });
  it("insertion leaves normal waiting messages for their round boundary", () => {
    const queue = new MessageQueue();
    const a = queue.enqueue("s", "later", { mode: "after_round_complete" });
    const b = queue.enqueue("s", "now", { mode: "interrupt_immediately" });
    expect(queue.dequeueIfReady("s", "loop_end", { aborted: true, interruptOnly: true }).map(m => m.id)).toEqual([b.id]);
    expect(queue.list("s").map(m => m.id)).toEqual([a.id]);
  });
});

it("routes interruption to the session owner across multiple runtimes", () => {
  const queue = new MessageQueue();
  const calls: string[] = [];
  const releaseA = queue.bindInterrupt("a", () => calls.push("a"));
  const releaseB = queue.bindInterrupt("b", () => calls.push("b"));
  queue.enqueue("a", "one", { mode: "interrupt_immediately" });
  const second = queue.enqueue("b", "two");
  queue.update("b", second.id, { mode: "interrupt_immediately" });
  releaseB();
  queue.enqueue("a", "three", { mode: "interrupt_immediately" });
  releaseA();
  queue.enqueue("a", "four", { mode: "interrupt_immediately" });
  expect(calls).toEqual(["a", "b", "a"]);
});
