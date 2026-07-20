/**
 * 结构回归：Todo 编排所有权在 agent；tools 宿主桥可 bind。
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  bindTodoOrchestratorHost,
  getTodoOrchestrator,
  TODO_ORCHESTRATOR as ToolsProxy,
} from "@little-house-studio/tools";
import { TodoOrchestrator, TODO_ORCHESTRATOR } from "./register.js";
import { resolveToolRuntimePorts } from "@little-house-studio/types";
import type { ToolContext } from "@little-house-studio/types";
import { buildToolContext } from "../runtime-tool-context.js";

describe("Todo ownership + ToolContext ports", () => {
  beforeEach(() => {
    // register.ts 已在 import 时 bind 全局单例
    bindTodoOrchestratorHost(TODO_ORCHESTRATOR);
  });

  it("agent TODO_ORCHESTRATOR is bound into tools host", () => {
    expect(getTodoOrchestrator()).toBe(TODO_ORCHESTRATOR);
    expect(ToolsProxy.resolveRootSession("s1")).toBe("s1");
  });

  it("TodoOrchestrator class lives in agent package", () => {
    const orch = new TodoOrchestrator();
    expect(orch.manage("own-1", "list", null)).toBeTruthy();
  });

  it("buildToolContext dual-writes runtimePorts and legacy fields", () => {
    const ctx = buildToolContext({
      sessionId: "sess",
      projectRoot: "/p",
      promptRoot: "/prompt",
      maouRoot: "/maou",
      sandboxMode: "yolo",
      agentName: "coding",
      mainPreset: { model: "x" },
      runtimeAgentName: "coding" as never,
    });
    // force runtimeAgentName via ports path
    ctx.runtimePorts = {
      ...ctx.runtimePorts,
      runtimeAgentName: "coding",
      mainPreset: { model: "x" },
    };
    ctx.runtimeAgentName = "coding";
    ctx.mainPreset = { model: "x" };

    const ports = resolveToolRuntimePorts(ctx as ToolContext);
    expect(ports.runtimeAgentName).toBe("coding");
    expect(ports.mainPreset).toEqual({ model: "x" });
    // legacy top-level still present
    expect(ctx.mainPreset).toEqual({ model: "x" });
  });

  it("resolveToolRuntimePorts prefers runtimePorts over legacy", () => {
    const ctx = {
      sessionId: "s",
      projectRoot: "/",
      promptRoot: "/",
      sandboxRoot: "/",
      sandboxMode: "yolo",
      agentName: "a",
      agentMode: "execute",
      pluginSettings: {},
      workingDir: "/",
      runtimeAgentName: "legacy",
      runtimePorts: { runtimeAgentName: "ports" },
    } as ToolContext;
    expect(resolveToolRuntimePorts(ctx).runtimeAgentName).toBe("ports");
  });
});
