import { describe, it, expect } from "vitest";
import {
  resolveSubagentTools,
  helperUsesExecutor,
  SUBAGENT_KIND_DEFAULTS,
  resolveForkKindPolicy,
} from "./subagent-kinds.js";
import { defineSubagent } from "./define-subagent.js";
import {
  materializeSubagent,
  listManagedSubagents,
  killSubagent,
  resolveSubagentDir,
} from "./subagent-lifecycle.js";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("subagent kinds", () => {
  it("helper 单轮强制无 tools", () => {
    const tools = resolveSubagentTools({
      kind: "helper",
      enableLoop: false,
      tools: ["reader", "grep"],
    });
    expect(tools).toEqual([]);
  });

  it("helper 开 loop 才可用 tools", () => {
    const tools = resolveSubagentTools({
      kind: "helper",
      enableLoop: true,
      tools: ["reader"],
    });
    expect(tools).toEqual(["reader"]);
  });

  it("task 预设 explore", () => {
    const tools = resolveSubagentTools({ kind: "task", toolPreset: "explore" });
    expect(tools).toContain("reader");
    expect(tools).toContain("glob");
  });

  it("helperUsesExecutor 仅 persist", () => {
    expect(helperUsesExecutor(false)).toBe(false);
    expect(helperUsesExecutor(true)).toBe(true);
  });

  it("defineSubagent task 默认", () => {
    const d = defineSubagent({
      kind: "task",
      name: "web",
      toolPreset: "web_search",
      parentAgentName: "coding",
    });
    expect(d.resolved.enableLoop).toBe(true);
    expect(d.resolved.tools).toContain("search_internet");
    expect(d.resolved.useExecutor).toBe(true);
    expect(d.toAgentJson().subagent_kind).toBe("task");
  });

  it("defineSubagent project 需要 path", () => {
    expect(() =>
      defineSubagent({ kind: "project", name: "x", systemPrompt: "hi" }),
    ).toThrow(/path/);
  });

  it("materialize + list + kill 过滤", () => {
    const root = mkdtempSync(join(tmpdir(), "maou-sub-"));
    try {
      const d = defineSubagent({
        kind: "task",
        name: "explorer",
        toolPreset: "explore",
        parentAgentName: "coding",
        systemPrompt: "explore only",
      });
      const m = materializeSubagent(d, { maouRoot: root });
      expect(m.ok).toBe(true);
      expect(existsSync(join(m.dir, "agent.json"))).toBe(true);

      let list = listManagedSubagents(root, "coding");
      expect(list.some((x) => x.name === "explorer")).toBe(true);

      killSubagent(m.dir);
      list = listManagedSubagents(root, "coding");
      expect(list.some((x) => x.name === "explorer")).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("ephemeral 路径在 .tmp 下", () => {
    const dir = resolveSubagentDir({
      maouRoot: "/tmp/m",
      parentAgentName: "coding",
      name: "h1",
      storageScope: "nested",
      ephemeral: true,
    });
    expect(dir.replace(/\\/g, "/")).toContain("subagents/.tmp/h1");
  });

  it("fork defaults inherit context", () => {
    expect(SUBAGENT_KIND_DEFAULTS.fork.inheritFullContext).toBe(true);
    expect(SUBAGENT_KIND_DEFAULTS.helper.enableLoop).toBe(false);
  });

  it("resolveForkKindPolicy: helper 非持久化不进 executor", () => {
    const p = resolveForkKindPolicy({ kind: "helper" });
    expect(p).not.toBeNull();
    expect(p!.useExecutor).toBe(false);
    expect(p!.stripTools).toBe(true);
    expect(p!.tools).toEqual([]);
    expect(p!.softRequestBudget).toBe(1);
  });

  it("resolveForkKindPolicy: helper 持久化可进 executor 仍无 tool", () => {
    const p = resolveForkKindPolicy({ kind: "helper", persistContext: true });
    expect(p!.useExecutor).toBe(true);
    expect(p!.listInManager).toBe(true);
    expect(p!.stripTools).toBe(true);
    expect(p!.tools).toEqual([]);
  });

  it("resolveForkKindPolicy: fork 完整上下文 + wrap-up", () => {
    const p = resolveForkKindPolicy({ kind: "fork" });
    expect(p!.inheritFullContext).toBe(true);
    expect(p!.overRoundPolicy).toBe("wrap_up");
    expect(p!.softRequestBudget).toBeUndefined(); // roundLimit=0 → 用 executor 默认
  });

  it("resolveForkKindPolicy: task 预设白名单", () => {
    const p = resolveForkKindPolicy({ kind: "task", toolPreset: "web_search" });
    expect(p!.tools).toContain("search_internet");
    expect(p!.softRequestBudget).toBe(30);
    expect(p!.enableLoop).toBe(true);
  });

  it("resolveForkKindPolicy: project path + coding 白名单", () => {
    const p = resolveForkKindPolicy({
      kind: "project",
      path: "/tmp/proj",
      auditPaths: ["/tmp/shared"],
    });
    expect(p!.path).toBe("/tmp/proj");
    expect(p!.auditPaths).toContain("/tmp/shared");
    expect(p!.tools).toContain("write_file");
    expect(p!.permission).toBe("project_scoped_audit");
  });

  it("helper 非持久化不进 list", () => {
    const root = mkdtempSync(join(tmpdir(), "maou-helper-"));
    try {
      const d = defineSubagent({
        kind: "helper",
        name: "tmp-help",
        systemPrompt: "one shot",
        parentAgentName: "coding",
        // persistContext 默认 false
      });
      expect(d.resolved.listInManager).toBe(false);
      const m = materializeSubagent(d, { maouRoot: root });
      expect(m.ok).toBe(true);
      const list = listManagedSubagents(root, "coding");
      expect(list.some((x) => x.name === "tmp-help")).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
