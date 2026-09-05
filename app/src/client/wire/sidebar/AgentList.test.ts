import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AgentList,
  branchRoster,
  buildImInbox,
  buildProjectGroups,
  buildSystemGroups,
  compactProjectPath,
  groupAgentCount,
  pickCurrentGroup,
} from "./AgentList";
import type { DraftAgent } from "../types";

const here = dirname(fileURLToPath(import.meta.url));

function agent(
  over: Partial<DraftAgent> & Pick<DraftAgent, "id" | "name" | "status">,
): DraftAgent {
  return {
    role: "coding",
    group: "system",
    ...over,
  };
}

describe("buildImInbox", () => {
  it("drops stale and ranks needs_reply first", () => {
    const rows = buildImInbox([
      agent({ id: "a", name: "alpha", status: "idle" }),
      agent({ id: "b", name: "bravo", status: "needs_reply" }),
      agent({ id: "c", name: "charlie", status: "running", stale: true }),
      agent({ id: "d", name: "delta", status: "blocked" }),
    ]);
    assert.deepEqual(
      rows.map((a) => a.id),
      ["b", "d", "a"],
    );
  });
});

describe("project desk", () => {
  const appRoot = agent({
    id: "p:app",
    name: "app",
    displayName: "app",
    status: "idle",
    group: "project",
    projectName: "app",
    projectPath: "/tmp/app",
  });
  const reviewer = agent({
    id: "p:reviewer",
    name: "reviewer",
    displayName: "reviewer",
    status: "idle",
    group: "project",
    parent: "app",
    projectName: "app",
    projectPath: "/tmp/app",
  });
  const piRoot = agent({
    id: "p:pi",
    name: "pi",
    displayName: "pi",
    status: "running",
    group: "project",
    projectName: "pi",
    projectPath: "/tmp/pi",
  });
  const sdkRoot = agent({
    id: "p:coding",
    name: "coding",
    displayName: "coding",
    status: "idle",
    group: "project",
    projectName: "maou-sdk",
    projectPath: "/tmp/maou-sdk",
  });
  const explore = agent({
    id: "p:explore",
    name: "explore",
    displayName: "explore",
    status: "idle",
    group: "project",
    parent: "coding",
    projectName: "maou-sdk",
    projectPath: "/tmp/maou-sdk",
  });

  it("pickCurrentGroup follows the active agent, else first group", () => {
    const groups = buildProjectGroups([appRoot, reviewer, piRoot]);
    assert.equal(pickCurrentGroup(groups, "p:pi")?.label, "pi");
    assert.equal(pickCurrentGroup(groups, "p:reviewer")?.label, "app");
    assert.equal(pickCurrentGroup(groups, "missing")?.label, groups[0]?.label);
  });

  it("hides a root that repeats the workspace name", () => {
    const groups = buildProjectGroups([appRoot, reviewer]);
    const branch = groups[0]!.branches[0]!;
    const roster = branchRoster(branch, "app");
    assert.equal(roster.showRoot, false);
    assert.deepEqual(
      roster.children.map((c) => c.name),
      ["reviewer"],
    );
    assert.equal(groupAgentCount(groups[0]!), 1);
  });

  it("hides coding; extras stay on the roster", () => {
    const groups = buildProjectGroups([sdkRoot, explore]);
    const roster = branchRoster(groups[0]!.branches[0]!, "maou-sdk");
    assert.equal(roster.showRoot, false);
    assert.deepEqual(
      roster.children.map((c) => c.name),
      ["explore"],
    );
    assert.equal(groupAgentCount(groups[0]!), 1);
  });

  it("hides coding even when displayName was aliased to the folder name", () => {
    const coding = agent({
      id: "p:coding",
      name: "coding",
      displayName: "app",
      status: "idle",
      group: "project",
      projectName: "app",
      projectPath: "/tmp/app",
    });
    const stray = agent({
      id: "p:reviewer",
      name: "reviewer",
      displayName: "reviewer",
      status: "idle",
      group: "project",
      parent: "coding",
      projectName: "app",
      projectPath: "/tmp/app",
    });
    const groups = buildProjectGroups([coding, stray]);
    const roster = branchRoster(groups[0]!.branches[0]!, "app");
    assert.equal(roster.showRoot, false);
    const html = renderToStaticMarkup(
      createElement(AgentList, {
        agents: [coding, stray],
        activeId: "p:coding",
        onSelect: () => {},
      }),
    );
    assert.equal(/wire-agent-name">coding/.test(html), false);
    assert.match(html, /wire-agent-name">reviewer/);
  });

  it("renders a workspace switcher, not a host tree", () => {
    const html = renderToStaticMarkup(
      createElement(AgentList, {
        agents: [appRoot, reviewer, piRoot],
        activeId: "p:app",
        onSelect: () => {},
      }),
    );
    assert.match(html, /wire-agent-desk/);
    assert.match(html, /wire-agent-switch/);
    assert.match(html, /wire-agent-switch-bar/);
    assert.match(html, /aria-label="切换工作区，共 2 个"/);
    assert.match(html, /wire-agent-name">reviewer/);
    assert.doesNotMatch(html, /wire-agent-host-head/);
    assert.doesNotMatch(html, /wire-agent-tree-rail/);
    const items = html.match(/wire-agent-item/g) ?? [];
    assert.equal(items.length, 1);
    assert.doesNotMatch(html, /增加项目/);
    assert.match(html, /wire-agent-switch-path/);
    assert.match(html, /\/tmp\/app/);
  });

  it("shows add-project when the host passes a handler", () => {
    const html = renderToStaticMarkup(
      createElement(AgentList, {
        agents: [appRoot, reviewer, piRoot],
        activeId: "p:app",
        onSelect: () => {},
        onAddProject: () => {},
      }),
    );
    assert.match(html, /aria-label="增加项目"/);
    assert.match(html, /wire-agent-switch-add/);
    assert.doesNotMatch(html, /wire-agent-switch-opt is-add/);
  });

  it("splits same-name workspaces by path", () => {
    const other = agent({
      id: "p:app2",
      name: "app",
      displayName: "app",
      status: "idle",
      group: "project",
      projectName: "app",
      projectPath: "/var/app",
    });
    const groups = buildProjectGroups([appRoot, other]);
    assert.equal(groups.length, 2);
    assert.deepEqual(
      groups.map((g) => g.path).sort(),
      ["/tmp/app", "/var/app"],
    );
  });
});

describe("hides install from manager roster", () => {
  const ops = agent({
    id: "system:ops",
    name: "ops",
    displayName: "Ops Agent",
    status: "idle",
    group: "system",
  });
  const install = agent({
    id: "system:install",
    name: "install",
    displayName: "Install Agent",
    status: "idle",
    group: "system",
  });

  it("drops install from system / IM / project groups", () => {
    assert.deepEqual(
      buildSystemGroups([ops, install]).flatMap((g) =>
        g.branches.map((b) => b.root.name),
      ),
      ["ops"],
    );
    assert.deepEqual(
      buildImInbox([ops, install]).map((a) => a.name),
      ["ops"],
    );
    const child = agent({
      id: "p:install",
      name: "install",
      displayName: "Install Agent",
      status: "idle",
      group: "project",
      parent: "app",
      projectName: "app",
      projectPath: "/tmp/app",
    });
    const groups = buildProjectGroups([
      agent({
        id: "p:app",
        name: "app",
        displayName: "app",
        status: "idle",
        group: "project",
        projectName: "app",
        projectPath: "/tmp/app",
      }),
      child,
    ]);
    assert.deepEqual(groups[0]!.branches[0]!.children.map((c) => c.name), []);
  });

  it("system desk does not render Install Agent", () => {
    const html = renderToStaticMarkup(
      createElement(AgentList, {
        agents: [ops, install],
        activeId: "system:ops",
        onSelect: () => {},
      }),
    );
    assert.match(html, /Ops Agent/);
    assert.doesNotMatch(html, /Install Agent/);
    assert.doesNotMatch(html, /wire-agent-name">install/);
  });
});

describe("compactProjectPath", () => {
  it("rewrites home prefixes to tilde", () => {
    assert.equal(
      compactProjectPath("/Users/mac/Documents/vscodeProject/app"),
      "~/Documents/vscodeProject/app",
    );
    assert.equal(compactProjectPath("/home/user/pi"), "~/pi");
    assert.equal(compactProjectPath("/tmp/app"), "/tmp/app");
  });
});

describe("agent desk css", () => {
  it("desk sizes to content; tree (IM) still fills", () => {
    const css = readFileSync(join(here, "../wire.css"), "utf8");
    assert.match(
      css,
      /\.wire-agent-desk\s*\{[^}]*flex:\s*0 1 auto/s,
    );
    assert.match(
      css,
      /\.wire-agent-tree\s*\{[^}]*flex:\s*1/s,
    );
  });

  it("workspace menu floats and keeps option ink on the label token", () => {
    const css = readFileSync(join(here, "../wire.css"), "utf8");
    assert.match(
      css,
      /\.wire-agent-switch-menu\s*\{[^}]*position:\s*fixed/s,
    );
    assert.match(
      css,
      /\.wire-agent-switch-opt\s*\{[^}]*color:\s*var\(--n-label\)/s,
    );
    assert.match(
      css,
      /\.wire-agent-switch-path\s*\{[^}]*color:\s*color-mix/s,
    );
    assert.match(
      css,
      /\.wire-left-stack:has\(\.wire-agent-switch-menu\)\s*\{[^}]*overflow:\s*visible/s,
    );
  });
});
