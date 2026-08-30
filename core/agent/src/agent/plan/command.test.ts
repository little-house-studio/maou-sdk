import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sessionPlan } from "@little-house-studio/context";
import { executePlanCommand, parsePlanCommand, PLAN_USAGE } from "./command.js";

describe("parsePlanCommand", () => {
  it("maps control words and enter", () => {
    expect(parsePlanCommand("")).toEqual({ kind: "status" });
    expect(parsePlanCommand("off")).toEqual({ kind: "off" });
    expect(parsePlanCommand("view")).toEqual({ kind: "view" });
    expect(parsePlanCommand("approve")).toEqual({ kind: "approve" });
    expect(parsePlanCommand("revise")).toEqual({ kind: "invalid-revise" });
    expect(parsePlanCommand("revise add tests")).toEqual({ kind: "revise", notes: "add tests" });
    expect(parsePlanCommand("Ship login")).toEqual({ kind: "enter", objective: "Ship login" });
  });
});

describe("executePlanCommand", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function session() {
    const dir = mkdtempSync(join(tmpdir(), "maou-pcmd-"));
    dirs.push(dir);
    return { dir, id: "sess-p" };
  }

  it("enters with an objective as an in-turn task", () => {
    const { dir, id } = session();
    const result = executePlanCommand("Ship login", dir, id);
    expect(result.meta?.asUserTask).toBe(true);
    expect(result.meta?.planArmed).toBe(true);
    expect(sessionPlan.isActive(dir, id)).toBe(true);
    expect(String(result.meta?.taskPrompt)).toContain("不要编辑文件");
  });

  it("refuses approve without a written plan", () => {
    const { dir, id } = session();
    executePlanCommand("Ship login", dir, id);
    const result = executePlanCommand("approve", dir, id);
    expect(result.meta?.asUserTask).toBeUndefined();
    expect(result.content).toContain("submit a plan");
  });

  it("approves a submitted plan and starts implementation", () => {
    const { dir, id } = session();
    executePlanCommand("Ship login", dir, id);
    sessionPlan.writePlan(dir, id, "# Plan\nDo the work");
    const result = executePlanCommand("approve", dir, id);
    expect(result.meta?.asUserTask).toBe(true);
    expect(String(result.meta?.taskPrompt)).toContain("approved_plan");
    expect(sessionPlan.isActive(dir, id)).toBe(false);
  });

  it("shows usage when nothing is set", () => {
    const { dir, id } = session();
    expect(executePlanCommand("", dir, id).content).toContain(PLAN_USAGE);
  });
});
