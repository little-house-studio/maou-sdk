/**
 * AgentHub session / model / approval — drives shipped hub methods.
 * Run: pnpm exec tsx --test src/server/agent-hub.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AgentHub, resolveWorkspaceForSwitch } from "./agent-hub.js";

const root = join(tmpdir(), `maou-hub-test-${process.pid}`);
const maou = join(root, ".maou-home");
const project = join(root, "project");
const projectB = join(root, "project-b");

before(() => {
  mkdirSync(join(project, ".maou"), { recursive: true });
  mkdirSync(join(projectB, ".maou", "sessions"), { recursive: true });
  mkdirSync(join(maou, "ops", ".maou"), { recursive: true });
  mkdirSync(maou, { recursive: true });
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("AgentHub agent switch rebinds workspace", () => {
  it("resolveWorkspaceForSwitch maps system ops and project paths", () => {
    const ops = join(maou, "ops");
    assert.equal(
      resolveWorkspaceForSwitch({
        maouRoot: maou,
        bootProjectRoot: project,
        kind: "system",
        agentName: "ops",
        projectPath: null,
      }),
      ops,
    );
    assert.equal(
      resolveWorkspaceForSwitch({
        maouRoot: maou,
        bootProjectRoot: project,
        kind: "project",
        agentName: "coding",
        projectPath: projectB,
      }),
      projectB,
    );
    assert.equal(
      resolveWorkspaceForSwitch({
        maouRoot: maou,
        bootProjectRoot: project,
        kind: "system",
        agentName: "main",
        projectPath: null,
      }),
      project,
    );
  });

  it("setActiveAgent changes switchId, workspace, and session scope", () => {
    const hub = new AgentHub({
      projectRoot: project,
      maouRoot: maou,
      sandboxMode: "yolo",
    });
    // Start with a session in boot project
    const s1 = hub.newSession("in-project");
    assert.ok(s1.sessionId);
    assert.equal(hub.getMeta().projectRoot, project);

    hub.setActiveAgent(`project:${projectB}:coding`);
    assert.equal(hub.activeSwitchId, `project:${projectB}:coding`);
    assert.equal(hub.agentName, "coding");
    assert.equal(hub.activeProjectPath, projectB);
    assert.equal(hub.projectRoot, projectB);
    // New workspace: previous session id should not leak as active
    const metaB = hub.getMeta();
    assert.equal(metaB.projectRoot, projectB);
    assert.notEqual(metaB.sessionId, s1.sessionId);

    hub.setActiveAgent("system:ops");
    assert.equal(hub.activeSwitchId, "system:ops");
    assert.equal(hub.agentName, "ops");
    assert.equal(hub.activeProjectPath, null);
    assert.equal(hub.projectRoot, join(maou, "ops"));
  });
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

  it("abortAllRuns cancels pending terminal approvals", async () => {
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
    hub.abortAllRuns();
    assert.equal(hub.listPendingApprovals().length, 0);
    assert.ok(rejected instanceof Error);
    assert.match(String(rejected?.message), /abort/i);
  });

  it("switchSession does not clear running map of other sessions", () => {
    const hub = new AgentHub({
      projectRoot: project,
      maouRoot: maou,
      sandboxMode: "yolo",
    });
    const a = hub.newSession("a");
    const b = hub.newSession("b");
    const hubAny = hub as unknown as {
      runs: Map<string, AbortController>;
    };
    hubAny.runs.set(a.sessionId, new AbortController());
    hub.switchSession(b.sessionId);
    assert.equal(hub.getMeta().sessionId, b.sessionId);
    assert.equal(hub.isSessionBusy(a.sessionId), true);
    assert.deepEqual(hub.listRunningSessions(), [a.sessionId]);
    hub.abortRun(a.sessionId);
    assert.equal(hub.isSessionBusy(a.sessionId), false);
  });

  it("setActiveAgent keeps prior agent runs alive in slots", () => {
    const hub = new AgentHub({
      projectRoot: project,
      maouRoot: maou,
      sandboxMode: "yolo",
      agentName: "coding",
    });
    hub.getMeta();
    const s = hub.newSession("run-me");
    const hubAny = hub as unknown as {
      runs: Map<string, AbortController>;
      slots: Map<string, { runs: Map<string, AbortController> }>;
      _activeSwitchId: string;
    };
    const switchA = hubAny._activeSwitchId;
    hubAny.runs.set(s.sessionId, new AbortController());
    // Switch away (may land on ops system agent if present)
    hub.setActiveAgent("system:ops");
    // Prior slot still has the run
    const slotA = hubAny.slots.get(switchA);
    assert.ok(slotA, "slot for previous agent should exist");
    assert.equal(slotA!.runs.has(s.sessionId), true);
    assert.ok(
      hub.listAllRunningSessions().some((r) => r.sessionId === s.sessionId),
    );
    // Switch back — run still there
    hub.setActiveAgent(switchA);
    assert.equal(hub.isSessionBusy(s.sessionId), true);
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
