/**
 * In-repo check of the shipped draft fixture module.
 * Run: tsx --test src/client/drafts/fixtures.test.ts
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  FULL_CONTEXT_MESSAGES,
  REQUIRED_SCENARIO_IDS,
  SCENARIO_CATALOG,
  SHOWCASE_REQUIRED_ROLES,
  applyApprovalDecision,
  applyLocalSend,
  applyNewSession,
  applyForkSession,
  applyChildSession,
  applyDraftSlash,
  assertCatalogComplete,
  assertContextShowcaseComplete,
  getScenario,
  hydrateFromScenario,
  inspectContextShowcase,
  listScenarioIds,
  messagesForSession,
  pickSessionForAgent,
  sessionTitle,
  sessionsForAgent,
} from "./fixtures";
import { groupThreadBlocks } from "../wire/thread/thread-blocks";
import { buildFileTree, fileIconKind } from "../wire/sidebar/file-tree";
import { buildAgentListRows } from "../wire/sidebar/agent-tree";

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

  it("default normal showcase inventory is complete (shipped assert)", () => {
    const inv = assertContextShowcaseComplete("normal");
    assert.equal(inv.agentBusy, true);
    assert.equal(inv.pendingApproval, true);
    assert.equal(inv.hasNestedReply, true);
    assert.equal(inv.hasOrphanInternals, true);
    assert.equal(inv.hasMarkdownHints, true);
    assert.ok(inv.hasBgTasks);
    assert.ok(inv.showFiles);
  });

  it("hydrateFromScenario(normal) preserves showcase inventory", () => {
    const state = hydrateFromScenario("normal");
    assert.equal(state.agentBusy, true);
    assert.ok(state.pendingApproval);
    assert.match(state.pendingApproval!.command, /rm -rf/);
    assert.ok(state.bgTasks.length >= 1);
    assert.equal(state.showFiles, true);
    assert.equal(state.showDiff, true);
    const msgs = messagesForSession(
      state.messagesBySession,
      state.activeSessionId,
    );
    assert.ok(msgs.length === FULL_CONTEXT_MESSAGES.length);
    const blocks = groupThreadBlocks(msgs);
    assert.ok(
      blocks.some(
        (b) =>
          b.kind === "reply" && b.assistant !== null && b.internals.length > 0,
      ),
      "nested assistant reply",
    );
    assert.ok(
      blocks.some(
        (b) =>
          b.kind === "reply" && b.assistant === null && b.internals.length > 0,
      ),
      "orphan internals",
    );
    assert.ok(blocks.some((b) => b.kind === "solo" && b.message.role === "user"));
    assert.ok(
      blocks.some((b) => b.kind === "solo" && b.message.role === "system"),
    );
  });

  it("non-empty catalog scenarios share full role inventory", () => {
    const nonempty = SCENARIO_CATALOG.filter(
      (s) => s.id !== "empty_thread" && s.id !== "empty_sessions",
    );
    for (const s of nonempty) {
      const inv = inspectContextShowcase(s.id);
      for (const r of SHOWCASE_REQUIRED_ROLES) {
        assert.ok(
          inv.roles.includes(r),
          `${s.id} missing role ${r}`,
        );
      }
      assert.ok(inv.hasNestedReply, `${s.id} nested`);
      assert.ok(inv.hasOrphanInternals, `${s.id} orphan`);
    }
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

  it("empty scenarios stay empty for empty-state UI", () => {
    const emptyThread = hydrateFromScenario("empty_thread");
    assert.ok(emptyThread.sessions.length > 0);
    assert.equal(
      messagesForSession(
        emptyThread.messagesBySession,
        emptyThread.activeSessionId,
      ).length,
      0,
    );
    assert.equal(emptyThread.agentBusy, false);
    assert.equal(emptyThread.pendingApproval, null);

    const emptySessions = hydrateFromScenario("empty_sessions");
    assert.equal(emptySessions.sessions.length, 0);
    assert.equal(emptySessions.activeSessionId, "");
    assert.equal(
      messagesForSession(emptySessions.messagesBySession, "").length,
      0,
    );
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

  it("applyLocalSend keeps image chips on the user line", () => {
    const base = hydrateFromScenario("normal");
    const next = applyLocalSend(base, "", 99, [
      { mimeType: "image/png", data: "AAA", name: "a.png" },
    ]);
    const msgs = messagesForSession(
      next.messagesBySession,
      next.activeSessionId,
    );
    const user = msgs[msgs.length - 2];
    assert.equal(user?.role, "user");
    assert.equal(user?.images?.length, 1);
    assert.match(msgs[msgs.length - 1]!.body, /附图/);
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

  it("applyForkSession copies parent messages and links parent", () => {
    const base = hydrateFromScenario("normal");
    const parentId = base.activeSessionId;
    const next = applyForkSession(base, parentId, 77);
    assert.ok(next.activeSessionId.includes("::fork::"));
    const child = next.sessions.find((s) => s.id === next.activeSessionId);
    assert.equal(child?.parentSessionId, parentId);
    assert.ok((child?.title || "").includes("派生"));
  });

  it("applyChildSession creates empty child under parent", () => {
    const base = hydrateFromScenario("normal");
    const parentId = base.activeSessionId;
    const next = applyChildSession(base, parentId, 88);
    const child = next.sessions.find((s) => s.id === next.activeSessionId);
    assert.equal(child?.title, "子会话");
    assert.equal(child?.parentSessionId, parentId);
  });

  it("applyDraftSlash /new creates a session", () => {
    const base = hydrateFromScenario("normal");
    const next = applyDraftSlash(base, "/new", 101);
    assert.ok(next);
    assert.equal(next!.sessions[0].title, "未命名草稿");
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
      "maou-sdk/app/README.md",
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
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          files.push(relative(here, p));
        }
      }
    };
    walk(here);
    assert.ok(files.length > 0, "draft station should have source files");
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
