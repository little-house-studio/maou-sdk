import assert from "node:assert/strict";
import { test } from "node:test";
import { reconcileQueue, type OutboxItem } from "./chat-queue";
const remote = (id: number, requestId?: string) => ({ id, requestId, message: "相同内容", mode: "after_round_complete", source: "app", enqueuedAt: 1 });
test("equal text is never treated as equal identity", () => {
  assert.deepEqual(reconcileQueue([], [remote(1), remote(2)], new Set([1])).map(m => m.queueId), [2]);
});
test("a server acknowledgement recovers a failed request without duplication", () => {
  const local: OutboxItem[] = [{ localId: "request", text: "相同内容", status: "failed", mode: "queue", error: "timeout" }];
  assert.deepEqual(reconcileQueue(local, [remote(1, "request")]).map(m => [m.localId, m.status, m.error]), [["request", "queued", undefined]]);
});
test("authoritative order wins while unsent drafts are preserved", () => {
  const local: OutboxItem[] = [{ localId: "draft", text: "new", status: "failed", mode: "queue" }];
  assert.deepEqual(reconcileQueue(local, [remote(2), remote(1)]).map(m => m.localId), ["queue-2", "queue-1", "draft"]);
});
test("an old acknowledgement cannot resurrect a consumed item", () => {
  assert.deepEqual(reconcileQueue([], [remote(1, "request")], new Set([1])), []);
});
