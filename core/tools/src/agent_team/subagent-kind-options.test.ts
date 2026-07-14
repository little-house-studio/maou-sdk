import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadSubagentKindOptions,
  forkOptionsFromAgentJson,
  candidateAgentJsonPaths,
} from "./subagent-kind-options.js";

describe("loadSubagentKindOptions", () => {
  it("无 maouRoot 默认 task", () => {
    expect(loadSubagentKindOptions({ name: "x" })).toEqual({ kind: "task" });
  });

  it("从 nested subagents 读 kind", () => {
    const root = mkdtempSync(join(tmpdir(), "kind-opt-"));
    try {
      const dir = join(root, "agents", "coding", "subagents", "explore");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "agent.json"),
        JSON.stringify({
          name: "explore",
          subagent_kind: "task",
          tool_preset: "explore",
          tools: ["reader", "glob"],
          permission: "readonly",
          round_limit: 20,
        }),
      );
      const opts = loadSubagentKindOptions({
        maouRoot: root,
        parentAgentName: "coding",
        name: "explore",
      });
      expect(opts.kind).toBe("task");
      expect(opts.toolPreset).toBe("explore");
      expect(opts.tools).toContain("reader");
      expect(opts.permission).toBe("readonly");
      expect(opts.roundLimit).toBe(20);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("peer agents/<name> 路径", () => {
    const root = mkdtempSync(join(tmpdir(), "kind-peer-"));
    try {
      const dir = join(root, "agents", "SearchBot");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "agent.json"),
        JSON.stringify({
          name: "SearchBot",
          subagent_kind: "task",
          tool_preset: "web_search",
        }),
      );
      const opts = loadSubagentKindOptions({
        maouRoot: root,
        parentAgentName: "coding",
        name: "SearchBot",
      });
      expect(opts.kind).toBe("task");
      expect(opts.toolPreset).toBe("web_search");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("role=explore 非四类 → kind 回落 task", () => {
    const opts = forkOptionsFromAgentJson({
      role: "explore",
      tools: ["reader"],
    });
    expect(opts.kind).toBe("task");
    expect(opts.tools).toEqual(["reader"]);
  });

  it("candidate 路径顺序", () => {
    const paths = candidateAgentJsonPaths("/m", "coding", "x");
    expect(paths[0]).toContain("subagents/x");
    expect(paths[1]).toContain(".tmp/x");
    expect(paths[2]).toContain("/agents/x/");
    expect(paths[3]).toContain(".shared/x");
  });
});
