/**
 * Run: pnpm exec tsx --test src/server/project-child-sessions.test.ts
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  mergeChildSessions,
  projectSessionsDir,
  runningHelperCount,
  scanSessionsDir,
  sessionExistsOnDisk,
} from "./project-child-sessions.js";

describe("project-child-sessions", () => {
  it("scans session.json and keeps parent", () => {
    const root = mkdtempSync(join(tmpdir(), "maou-child-scan-"));
    try {
      const dir = projectSessionsDir(root);
      const id = "child-1";
      mkdirSync(join(dir, id), { recursive: true });
      writeFileSync(
        join(dir, id, "session.json"),
        JSON.stringify({
          id,
          title: "ops → app",
          parent_session_id: "ops-1",
          updated_at: "2026-09-14T00:00:00.000Z",
          message_count: 2,
          lifetime: { userTurns: 1 },
        }),
      );
      const items = scanSessionsDir(dir, "project:/x:coding");
      assert.equal(items.length, 1);
      assert.equal(items[0]?.id, id);
      assert.equal(items[0]?.parentSessionId, "ops-1");
      assert.equal(items[0]?.switchId, "project:/x:coding");
      assert.equal(sessionExistsOnDisk(dir, id), true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("merges extras whose parent sits in the home list", () => {
    const home = [{ id: "ops-1", title: "ops", messageCount: 1, userTurns: 1 }];
    const extras = [
      { id: "coding-1", title: "ops → app", messageCount: 0, userTurns: 0, parentSessionId: "ops-1" },
      { id: "stray", title: "other", messageCount: 0, userTurns: 0, parentSessionId: "else" },
    ];
    const merged = mergeChildSessions(home, extras);
    assert.equal(merged.length, 2);
    assert.ok(merged.some((s) => s.id === "coding-1"));
    assert.ok(!merged.some((s) => s.id === "stray"));
  });

  it("counts running descendants", () => {
    const sessions = [
      { id: "ops-1", title: "ops", messageCount: 0, userTurns: 0 },
      { id: "c1", title: "a", messageCount: 0, userTurns: 0, parentSessionId: "ops-1" },
      { id: "c2", title: "b", messageCount: 0, userTurns: 0, parentSessionId: "ops-1" },
    ];
    assert.equal(runningHelperCount(sessions, "ops-1", new Set(["c1"])), 1);
  });
});
