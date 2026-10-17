/**
 * ActivityAgentStore：后台派发列表。
 * Run: pnpm exec tsx --test src/server/activity-agents.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ACTIVITY_RETAIN_MS, ActivityAgentStore } from "./activity-agents.js";

function rec(over: Partial<import("./activity-agents.js").ActivityAgentRecord> = {}) {
  return {
    id: "a1",
    switchId: "project:/p:coding",
    agent: "coding",
    displayName: "Coding",
    sessionId: "sess-1",
    projectPath: "/p",
    projectName: "p",
    parentSessionId: "ops-1",
    status: "running" as const,
    startedAt: 10,
    ...over,
  };
}

describe("ActivityAgentStore", () => {
  it("lists running items and keeps done ones until retain expires", () => {
    const store = new ActivityAgentStore();
    store.upsert(rec());
    assert.equal(store.list(20).length, 1);
    store.complete("sess-1", "done", "ok", 30);
    const listed = store.list(30);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.status, "done");
    assert.equal(store.list(30 + ACTIVITY_RETAIN_MS + 1).length, 0);
  });

  it("completes by session id", () => {
    const store = new ActivityAgentStore();
    store.upsert(rec());
    const done = store.complete("sess-1", "failed", "boom", 40);
    assert.equal(done?.status, "failed");
    assert.equal(done?.summary, "boom");
  });
});
