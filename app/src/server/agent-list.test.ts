/**
 * Server agent-list pure mappers — ops list + presence + switch_id.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  agentPresenceKey,
  isCodingAgentIdentity,
  isAllowedSystemAgent,
  mapOpsEntriesToLiveAgents,
  mapRegistryEntriesToLiveAgents,
  parseAgentSwitchId,
  resolveDefaultSwitchId,
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
        // mis-labeled system coding must be dropped by mapper
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
          [agentPresenceKey("coding", "/Users/me/maou-sdk")]: {
            running: false,
          },
        },
      },
    );
    // system:main (coding 血统) 被丢弃 → ops + 2 project coding + explore = 4
    assert.ok(list.length >= 4);
    const ids = new Set(list.map((a) => a.id));
    assert.ok(ids.has("system:ops"));
    assert.ok(!ids.has("system:main"));
    assert.ok(!ids.has("system:coding"));
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

  it("coding agent identity never allowed as system", () => {
    assert.equal(isCodingAgentIdentity("coding"), true);
    assert.equal(isCodingAgentIdentity("ops", "ops"), false);
    assert.equal(isCodingAgentIdentity("main", "coding"), true);
    assert.equal(isAllowedSystemAgent("coding"), false);
    assert.equal(isAllowedSystemAgent("ops", "ops"), true);
  });

  it("mapOpsEntries drops coding mis-labeled as system", () => {
    const list = mapOpsEntriesToLiveAgents(
      [
        {
          name: "coding",
          display_name: "Coding Agent",
          role: "coding",
          group: "system",
          switch_id: "system:coding",
        },
        {
          name: "ops",
          display_name: "Ops Agent",
          role: "ops",
          group: "system",
          switch_id: "system:ops",
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
      ],
      { activeSwitchId: "system:ops" },
    );
    assert.ok(!list.some((a) => a.group === "system" && a.name === "coding"));
    assert.ok(!list.some((a) => a.id === "system:coding"));
    assert.ok(list.some((a) => a.id === "system:ops"));
    assert.ok(list.some((a) => a.id === "project:/Users/me/maou-sdk:coding"));
  });

  it("system agents use system:: presence keys (ops)", () => {
    const key = agentPresenceKey("ops", null);
    assert.equal(key, "system::ops");
    const list = mapOpsEntriesToLiveAgents(
      [
        {
          name: "ops",
          display_name: "Ops",
          role: "ops",
          group: "system",
          switch_id: "system:ops",
        },
      ],
      {
        activeSwitchId: "system:ops",
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

  it("resolveDefaultSwitchId never returns system:coding", () => {
    const r = resolveDefaultSwitchId("/tmp/some-proj", "coding");
    assert.notEqual(r.switchId, "system:coding");
    assert.ok(
      r.switchId.startsWith("project:") || r.switchId === "system:ops",
    );
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

  it("legacy registry map: coding forced to project, ops stays system", () => {
    const list = mapRegistryEntriesToLiveAgents(
      [
        { name: "coding", display_name: "Coding", role: "coding", scope: "global" },
        {
          name: "ops",
          display_name: "Ops",
          role: "ops",
          scope: "global",
        },
      ],
      { projectRoot: "/p", activeAgentName: "coding", agentBusy: true },
    );
    const coding = list.find((a) => a.name === "coding");
    const ops = list.find((a) => a.name === "ops");
    assert.ok(coding);
    assert.equal(coding!.group, "project");
    assert.ok(coding!.switchId.startsWith("project:"));
    assert.ok(ops);
    assert.equal(ops!.group, "system");
    assert.equal(ops!.switchId, "system:ops");
  });
});

describe("resolveDefaultSwitchId", () => {
  it("uses project: path when .maou/agents/<name> exists", async () => {
    const { mkdtempSync, mkdirSync, rmSync } = await import("node:fs");
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

  it("coding never becomes system:coding even without project tree", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { resolveDefaultSwitchId } = await import("./agent-list.ts");
    const root = mkdtempSync(join(tmpdir(), "maou-agent-sys-"));
    try {
      const d = resolveDefaultSwitchId(root, "coding");
      // 有 cwd 就 project:cwd:coding；绝不 system:coding
      assert.notEqual(d.switchId, "system:coding");
      assert.ok(
        d.switchId === `project:${root}:coding` || d.switchId === "system:ops",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("stationed affiliate agents are not switchable subjects", () => {
  it("isStationedAffiliateAgentName covers proactive", async () => {
    const { isStationedAffiliateAgentName } = await import("./agent-list.ts");
    assert.equal(isStationedAffiliateAgentName("proactive"), true);
    assert.equal(isStationedAffiliateAgentName("proactive-scan"), true);
    assert.equal(isStationedAffiliateAgentName("coding"), false);
    assert.equal(isStationedAffiliateAgentName("main"), false);
  });

  it("listOpsAgentsForWeb hides proactive next to coding", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import(
      "node:fs"
    );
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { listOpsAgentsForWeb } = await import("./agent-list.ts");
    const root = mkdtempSync(join(tmpdir(), "maou-stationed-"));
    const proj = join(root, "proj");
    try {
      mkdirSync(join(proj, ".maou", "agents", "coding"), { recursive: true });
      mkdirSync(join(proj, ".maou", "agents", "proactive"), { recursive: true });
      writeFileSync(
        join(proj, ".maou", "project.json"),
        JSON.stringify({ name: "proj" }),
      );
      const list = listOpsAgentsForWeb(root, [proj]);
      const names = list
        .filter((e) => e.project_path === proj)
        .map((e) => e.name);
      assert.ok(names.includes("coding"), "coding remains subject");
      assert.equal(
        names.includes("proactive"),
        false,
        "proactive must not be a switchable subject",
      );
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
