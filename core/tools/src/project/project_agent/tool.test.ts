import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProjectsList } from "@little-house-studio/types";
import { ProjectAgentTool } from "./tool.js";
import type { ToolContext } from "../../base.js";

const roots: string[] = [];

afterEach(() => {
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

  it("sends work through the target project's coding agent", async () => {
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
      runtimePorts: { subagentExecutor: { fork } },
    } as unknown as ToolContext;
    await tool.execute({ action: "create", path: project }, ctx);

    const response = await tool.execute({
      action: "send",
      project,
      task: "inspect and fix",
    }, ctx);

    expect(response.ok).toBe(true);
    expect(fork).toHaveBeenCalledWith(
      expect.stringMatching(/^project-app-/),
      "inspect and fix",
      expect.objectContaining({
        kind: "project",
        agentName: "coding",
        path: realpathSync.native(project),
        toolPreset: "coding_scoped",
      }),
    );
  });
});
