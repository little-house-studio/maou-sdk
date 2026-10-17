import assert from "node:assert/strict";
import { test } from "node:test";
import { abortChat, stopTerminal } from "./api";

for (const [name, mutate] of [
  ["abort chat", () => abortChat("s1")],
  ["stop terminal", () => stopTerminal("t1", "coding")],
] as const) {
  test(`${name} rejects HTTP and application failures instead of reporting success`, async (t) => {
    const fetchMock = t.mock.method(globalThis, "fetch");
    for (const status of [500, 200]) {
      fetchMock.mock.mockImplementation(async () => Response.json({ ok: false, error: "stop failed" }, { status }));
      await assert.rejects(mutate(), /stop failed/);
    }
    fetchMock.mock.mockImplementation(async () => Response.json({ ok: true }));
    await assert.doesNotReject(mutate());
  });
}

test("queue APIs carry session and request identity and allow an already-consumed delete", async (t) => {
  const { enqueueChat, fetchChatQueue, clearChatQueue, removeChatQueueItem, updateChatQueueItem, streamChat } = await import("./api");
  const requests: Array<{ url: string; body: any }> = [];
  const snapshot = { ok: true, sessionId: "s/a", busy: false, capacity: 64, queue: [] };
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (String(url) === "/api/chat") return new Response('{"type":"done"}\n', { headers: { "Content-Type": "application/x-ndjson" } });
    return Response.json({ ...snapshot, id: 1, removed: false, updated: false, cleared: 1 });
  });
  await enqueueChat("same", "queue", { sessionId: "s/a", requestId: "stable-request" });
  await fetchChatQueue("s/a");
  assert.equal(await removeChatQueueItem(1, "s/a"), false);
  assert.equal((await updateChatQueueItem(1, { message: "edit", move: "up" }, "s/a")).updated, false);
  await clearChatQueue("s/a", [1, 2]);
  for await (const _ of streamChat("", undefined, undefined, { sessionId: "s/a", resumeQueue: true })) { /* drain */ }
  assert.deepEqual(requests[0].body, { message: "same", mode: "queue", sessionId: "s/a", requestId: "stable-request" });
  assert.ok(requests.slice(1, 5).every(r => r.url.endsWith("?sessionId=s%2Fa")));
  assert.deepEqual(requests[4].body, { ids: [1, 2] });
  assert.deepEqual(requests[5].body, { message: "", sessionId: "s/a", resumeQueue: true });
});
