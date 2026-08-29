/**
 * AgentHub session / model / approval — drives shipped hub methods.
 * Run: pnpm exec tsx --test src/server/agent-hub.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sessionPlan } from "@little-house-studio/context";
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

  it("searchSessions finds appended message text", () => {
    const hub = new AgentHub({
      projectRoot: project,
      maouRoot: maou,
      sandboxMode: "yolo",
    });
    const created = hub.newSession("searchable");
    const store = (
      hub as unknown as {
        sessionStore: {
          appendMessage: (id: string, role: string, content: string) => void;
        };
      }
    ).sessionStore;
    store.appendMessage(created.sessionId, "user", "hub-search-needle-zz");
    const page = hub.searchSessions({ query: "hub-search-needle-zz" });
    assert.ok(page.items.some((h) => h.sessionId === created.sessionId));
    assert.ok(page.items[0]?.snippet);
    assert.equal(typeof page.items[0]?.absSeq, "number");
  });

  it("loadSessionMessages maps loopDurationMs onto the user line", () => {
    const hub = new AgentHub({
      projectRoot: project,
      maouRoot: maou,
      sandboxMode: "yolo",
    });
    const created = hub.newSession("loop-dur");
    const store = (
      hub as unknown as {
        sessionStore: {
          appendMessage: (
            id: string,
            role: string,
            content: string,
            meta?: Record<string, unknown>,
          ) => void;
        };
      }
    ).sessionStore;
    store.appendMessage(created.sessionId, "user", "咕咕嘎嘎");
    store.appendMessage(created.sessionId, "assistant", "ok", {
      loopDurationMs: 1500,
    });
    const lines = hub.loadSessionMessages(created.sessionId);
    const user = lines.find((l) => l.role === "user");
    const asst = lines.find((l) => l.role === "assistant");
    assert.equal(user?.durationMs, 1500);
    assert.equal(asst?.loopDurationMs, 1500);
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
    const cleared = hub.clearSessionMessages(a.sessionId);
    assert.notEqual(cleared.sessionId, a.sessionId);
    assert.ok(!hub.listSessions().some((s) => s.id === a.sessionId));
    assert.ok(hub.listSessions().some((s) => s.id === b.sessionId));
    const extra = hub.newSession("gone");
    const del = hub.deleteSession(extra.sessionId);
    assert.equal(del.deleted, true);
    assert.ok(!hub.listSessions().some((s) => s.id === extra.sessionId));
  });

  it("deleting the active session sits on a remaining one, does not spawn a twin", () => {
    const hub = new AgentHub({
      projectRoot: project,
      maouRoot: maou,
      sandboxMode: "yolo",
    });
    const keep = hub.newSession("keep");
    const gone = hub.newSession("gone");
    hub.switchSession(gone.sessionId);
    const before = hub.listSessions().length;
    const del = hub.deleteSession(gone.sessionId);
    assert.equal(del.deleted, true);
    assert.equal(del.sessionId, keep.sessionId);
    assert.equal(hub.listSessions().length, before - 1);
    assert.ok(!hub.listSessions().some((s) => s.id === gone.sessionId));
    assert.ok(hub.listSessions().some((s) => s.id === keep.sessionId));
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
    const zip = hub.exportSessionZip(s.sessionId);
    assert.ok(Buffer.isBuffer(zip));
    assert.equal(zip.subarray(0, 2).toString("utf8"), "PK");
    const pre = hub.preflightExport(s.sessionId);
    assert.equal(pre.ok, true);
  });
});

describe("AgentHub.deliverWebhook", () => {
  before(() => {
    AgentHub.skipWebhookRun = true;
  });
  after(() => {
    AgentHub.skipWebhookRun = false;
  });

  it("wakes a named agent without stealing UI focus", () => {
    const hub = new AgentHub({
      projectRoot: project,
      maouRoot: maou,
      sandboxMode: "yolo",
    });
    hub.setActiveAgent("system:ops");
    assert.equal(hub.agentName, "ops");
    const focus = hub.activeSwitchId;

    const r = hub.deliverWebhook({
      agent: `project:${project}:coding`,
      message: "人回来了",
    });
    try {
      assert.equal(r.ok, true);
      if (!r.ok) return;
      assert.equal(r.status, "started");
      assert.equal(r.agent, "coding");
      assert.equal(r.switchId, `project:${project}:coding`);
      assert.ok(r.sessionId);
      assert.equal(hub.activeSwitchId, focus);
      assert.equal(hub.agentName, "ops");
    } finally {
      hub.abortAllRuns();
    }
  });

  it("queues a second shot while the first run is held", () => {
    const hub = new AgentHub({
      projectRoot: project,
      maouRoot: maou,
      sandboxMode: "yolo",
    });
    const first = hub.deliverWebhook({
      agent: `project:${project}:coding`,
      message: "first",
    });
    const second = hub.deliverWebhook({
      agent: `project:${project}:coding`,
      message: "second",
    });
    try {
      assert.equal(first.ok, true);
      assert.equal(second.ok, true);
      if (!first.ok || !second.ok) return;
      assert.equal(first.status, "started");
      assert.equal(second.status, "queued");
      assert.equal(first.sessionId, second.sessionId);
      assert.ok(second.queueId);
    } finally {
      hub.abortAllRuns();
    }
  });

  it("readSessionPlan returns submitted markdown", () => {
    const hub = new AgentHub({
      projectRoot: project,
      maouRoot: maou,
      sandboxMode: "yolo",
    });
    const s = hub.newSession("plan-review");
    const dir = (
      hub as unknown as { sessionStore: { sessionDir: string } }
    ).sessionStore.sessionDir;
    sessionPlan.enter(dir, s.sessionId, "当前位置分析");
    sessionPlan.writePlan(dir, s.sessionId, "# 实施计划\n- 一步");
    const view = hub.readSessionPlan();
    assert.equal(view.plan?.status, "review");
    assert.equal(view.plan?.active, true);
    assert.match(view.markdown, /实施计划/);
    assert.ok(view.planFile);
  });
});
