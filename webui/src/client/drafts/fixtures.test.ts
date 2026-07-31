/**
 * In-repo check of the shipped draft fixture module.
 * Run: tsx --test src/client/drafts/fixtures.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  REQUIRED_SCENARIO_IDS,
  SCENARIO_CATALOG,
  applyApprovalDecision,
  applyLocalSend,
  applyNewSession,
  assertCatalogComplete,
  getScenario,
  hydrateFromScenario,
  listScenarioIds,
  messagesForSession,
  pickSessionForAgent,
  sessionTitle,
  sessionsForAgent,
} from "./fixtures";
import { buildFileTree, fileIconKind } from "./file-tree";
import { buildAgentListRows } from "./agent-tree";

const here = dirname(fileURLToPath(import.meta.url));

describe("draft fixtures catalog", () => {
  it("lists every required scenario id", () => {
    const result = assertCatalogComplete();
    assert.equal(result.ok, true);
    for (const id of REQUIRED_SCENARIO_IDS) {
      assert.ok(result.ids.includes(id), `missing ${id}`);
    }
    assert.deepEqual(listScenarioIds().sort(), [...REQUIRED_SCENARIO_IDS].sort());
  });

  it("gives each session a messages entry (empty array only for empty_thread)", () => {
    for (const scenario of SCENARIO_CATALOG) {
      if (scenario.id === "empty_sessions") {
        assert.equal(scenario.sessions.length, 0);
        continue;
      }
      for (const session of scenario.sessions) {
        const msgs = scenario.messagesBySession[session.id];
        assert.ok(
          msgs !== undefined,
          `${scenario.id}/${session.id} missing messages array`,
        );
        if (scenario.id === "empty_thread") {
          assert.equal(msgs.length, 0);
        }
      }
    }
  });

  it("normal scenario has multi-message thread", () => {
    const s = getScenario("normal");
    const msgs = messagesForSession(
      s.messagesBySession,
      s.initialSessionId,
    );
    assert.ok(msgs.length >= 3);
    assert.ok(msgs.some((m) => m.role === "user"));
    assert.ok(msgs.some((m) => m.role === "assistant"));
  });

  it("busy scenario flags agentBusy and mixed thinking/tool", () => {
    const s = getScenario("busy");
    assert.equal(s.flags.agentBusy, true);
    const msgs = s.messagesBySession[s.initialSessionId];
    assert.ok(msgs.some((m) => m.role === "thinking"));
    assert.ok(msgs.some((m) => m.role === "tool"));
  });

  it("pending_approval exposes approval command", () => {
    const s = getScenario("pending_approval");
    assert.ok(s.flags.pendingApproval);
    assert.match(s.flags.pendingApproval!.command, /rm -rf/);
  });

  it("mixed_roles includes tool and err styles", () => {
    const s = getScenario("mixed_roles");
    const roles = new Set(
      s.messagesBySession[s.initialSessionId].map((m) => m.role),
    );
    for (const r of ["user", "assistant", "system", "tool", "err", "thinking"] as const) {
      assert.ok(roles.has(r), `missing role ${r}`);
    }
  });

  it("long_overflow message body is large enough to stress layout", () => {
    const s = getScenario("long_overflow");
    const bodies = s.messagesBySession[s.initialSessionId].map((m) => m.body);
    assert.ok(bodies.some((b) => b.length > 500));
  });

  it("empty_sessions starts with no active session", () => {
    const state = hydrateFromScenario("empty_sessions");
    assert.equal(state.sessions.length, 0);
    assert.equal(state.activeSessionId, "");
    assert.equal(messagesForSession(state.messagesBySession, "").length, 0);
  });
});

describe("draft pure helpers", () => {
  it("hydrateFromScenario clones mutable state", () => {
    const a = hydrateFromScenario("normal");
    const b = hydrateFromScenario("normal");
    a.sessions[0].title = "mutated";
    assert.notEqual(b.sessions[0].title, "mutated");
  });

  it("applyLocalSend appends user + echo on active session", () => {
    const base = hydrateFromScenario("normal");
    const before = messagesForSession(
      base.messagesBySession,
      base.activeSessionId,
    ).length;
    const next = applyLocalSend(base, "  hello draft  ", 1_700_000_000_000);
    const after = messagesForSession(
      next.messagesBySession,
      next.activeSessionId,
    );
    assert.equal(after.length, before + 2);
    assert.equal(after[after.length - 2].role, "user");
    assert.equal(after[after.length - 2].body, "hello draft");
    assert.equal(after[after.length - 1].role, "assistant");
    assert.match(after[after.length - 1].body, /hello draft/);
  });

  it("applyLocalSend creates a session when list is empty", () => {
    const base = hydrateFromScenario("empty_sessions");
    const next = applyLocalSend(base, "first message", 42);
    assert.equal(next.sessions.length, 1);
    assert.ok(next.activeSessionId);
    assert.equal(
      messagesForSession(next.messagesBySession, next.activeSessionId).length,
      2,
    );
  });

  it("applyNewSession prepends untitled session", () => {
    const base = hydrateFromScenario("normal");
    const next = applyNewSession(base, 99);
    assert.equal(next.sessions[0].title, "未命名草稿");
    assert.equal(next.activeSessionId, next.sessions[0].id);
    assert.equal(
      messagesForSession(next.messagesBySession, next.activeSessionId)[0]
        .role,
      "system",
    );
  });

  it("applyApprovalDecision clears pending and logs system note", () => {
    const base = hydrateFromScenario("pending_approval");
    assert.ok(base.pendingApproval);
    const next = applyApprovalDecision(base, "deny");
    assert.equal(next.pendingApproval, null);
    assert.equal(next.agentBusy, false);
    const msgs = messagesForSession(
      next.messagesBySession,
      next.activeSessionId,
    );
    assert.ok(msgs.some((m) => m.role === "system" && /拒绝/.test(m.body)));
  });

  it("sessionTitle returns null for missing id", () => {
    const s = getScenario("normal");
    assert.equal(sessionTitle(s.sessions, "nope"), null);
    assert.equal(
      sessionTitle(s.sessions, s.initialSessionId),
      s.sessions.find((x) => x.id === s.initialSessionId)!.title,
    );
  });

  it("sessionsForAgent filters to one agent and pickSession switches", () => {
    const s = getScenario("normal");
    const coding = sessionsForAgent(s.sessions, "coding");
    const ops = sessionsForAgent(s.sessions, "ops");
    assert.ok(coding.length >= 2);
    assert.ok(coding.every((x) => x.agent === "coding"));
    assert.equal(ops.length, 1);
    assert.equal(ops[0]!.agent, "ops");

    const keep = pickSessionForAgent(s.sessions, "coding", "s-normal-2");
    assert.equal(keep, "s-normal-2");
    const switchToOps = pickSessionForAgent(
      s.sessions,
      "ops",
      "s-normal-1",
    );
    assert.equal(switchToOps, "s-normal-3");
    assert.equal(pickSessionForAgent(s.sessions, "missing", "s-normal-1"), "");
  });
});

describe("agent-tree helpers (CLI-aligned)", () => {
  it("groups system/project and nests children with depth", () => {
    const rows = buildAgentListRows([
      {
        id: "system:ops",
        name: "ops",
        status: "idle",
        group: "system",
      },
      {
        id: "system:ops::monitor",
        name: "monitor",
        status: "idle",
        group: "system",
        parent: "ops",
      },
      {
        id: "project:/p:coding",
        name: "coding",
        status: "idle",
        group: "project",
        projectPath: "/p",
        projectName: "p",
      },
      {
        id: "project:/p:explore",
        name: "explore",
        status: "idle",
        group: "project",
        parent: "coding",
        projectPath: "/p",
      },
      {
        id: "project:/p:tester",
        name: "tester",
        status: "running",
        group: "project",
        parent: "coding",
        projectPath: "/p",
      },
    ]);
    const kinds = rows.map((r) => r.kind);
    assert.ok(kinds.includes("header"));
    const agents = rows.filter((r) => r.kind === "agent");
    assert.ok(agents.some((r) => r.kind === "agent" && r.depth === 0 && r.glyph === "◆"));
    assert.ok(agents.some((r) => r.kind === "agent" && r.depth === 1 && r.glyph === "◇"));
    // project: running child shown; idle children folded
    assert.ok(agents.some((r) => r.kind === "agent" && r.agent.name === "tester" && r.depth === 1));
    assert.ok(rows.some((r) => r.kind === "fold" && /未运行/.test(r.label)));
  });
});

describe("file-tree helpers", () => {
  it("builds nested VS Code–style tree from flat paths", () => {
    const tree = buildFileTree([
      "maou-agent/package.json *",
      "maou-agent/src/App.tsx",
      "maou-sdk/webui/README.md",
      "empty-dir/",
    ]);
    assert.equal(tree.length, 3);
    const agent = tree.find((n) => n.name === "maou-agent");
    assert.ok(agent && agent.kind === "folder");
    assert.ok(agent!.children?.some((c) => c.name === "package.json" && c.modified));
    assert.ok(agent!.children?.some((c) => c.name === "src" && c.kind === "folder"));
    const empty = tree.find((n) => n.name === "empty-dir");
    assert.ok(empty && empty.kind === "folder");
  });

  it("picks icon kinds by extension", () => {
    assert.equal(fileIconKind("App.tsx", false), "tsx");
    assert.equal(fileIconKind(".gitignore", false), "git");
    assert.equal(fileIconKind("src", true, true), "folder-open");
  });
});

describe("draft tree isolation", () => {
  it("draft modules do not import live api or ChatPanel", () => {
    const files = [
      "DraftShell.tsx",
      "fixtures.ts",
      "index.ts",
      "mock-data.ts",
      "layout/WireTopbar.tsx",
      "layout/ResizeHandle.tsx",
      "panels/AgentList.tsx",
      "panels/SessionList.tsx",
      "panels/BackgroundTasks.tsx",
      "panels/ContextPanel.tsx",
      "panels/ComposerBar.tsx",
      "panels/BottomInfoBar.tsx",
      "panels/FilesRail.tsx",
      "panels/ApprovalBanner.tsx",
      "file-tree.ts",
      "agent-tree.ts",
      "visual-marks.ts",
      "icons/Marks.tsx",
    ];
    const bannedImportRes = [
      /\bfrom\s+["'][^"']*\/api["']/,
      /\bfrom\s+["'][^"']*ChatPanel["']/,
      /\bfrom\s+["'][^"']*TerminalPanel["']/,
      /\bfetchMeta\b/,
      /fetch\s*\(\s*["'`]\/api\//,
    ];
    for (const rel of files) {
      const src = readFileSync(join(here, rel), "utf8");
      for (const re of bannedImportRes) {
        assert.equal(
          re.test(src),
          false,
          `${rel} must not match ${re}`,
        );
      }
    }
  });
});
