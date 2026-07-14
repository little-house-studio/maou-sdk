/**
 * 四类 subagent 集成实验：策略 → materialize → list/kill → executor 通道路由。
 * 不调真实 LLM；runFn / Aux 均为 mock。
 */
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getSubagentPolicy,
  resolveSubagentRunPlan,
  materializeIfNeeded,
} from "./subagent-policy.js";
import { listManagedSubagents, killSubagent } from "./subagent-lifecycle.js";
import { SubagentExecutor } from "./subagent-executor.js";
import type { SubagentRunFn } from "./subagent-executor.js";
import type { AuxModelCallerLike } from "@little-house-studio/types";

describe("subagent integration experiment", () => {
  it("四类 RunPlan 通道与 pathGuard", () => {
    const fork = resolveSubagentRunPlan({ kind: "fork" })!;
    expect(fork.runChannel).toBe("executor");
    expect(fork.inheritFullContext).toBe(true);
    expect(fork.pathGuard).toBeUndefined();

    const helper = resolveSubagentRunPlan({ kind: "helper" })!;
    expect(helper.runChannel).toBe("aux");
    expect(helper.stripTools).toBe(true);
    expect(helper.tools).toEqual([]);

    const helperP = resolveSubagentRunPlan({ kind: "helper", persistContext: true })!;
    expect(helperP.runChannel).toBe("executor");
    expect(helperP.shouldMaterialize).toBe(true);

    const task = resolveSubagentRunPlan({ kind: "task", toolPreset: "web_search" })!;
    expect(task.tools).toContain("search_internet");
    expect(task.softRequestBudget).toBe(30);

    const project = resolveSubagentRunPlan({
      kind: "project",
      path: "/tmp/myproj",
      auditPaths: ["/tmp/shared"],
    })!;
    expect(project.pathGuard?.mode).toBe("audit");
    expect(project.pathGuard?.roots[0]).toContain("myproj");
    expect(project.pathGuard?.auditRoots?.[0]).toContain("shared");
    expect(project.tools).toContain("write_file");
  });

  it("materialize + list + kill 全链路", () => {
    const root = mkdtempSync(join(tmpdir(), "maou-int-"));
    try {
      for (const kind of ["fork", "task", "project"] as const) {
        const plan = resolveSubagentRunPlan({
          kind,
          path: kind === "project" ? join(root, "code") : undefined,
          persistContext: true,
        })!;
        const mat = materializeIfNeeded(plan, {
          maouRoot: root,
          name: `${kind}-agent`,
          parentAgentName: "coding",
          systemPrompt: `${kind} prompt`,
        });
        expect(mat?.ok).toBe(true);
        expect(existsSync(join(mat!.dir, "agent.json"))).toBe(true);
        const json = JSON.parse(readFileSync(join(mat!.dir, "agent.json"), "utf-8"));
        expect(json.subagent_kind).toBe(kind);
      }

      let list = listManagedSubagents(root, "coding");
      expect(list.map((x) => x.name).sort()).toEqual(
        ["fork-agent", "project-agent", "task-agent"].sort(),
      );

      const taskDir = list.find((x) => x.name === "task-agent")!.dir;
      killSubagent(taskDir);
      list = listManagedSubagents(root, "coding");
      expect(list.some((x) => x.name === "task-agent")).toBe(false);
      expect(list.some((x) => x.name === "fork-agent")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("helper 非持久走 Aux，不 materialize", async () => {
    const root = mkdtempSync(join(tmpdir(), "maou-aux-"));
    try {
      const aux: AuxModelCallerLike = {
        callText: vi.fn(async () => ({
          content: "helper-ok",
          usage: null,
          ok: true,
          presetName: "fast",
        })),
        callJson: vi.fn(async () => ({
          content: "{}",
          json: {},
          usage: null,
          ok: true,
          presetName: "fast",
        })),
      };

      const runFn: SubagentRunFn = async function* () {
        // 不应被调用
        yield { type: "assistant", content: "should-not" } as never;
        return { finalOutput: "no", ok: false };
      };

      const ex = new SubagentExecutor({
        runFn,
        auxModelCaller: aux,
        resolveHelperPreset: () => ({ model: "fast" }),
        maouRoot: root,
        parentAgentName: "coding",
      });
      ex.parentSessionId = "parent-1";

      const r = await ex.fork("h1", "总结一句话", {
        kind: "helper",
        persistContext: false,
      });
      expect(r.ok).toBe(true);
      expect(r.output).toBe("helper-ok");
      expect(aux.callText).toHaveBeenCalledOnce();
      // 未物化
      expect(listManagedSubagents(root, "coding")).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("task fork 走 runFn + softBudget 来自 roundLimit", async () => {
    const root = mkdtempSync(join(tmpdir(), "maou-task-"));
    try {
      let seen: Record<string, unknown> | undefined;
      const runFn: SubagentRunFn = async function* (_sid, _tid, desc, options) {
        seen = {
          desc,
          agentMode: options?.agentMode,
          toolWhitelist: options?.toolWhitelist,
          inheritFullContext: options?.inheritFullContext,
          kind: (options?.kindPolicy as { kind?: string } | undefined)?.kind,
        };
        yield { type: "assistant", content: `done:${desc}` } as never;
        return { finalOutput: `done:${desc}`, ok: true };
      };

      const ex = new SubagentExecutor({
        runFn,
        defaultSoftRequestBudget: 90,
        maouRoot: root,
        parentAgentName: "coding",
      });
      ex.parentSessionId = "p";

      const r = await ex.fork("t1", "搜索文档", {
        kind: "task",
        toolPreset: "explore",
        persistContext: true,
      });
      expect(r.ok).toBe(true);
      expect(seen?.agentMode).toBe(true);
      expect(Array.isArray(seen?.toolWhitelist)).toBe(true);
      expect((seen?.toolWhitelist as string[]).includes("reader")).toBe(true);
      expect(seen?.inheritFullContext).toBe(false);
      expect(seen?.kind).toBe("task");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fork kind inheritFullContext=true", async () => {
    let seen: { inherit?: boolean } = {};
    const runFn: SubagentRunFn = async function* (_s, _t, _d, options) {
      seen.inherit = options?.inheritFullContext;
      return { finalOutput: "forked", ok: true };
    };
    const ex = new SubagentExecutor({ runFn });
    ex.parentSessionId = "root";
    const r = await ex.fork("f1", "分支任务", { kind: "fork" });
    expect(r.ok).toBe(true);
    expect(seen.inherit).toBe(true);
  });

  it("project pathGuard 在 kindPolicy 上", async () => {
    let guard: unknown;
    const runFn: SubagentRunFn = async function* (_s, _t, _d, options) {
      guard = (options?.kindPolicy as { pathGuard?: unknown } | undefined)?.pathGuard;
      return { finalOutput: "ok", ok: true };
    };
    const root = mkdtempSync(join(tmpdir(), "maou-proj-"));
    try {
      const ex = new SubagentExecutor({
        runFn,
        maouRoot: root,
        parentAgentName: "coding",
      });
      ex.parentSessionId = "root";
      await ex.fork("p1", "改代码", {
        kind: "project",
        path: join(root, "workspace"),
        auditPaths: [join(root, "libs")],
        persistContext: true,
      });
      expect(guard).toMatchObject({ mode: "audit" });
      const list = listManagedSubagents(root, "coding");
      expect(list.length).toBeGreaterThanOrEqual(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("多态 policy.materialize 复用 define", () => {
    const root = mkdtempSync(join(tmpdir(), "maou-poly-"));
    try {
      const policy = getSubagentPolicy("task");
      const { defined, result } = policy.materialize({
        maouRoot: root,
        name: "poly-task",
        parentAgentName: "coding",
        toolPreset: "report",
        systemPrompt: "write report",
      });
      expect(defined.kind).toBe("task");
      expect(defined.resolved.tools).toContain("write_file");
      expect(result.created).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
