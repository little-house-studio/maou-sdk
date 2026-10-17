/**
 * Run: pnpm exec tsx --test src/client/flush-queued-outbox.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  firstLeftoverQueued,
  replayLeftoverQueuedTurn,
} from "./flush-queued-outbox.ts";

describe("firstLeftoverQueued", () => {
  it("picks the first queued item that already has a server id", () => {
    const got = firstLeftoverQueued([
      { status: "failed", text: "x", queueId: 1 },
      { status: "queued", text: "no-id" },
      { status: "queued", text: "hello", queueId: 9 },
    ]);
    assert.deepEqual(got, { text: "hello", queueId: 9 });
  });

  it("skips empty text and missing queueId", () => {
    assert.equal(
      firstLeftoverQueued([{ status: "queued", text: "   ", queueId: 1 }]),
      null,
    );
    assert.equal(
      firstLeftoverQueued([{ status: "queued", text: "later" }]),
      null,
    );
  });
});

describe("replayLeftoverQueuedTurn", () => {
  it("starts a turn when the server still holds the item", async () => {
    const started: string[] = [];
    const result = await replayLeftoverQueuedTurn({
      items: [{ status: "queued", text: "接着说", queueId: 3 }],
      isCurrentSession: () => true,
      isBusy: () => false,
      removeQueueItem: async (id) => id === 3,
      startTurn: async (text) => {
        started.push(text);
      },
    });
    assert.deepEqual(result, { kind: "replayed", queueId: 3, text: "接着说" });
    assert.deepEqual(started, ["接着说"]);
  });

  it("does not start a turn when hub already took the item", async () => {
    const started: string[] = [];
    const result = await replayLeftoverQueuedTurn({
      items: [{ status: "queued", text: "接着说", queueId: 3 }],
      isCurrentSession: () => true,
      isBusy: () => false,
      removeQueueItem: async () => false,
      startTurn: async (text) => {
        started.push(text);
      },
    });
    assert.deepEqual(result, { kind: "already-taken", queueId: 3 });
    assert.deepEqual(started, []);
  });

  it("stays idle while the panel is still busy", async () => {
    const result = await replayLeftoverQueuedTurn({
      items: [{ status: "queued", text: "接着说", queueId: 3 }],
      isCurrentSession: () => true,
      isBusy: () => true,
      removeQueueItem: async () => {
        throw new Error("should not remove");
      },
      startTurn: async () => {
        throw new Error("should not start");
      },
    });
    assert.deepEqual(result, { kind: "idle" });
  });
});
