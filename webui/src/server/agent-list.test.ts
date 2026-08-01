/**
 * Server agent-list pure mappers — ops list + presence + switch_id.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  agentPresenceKey,
  mapOpsEntriesToLiveAgents,
  mapRegistryEntriesToLiveAgents,
  parseAgentSwitchId,
  resolveLivePresenceStatus,
} from "./agent-list.ts";

describe("agent-list mappers (ops + presence)", () => {
  it("maps multi-project ops entries with unique switch_ids", () => {
    const list = mapOpsEntriesToLiveAgents(
      [
        {
          name: "ops",
          display_name: "Ops Agent",
          role: "ops",
          group: "system",
          switch_id: "system:ops",
        },
        {
          name: "main",
          display_name: "Coding Agent",
          role: "coding",
          group: "system",
          switch_id: "system:main",
        },
        {
          name: "coding",
          display_name: "maou-sdk",
          role: "coding",
          group: "project",
          project_path: "/Users/me/maou-sdk",
          project_name: "maou-sdk",
          switch_id: "project:/Users/me/maou-sdk:coding",
        },
        {
          name: "coding",
          display_name: "maou-agent",
          role: "coding",
          group: "project",
          project_path: "/Users/me/maou-agent",
          project_name: "maou-agent",
          switch_id: "project:/Users/me/maou-agent:coding",
        },
        {
          name: "explore",
          display_name: "explore",
          role: "subagent",
          parent: "coding",
          group: "project",
          project_path: "/Users/me/maou-sdk",
          project_name: "maou-sdk",
          switch_id: "project:/Users/me/maou-sdk:explore",
        },
      ],
      {
        activeSwitchId: "project:/Users/me/maou-sdk:coding",
        agentBusy: true,
        presence: {
          // CLI disk: system::coding is blocked+running
          [agentPresenceKey("coding", null)]: {
            running: true,
            blocked: true,
          },
          // project-scoped presence (optional)
          [agentPresenceKey("coding", "/Users/me/maou-sdk")]: {
            running: false,
          },
        },
      },
    );
    assert.ok(list.length >= 5);
    const ids = new Set(list.map((a) => a.id));
    assert.ok(ids.has("system:ops"));
    assert.ok(ids.has("project:/Users/me/maou-sdk:coding"));
    assert.ok(ids.has("project:/Users/me/maou-agent:coding"));
    // two project coding agents coexist
    assert.equal(list.filter((a) => a.name === "coding").length, 2);
    const active = list.find(
      (a) => a.switchId === "project:/Users/me/maou-sdk:coding",
    );
    assert.ok(active);
    assert.equal(active!.status, "running"); // busy + isCurrent
    const child = list.find((a) => a.name === "explore");
    assert.equal(child?.parent, "coding");
  });

  it("system agents use system:: presence keys (not projectRoot::name)", () => {
    const key = agentPresenceKey("coding", null);
    assert.equal(key, "system::coding");
    const list = mapOpsEntriesToLiveAgents(
      [
        {
          name: "coding",
          display_name: "Coding",
          group: "system",
          switch_id: "system:coding",
        },
      ],
      {
        activeSwitchId: "system:coding",
        hasPendingApproval: true,
        presence: {
          [key]: {
            running: true,
            blocked: true,
          },
        },
      },
    );
    assert.equal(list[0]!.status, "blocked");
  });

  it("non-current system agent reads system::coding blocked", () => {
    const list = mapOpsEntriesToLiveAgents(
      [
        {
          name: "coding",
          group: "system",
          switch_id: "system:coding",
        },
        {
          name: "ops",
          group: "system",
          switch_id: "system:ops",
        },
      ],
      {
        activeSwitchId: "system:ops",
        presence: {
          [agentPresenceKey("coding", null)]: {
            running: true,
            blocked: true,
          },
        },
      },
    );
    const coding = list.find((a) => a.name === "coding")!;
    assert.equal(coding.status, "blocked");
  });

  it("parseAgentSwitchId handles project paths with colons", () => {
    const p = parseAgentSwitchId("project:/Users/me/foo:coding");
    assert.ok(p);
    assert.equal(p!.kind, "project");
    assert.equal(p!.agentName, "coding");
    assert.equal(p!.projectPath, "/Users/me/foo");
    const s = parseAgentSwitchId("system:ops");
    assert.equal(s!.agentName, "ops");
  });

  it("resolveLivePresenceStatus covers blocked / done_unread", () => {
    assert.equal(
      resolveLivePresenceStatus(
        { blocked: true, running: true },
        { isCurrent: false },
      ),
      "blocked",
    );
    assert.equal(
      resolveLivePresenceStatus(
        { lastDoneAt: 100, lastViewedAt: 50 },
        { isCurrent: false },
      ),
      "done_unread",
    );
    assert.equal(
      resolveLivePresenceStatus({}, { isCurrent: true, agentBusy: true }),
      "running",
    );
  });

  it("legacy registry map still multi-agent", () => {
    const list = mapRegistryEntriesToLiveAgents(
      [
        { name: "coding", display_name: "Coding", role: "coding", scope: "global" },
        {
          name: "ops",
          display_name: "Ops",
          role: "ops",
          parent: "coding",
          scope: "global",
        },
      ],
      { projectRoot: "/p", activeAgentName: "coding", agentBusy: true },
    );
    assert.ok(list.length >= 2);
    assert.equal(list[0]!.switchId.startsWith("system:"), true);
  });
});

describe("resolveDefaultSwitchId", () => {
  it("uses project: path when .maou/agents/<name> exists", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import(
      "node:fs"
    );
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { resolveDefaultSwitchId } = await import("./agent-list.ts");
    const root = mkdtempSync(join(tmpdir(), "maou-agent-switch-"));
    try {
      mkdirSync(join(root, ".maou", "agents", "coding"), { recursive: true });
      const d = resolveDefaultSwitchId(root, "coding");
      assert.equal(d.switchId, `project:${root}:coding`);
      assert.equal(d.projectPath, root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses system: name when not a project tree", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { resolveDefaultSwitchId } = await import("./agent-list.ts");
    const root = mkdtempSync(join(tmpdir(), "maou-agent-sys-"));
    try {
      const d = resolveDefaultSwitchId(root, "coding");
      assert.equal(d.switchId, "system:coding");
      assert.equal(d.projectPath, null);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("listOpsAgentsForWeb ensureProjectPaths", () => {
  it("includes hub cwd not registered in projects.json", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import(
      "node:fs"
    );
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { listOpsAgentsForWeb } = await import("./agent-list.ts");
    const maou = mkdtempSync(join(tmpdir(), "maou-root-"));
    const proj = mkdtempSync(join(tmpdir(), "maou-unreg-"));
    try {
      mkdirSync(join(maou, "agents", "main"), { recursive: true });
      writeFileSync(
        join(maou, "agents", "main", "agent.json"),
        JSON.stringify({
          name: "main",
          display_name: "Main",
          role: "coding",
          scope: "system",
        }),
      );
      writeFileSync(
        join(maou, "projects.json"),
        JSON.stringify({ version: 1, projects: [] }),
      );
      mkdirSync(join(proj, ".maou", "agents", "coding"), { recursive: true });
      writeFileSync(
        join(proj, ".maou", "agents", "coding", "OVERVIEW.md"),
        "# coding\nworkspace agent\n",
      );

      const without = listOpsAgentsForWeb(maou);
      assert.equal(
        without.some((e) => e.switch_id === `project:${proj}:coding`),
        false,
      );

      const withEnsure = listOpsAgentsForWeb(maou, [proj]);
      const hit = withEnsure.find(
        (e) => e.switch_id === `project:${proj}:coding`,
      );
      assert.ok(hit, "unregistered project must appear via ensureProjectPaths");
      assert.equal(hit!.group, "project");
      assert.equal(hit!.name, "coding");
    } finally {
      rmSync(maou, { recursive: true, force: true });
      rmSync(proj, { recursive: true, force: true });
    }
  });
});
