import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProjectsList } from "@little-house-studio/types";
import { ProjectAgentTool } from "./tool.js";
import type { ToolContext } from "../../base.js";
import {
  bindProjectDispatchHost,
  resetProjectDispatchHostForTest,
} from "../dispatch-host.js";

const roots: string[] = [];

afterEach(() => {
  resetProjectDispatchHostForTest();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "maou-project-agent-tool-"));
  roots.push(root);
  const maouRoot = join(root, "home");
  const project = join(root, "workspace", "app");
  mkdirSync(project, { recursive: true });
  return { maouRoot, project };
}

describe("project_agent", () => {
  it("creates the project marker, coding agent, and registers the project", async () => {
    const { maouRoot, project } = fixture();
    const tool = new ProjectAgentTool();
    const ctx = { maouRoot, projectRoot: maouRoot, agentName: "ops" } as ToolContext;

    const response = await tool.execute({ action: "create", path: project }, ctx);

    expect(response.ok).toBe(true);
    expect(existsSync(join(project, ".maou", "project.json"))).toBe(true);
    // 无全局 coding 模板时写内置骨架
    expect(existsSync(join(project, ".maou", "agents", "coding", "agent.json"))).toBe(true);
    const skeleton = JSON.parse(
      readFileSync(join(project, ".maou", "agents", "coding", "agent.json"), "utf-8"),
    ) as { tools?: string[] };
    expect(skeleton.tools).toContain("use_computer");
    expect(getProjectsList(maouRoot)).toMatchObject([
      { name: "app", path: realpathSync.native(project), isActive: true },
    ]);
  });

  it("rejects relative paths on create", async () => {
    const { maouRoot } = fixture();
    const tool = new ProjectAgentTool();
    const ctx = { maouRoot, projectRoot: maouRoot, agentName: "ops" } as ToolContext;
    const response = await tool.execute({ action: "create", path: "relative/app" }, ctx);
    expect(response.ok).toBe(false);
    expect(response.message).toMatch(/绝对路径/);
  });

  it("lists a broken project with a create hint", async () => {
    const { maouRoot, project } = fixture();
    const tool = new ProjectAgentTool();
    const ctx = { maouRoot, projectRoot: maouRoot, agentName: "ops" } as ToolContext;
    await tool.execute({ action: "create", path: project }, ctx);
    rmSync(join(project, ".maou", "project.json"), { force: true });

    const listed = await tool.execute({ action: "list" }, ctx);
    expect(listed.ok).toBe(true);
    expect(listed.message).toMatch(/找不到 \.maou\/project\.json/);
    expect(listed.message).toMatch(/create path=/);

    const rebound = await tool.execute({ action: "create", path: project }, ctx);
    expect(rebound.ok).toBe(true);
    expect(existsSync(join(project, ".maou", "project.json"))).toBe(true);
    expect(getProjectsList(maouRoot)[0]?.isActive).toBe(true);
  });

  it("binds an existing .maou directory without rewriting the marker", async () => {
    const { maouRoot, project } = fixture();
    const marker = join(project, ".maou", "project.json");
    mkdirSync(join(project, ".maou"), { recursive: true });
    writeFileSync(marker, JSON.stringify({ version: 1, cwd: project, keep: true }, null, 2));

    const tool = new ProjectAgentTool();
    const ctx = { maouRoot, projectRoot: maouRoot, agentName: "ops" } as ToolContext;
    const response = await tool.execute({ action: "create", path: project }, ctx);
    expect(response.ok).toBe(true);
    expect(response.message).toMatch(/未初始化/);
    expect(JSON.parse(readFileSync(marker, "utf-8"))).toMatchObject({ keep: true });
  });

  it("sends work through the target project's coding agent in the background", async () => {
    const { maouRoot, project } = fixture();
    const fork = vi.fn().mockResolvedValue({
      ok: true,
      subSessionId: "sub-session",
      output: "done",
    });
    const tool = new ProjectAgentTool();
    const ctx = {
      maouRoot,
      projectRoot: maouRoot,
      agentName: "ops",
      sessionId: "ops-session",
      runtimePorts: { subagentExecutor: { fork } },
    } as unknown as ToolContext;
    await tool.execute({ action: "create", path: project }, ctx);

    const response = await tool.execute({
      action: "send",
      project,
      task: "inspect and fix",
    }, ctx);

    expect(response.ok).toBe(true);
    expect(response.message).toMatch(/已在后台启动 Coding Agent/);
    expect(response.payload).toMatchObject({
      background: true,
      agent: "coding",
      status: "running",
      sessionId: "sub-session",
    });
    expect(fork).toHaveBeenCalledWith(
      expect.stringMatching(/^project-app-/),
      "inspect and fix",
      expect.objectContaining({
        kind: "project",
        agentName: "coding",
        path: realpathSync.native(project),
        toolPreset: "coding_scoped",
        detached: true,
      }),
    );
  });

  it("uses the bound project dispatch host instead of waiting on fork", async () => {
    const { maouRoot, project } = fixture();
    const fork = vi.fn();
    bindProjectDispatchHost(async (req) => ({
      sessionId: "coding-sess",
      agent: "coding",
      switchId: `project:${req.projectPath}:coding`,
      project: req.projectPath,
      status: "running",
      taskId: "dispatch-1",
    }));
    const tool = new ProjectAgentTool();
    const ctx = {
      maouRoot,
      projectRoot: maouRoot,
      agentName: "ops",
      sessionId: "ops-session",
      runtimePorts: { subagentExecutor: { fork } },
    } as unknown as ToolContext;
    await tool.execute({ action: "create", path: project }, ctx);

    const response = await tool.execute({
      action: "send",
      project,
      task: "inspect and fix",
    }, ctx);

    expect(response.ok).toBe(true);
    expect(fork).not.toHaveBeenCalled();
    expect(response.payload).toMatchObject({
      background: true,
      agent: "coding",
      sessionId: "coding-sess",
      status: "running",
      taskId: "dispatch-1",
    });
  });

  it("tells send to rebind with create when the project marker is gone", async () => {
    const { maouRoot, project } = fixture();
    const tool = new ProjectAgentTool();
    const ctx = {
      maouRoot,
      projectRoot: maouRoot,
      agentName: "ops",
      runtimePorts: { subagentExecutor: { fork: vi.fn() } },
    } as unknown as ToolContext;
    await tool.execute({ action: "create", path: project }, ctx);
    rmSync(join(project, ".maou", "project.json"), { force: true });

    const response = await tool.execute({
      action: "send",
      project,
      task: "inspect and fix",
    }, ctx);
    expect(response.ok).toBe(false);
    expect(response.message).toMatch(/create path=/);
  });
});
