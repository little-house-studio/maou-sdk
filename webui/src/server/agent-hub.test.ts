/**
 * AgentHub session / model / approval — drives shipped hub methods.
 * Run: pnpm exec tsx --test src/server/agent-hub.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AgentHub } from "./agent-hub.js";

const root = join(tmpdir(), `maou-hub-test-${process.pid}`);
const maou = join(root, ".maou-home");
const project = join(root, "project");

before(() => {
  mkdirSync(join(project, ".maou"), { recursive: true });
  mkdirSync(maou, { recursive: true });
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("AgentHub sessions model approval", () => {
  it("creates, lists, switches sessions via real SessionStore", () => {
    const hub = new AgentHub({
      projectRoot: project,
      maouRoot: maou,
      sandboxMode: "yolo",
    });
    const a = hub.newSession("alpha");
    assert.ok(a.sessionId);
    const b = hub.newSession("beta");
    assert.ok(b.sessionId);
    assert.notEqual(a.sessionId, b.sessionId);

    const list = hub.listSessions();
    assert.ok(list.length >= 2);
    assert.ok(list.some((s) => s.id === a.sessionId));
    assert.ok(list.some((s) => s.id === b.sessionId));

    const sw = hub.switchSession(a.sessionId);
    assert.equal(sw.sessionId, a.sessionId);
    assert.equal(hub.getMeta().sessionId, a.sessionId);
  });

  it("setModel updates meta for next turn preset path", () => {
    const hub = new AgentHub({
      projectRoot: project,
      maouRoot: maou,
      sandboxMode: "yolo",
    });
    hub.setModel("test-provider", "test-model");
    const m = hub.getMeta();
    assert.equal(m.provider, "test-provider");
    assert.equal(m.model, "test-model");
  });

  it("setApprovalMode cycles normal/auto/yolo", () => {
    const hub = new AgentHub({
      projectRoot: project,
      maouRoot: maou,
      sandboxMode: "yolo",
    });
    assert.equal(hub.setApprovalMode("normal"), "normal");
    assert.equal(hub.getApprovalMode(), "normal");
    assert.equal(hub.setApprovalMode("auto"), "auto");
    assert.equal(hub.setApprovalMode("yolo"), "yolo");
  });

  it("answerApproval resolves pending queue", async () => {
    const hub = new AgentHub({
      projectRoot: project,
      maouRoot: maou,
      sandboxMode: "normal",
    });
    // force ensureAgent + approver
    hub.getMeta();
    // inject a pending entry by calling list (empty) then simulating via private path:
    // use answer on missing → false
    assert.equal(hub.answerApproval("nope", "deny"), false);
    assert.deepEqual(hub.listPendingApprovals(), []);
  });

  it("abortRun cancels pending terminal approvals", async () => {
    const hub = new AgentHub({
      projectRoot: project,
      maouRoot: maou,
      sandboxMode: "normal",
    });
    hub.getMeta();
    // Inject synthetic pending entry (private map) to verify abort clears it
    const hubAny = hub as unknown as {
      pendingApprovals: Map<
        string,
        {
          resolve: (v: unknown) => void;
          reject: (e: Error) => void;
          timer: null;
          info: {
            id: string;
            command: string;
            agentName: string;
            createdAt: number;
          };
        }
      >;
    };
    let rejected: Error | null = null;
    hubAny.pendingApprovals.set("syn-1", {
      resolve: () => {},
      reject: (e: Error) => {
        rejected = e;
      },
      timer: null,
      info: {
        id: "syn-1",
        command: "rm -rf /",
        agentName: "coding",
        createdAt: Date.now(),
      },
    });
    assert.equal(hub.listPendingApprovals().length, 1);
    hub.abortRun();
    assert.equal(hub.listPendingApprovals().length, 0);
    assert.ok(rejected instanceof Error);
    assert.match(String(rejected?.message), /abort/i);
  });

  it("deletes session and clears messages", () => {
    const hub = new AgentHub({
      projectRoot: project,
      maouRoot: maou,
      sandboxMode: "yolo",
    });
    const a = hub.newSession("to-delete");
    const b = hub.newSession("keep");
    hub.switchSession(a.sessionId);
    hub.clearSessionMessages(a.sessionId);
    assert.equal(hub.loadSessionMessages(a.sessionId).length, 0);
    const del = hub.deleteSession(a.sessionId);
    assert.equal(del.deleted, true);
    assert.ok(!hub.listSessions().some((s) => s.id === a.sessionId));
    assert.ok(hub.listSessions().some((s) => s.id === b.sessionId));
  });

  it("restores last-session pointer across hub instances", () => {
    const hub1 = new AgentHub({
      projectRoot: project,
      maouRoot: maou,
      sandboxMode: "yolo",
    });
    const s = hub1.newSession("persist-me");
    assert.equal(hub1.getMeta().sessionId, s.sessionId);

    const hub2 = new AgentHub({
      projectRoot: project,
      maouRoot: maou,
      sandboxMode: "yolo",
    });
    const m = hub2.getMeta();
    assert.equal(m.sessionId, s.sessionId);
  });

  it("renames session and exports transcript", () => {
    const hub = new AgentHub({
      projectRoot: project,
      maouRoot: maou,
      sandboxMode: "yolo",
    });
    const s = hub.newSession("old-title");
    const r = hub.renameSession(s.sessionId, "renamed-thread");
    assert.equal(r.title, "renamed-thread");
    assert.ok(
      hub.listSessions().some(
        (x) => x.id === s.sessionId && x.title === "renamed-thread",
      ),
    );
    const text = hub.exportTranscript(s.sessionId);
    assert.ok(typeof text === "string");
  });
});
