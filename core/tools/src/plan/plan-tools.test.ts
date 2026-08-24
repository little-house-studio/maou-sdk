import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WriteFileTool } from "../file/write_file/tool.js";
import { SubmitPlanTool } from "./submit_plan/tool.js";
import type { SessionPlanPort, ToolContext } from "@little-house-studio/types";

function port(over: Partial<SessionPlanPort> = {}): SessionPlanPort {
  let markdown = "";
  return {
    get: () => ({
      id: "p1",
      objective: "Ship",
      status: "planning",
      active: true,
      planReady: Boolean(markdown),
      revision: markdown ? 1 : 0,
      createdAt: 1,
      updatedAt: 1,
    }),
    isActive: () => true,
    writePlan: (text) => {
      if (!text.trim().startsWith("#")) throw new Error("plan markdown must start with a # heading");
      markdown = text;
      return {
        id: "p1",
        objective: "Ship",
        status: "review",
        active: true,
        planReady: true,
        revision: 1,
        createdAt: 1,
        updatedAt: 1,
      };
    },
    readPlan: () => markdown || undefined,
    planFile: () => "/tmp/sess.plan/plan.md",
    ...over,
  };
}

function ctx(over: Partial<ToolContext> = {}): ToolContext {
  const sessionPlan = over.sessionPlan ?? port();
  return {
    sessionId: "s",
    projectRoot: "/",
    promptRoot: "/",
    sandboxRoot: "/",
    sandboxMode: "yolo",
    agentName: "coding",
    agentMode: "plan",
    pluginSettings: {},
    workingDir: "/",
    planFile: sessionPlan.planFile(),
    runtimePorts: { sessionPlan },
    sessionPlan,
    ...over,
  };
}

describe("submit_plan", () => {
  it("rejects outside plan mode and heading-less markdown", async () => {
    const tool = new SubmitPlanTool();
    const inactive = await tool.execute(
      { plan: "# X" },
      ctx({ sessionPlan: port({ isActive: () => false }) }),
    );
    expect(inactive.ok).toBe(false);
    const bad = await tool.execute({ plan: "no heading" }, ctx());
    expect(bad.ok).toBe(false);
  });

  it("records a complete plan", async () => {
    const tool = new SubmitPlanTool();
    const result = await tool.execute({ plan: "# Plan\nsteps" }, ctx());
    expect(result.ok).toBe(true);
    expect(result.message).toContain("Plan recorded");
  });
});

describe("plan write gate", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("blocks product files and allows the session plan file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "maou-pgate-"));
    dirs.push(dir);
    const planFile = join(dir, "plan.md");
    const write = new WriteFileTool();
    const blocked = await write.execute(
      { path: "src/app.ts", content: "nope" },
      ctx({ projectRoot: dir, workingDir: dir, planFile }),
    );
    expect(blocked.ok).toBe(false);
    expect(blocked.message).toContain("plan mode");
    const allowed = await write.execute(
      { path: planFile, content: "# Plan\n" },
      ctx({ projectRoot: dir, workingDir: dir, planFile }),
    );
    expect(allowed.ok).toBe(true);
  });
});
