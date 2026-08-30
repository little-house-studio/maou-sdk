/**
 * listOpsAgents：system 不含 coding；附属不进列表
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { listOpsAgents } from "./list-ops-agents.js";

function writeJson(path: string, data: unknown) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
}

describe("listOpsAgents taxonomy", () => {
  let root: string;
  let proj: string;

  beforeEach(() => {
    root = join(
      tmpdir(),
      `maou-list-ops-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    proj = join(root, "proj-a");
    mkdirSync(join(root, "agents", "ops"), { recursive: true });
    writeJson(join(root, "agents", "ops", "agent.json"), {
      name: "ops",
      display_name: "Ops Agent",
      role: "ops",
      scope: "global",
      status: "idle",
      team: "",
      parent: "",
      personality: "",
      description: "管家",
      notes: "",
      created_by: "system",
      created_at: "",
      updated_at: "",
    });
    // 污染：全局 coding + main(Coding Agent) + supervisor
    mkdirSync(join(root, "agents", "coding"), { recursive: true });
    writeJson(join(root, "agents", "coding", "agent.json"), {
      name: "coding",
      display_name: "Coding Agent",
      role: "coding",
      scope: "system",
      status: "idle",
      team: "",
      parent: "",
      personality: "",
      description: "",
      notes: "",
      created_by: "",
      created_at: "",
      updated_at: "",
    });
    mkdirSync(join(root, "agents", "main"), { recursive: true });
    writeJson(join(root, "agents", "main", "agent.json"), {
      name: "main",
      display_name: "Coding Agent",
      role: "编程助手",
      scope: "system",
      status: "idle",
      team: "",
      parent: "",
      personality: "",
      description: "",
      notes: "",
      created_by: "",
      created_at: "",
      updated_at: "",
    });
    // ops 工作区也藏了 coding（旧 bug 来源）
    mkdirSync(join(root, "ops", ".maou", "agents", "coding"), {
      recursive: true,
    });
    writeJson(
      join(root, "ops", ".maou", "agents", "coding", "agent.json"),
      {
        name: "coding",
        display_name: "Coding Agent",
        role: "coding",
        status: "idle",
        team: "",
        parent: "",
        personality: "",
        scope: "project",
        description: "",
        notes: "",
        created_by: "",
        created_at: "",
        updated_at: "",
      },
    );
    // 项目 coding + 误放顶层的 proactive
    mkdirSync(join(proj, ".maou", "agents", "coding"), { recursive: true });
    writeJson(join(proj, ".maou", "agents", "coding", "agent.json"), {
      name: "coding",
      display_name: "Coding Agent",
      role: "coding",
      status: "idle",
      team: "",
      parent: "",
      personality: "",
      scope: "project",
      description: "proj coding",
      notes: "",
      created_by: "",
      created_at: "",
      updated_at: "",
    });
    mkdirSync(join(proj, ".maou", "agents", "proactive"), { recursive: true });
    writeJson(join(proj, ".maou", "agents", "proactive", "agent.json"), {
      name: "proactive",
      display_name: "主动智能",
      role: "proactive",
      list_in_manager: false,
      stationed: true,
      status: "idle",
      team: "",
      parent: "coding",
      personality: "",
      scope: "subagent",
      description: "slave",
      notes: "",
      created_by: "",
      created_at: "",
      updated_at: "",
    });
    writeJson(join(root, "projects.json"), {
      projects: [{ name: "proj-a", path: proj }],
    });
  });

  afterEach(() => {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  });

  it("system list is ops-only; no coding/main/proactive free persons", () => {
    const list = listOpsAgents(root);
    const system = list.filter((e) => e.group === "system");
    const names = system.map((e) => e.name);
    expect(names).toContain("ops");
    expect(names).not.toContain("coding");
    expect(names).not.toContain("main");
    expect(names).not.toContain("proactive");
    expect(list.some((e) => e.switch_id === "system:coding")).toBe(false);
  });

  it("project coding appears under project group", () => {
    const list = listOpsAgents(root);
    const projectCoding = list.filter(
      (e) => e.group === "project" && e.name === "coding",
    );
    expect(projectCoding.length).toBe(1);
    // getProjectsList 可能 realpath 规范化（macOS /var → /private/var）
    expect(projectCoding[0]?.project_path).toMatch(/proj-a$/);
    expect(projectCoding[0]?.switch_id).toMatch(
      /^project:.*proj-a:coding$/,
    );
  });

  it("proactive top-level dir is hidden (slave)", () => {
    const list = listOpsAgents(root);
    expect(list.some((e) => e.name === "proactive")).toBe(false);
  });

  it("coding-template clone named install is not a project child", () => {
    mkdirSync(join(proj, ".maou", "agents", "install"), { recursive: true });
    writeFileSync(
      join(proj, ".maou", "agents", "install", ".agent.ref"),
      "/opt/maou-sdk/agent-products/coding-agent/templates/coding\n",
    );
    const list = listOpsAgents(root);
    expect(list.some((e) => e.group === "project" && e.name === "install")).toBe(
      false,
    );
    expect(list.some((e) => e.group === "project" && e.name === "coding")).toBe(
      true,
    );
  });

  it("ensureProjectPaths surfaces unregistered project", () => {
    const orphan = join(root, "orphan");
    mkdirSync(join(orphan, ".maou", "agents", "coding"), { recursive: true });
    writeJson(join(orphan, ".maou", "agents", "coding", "agent.json"), {
      name: "coding",
      display_name: "Coding Agent",
      role: "coding",
      status: "idle",
      team: "",
      parent: "",
      personality: "",
      scope: "project",
      description: "",
      notes: "",
      created_by: "",
      created_at: "",
      updated_at: "",
    });
    const without = listOpsAgents(root);
    expect(
      without.some((e) => e.project_path === orphan),
    ).toBe(false);
    const withEnsure = listOpsAgents({
      maouRoot: root,
      ensureProjectPaths: [orphan],
    });
    expect(
      withEnsure.some(
        (e) => e.project_path === orphan && e.name === "coding",
      ),
    ).toBe(true);
  });
});
