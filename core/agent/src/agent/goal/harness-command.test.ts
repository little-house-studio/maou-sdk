import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { goalHarness } from "@little-house-studio/context";
import type { GoalView, SessionGoalPort } from "@little-house-studio/types";
import {
  executeHarnessGoalCommand,
  parseGoalBudget,
  parseHarnessGoalCommand,
} from "./harness-command.js";

function easyPort(open: boolean): SessionGoalPort {
  const goal: GoalView | undefined = open
    ? {
        id: "eg-1",
        revision: 1,
        objective: "easy",
        phase: "active",
        maxGoalRounds: 256,
        roundsStarted: 0,
        createdAt: 1,
        updatedAt: 1,
        activation: "armed",
      }
    : undefined;
  return {
    get: () => goal,
    create: () => goal!,
    edit: () => goal!,
    pause: () => goal!,
    resume: () => goal!,
    complete: () => goal!,
    block: () => goal!,
    clear: () => ({ id: "eg-1", revision: 2 }),
    disarm: () => goal,
    isRootAgent: true,
    authority: { kind: "direct-human" },
  };
}

describe("parseGoalBudget", () => {
  it("strips only a trailing standalone --budget <positive integer>", () => {
    expect(parseGoalBudget("Ship it --budget 8000")).toEqual({
      objective: "Ship it",
      tokenBudget: 8000,
    });
    expect(parseGoalBudget("learn --budget tricks")).toEqual({
      objective: "learn --budget tricks",
    });
    expect(parseGoalBudget("do --budget 0")).toEqual({ objective: "do --budget 0" });
    expect(parseGoalBudget("--budget 5")).toEqual({ objective: "--budget 5" });
    expect(parseGoalBudget("plain work")).toEqual({ objective: "plain work" });
  });
});

describe("parseHarnessGoalCommand", () => {
  it("maps empty/status/pause/resume/clear and create", () => {
    expect(parseHarnessGoalCommand("")).toEqual({ kind: "status" });
    expect(parseHarnessGoalCommand("status")).toEqual({ kind: "status" });
    expect(parseHarnessGoalCommand("pause")).toEqual({ kind: "pause" });
    expect(parseHarnessGoalCommand("Ship the plan --budget 1000")).toEqual({
      kind: "create",
      objective: "Ship the plan",
      tokenBudget: 1000,
    });
  });
});

describe("executeHarnessGoalCommand", () => {
  const dirs: string[] = [];

  beforeEach(() => {
    goalHarness.resetForTests();
  });

  afterEach(() => {
    goalHarness.resetForTests();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function session() {
    const dir = mkdtempSync(join(tmpdir(), "maou-hcmd-"));
    dirs.push(dir);
    return { dir, id: "sess-h" };
  }

  it("creates and resumes as an in-turn user task", () => {
    const { dir, id } = session();
    const created = executeHarnessGoalCommand("Ship the alignment --budget 2000", dir, id);
    expect(created.content).toContain("Ultragoal created");
    expect(created.meta?.asUserTask).toBe(true);
    expect(created.meta?.harnessArmed).toBe(true);
    expect(goalHarness.get(dir, id)?.tokenBudget).toBe(2000);

    goalHarness.pause(dir, id, "user");
    const resumed = executeHarnessGoalCommand("resume", dir, id);
    expect(resumed.meta?.asUserTask).toBe(true);
    expect(resumed.meta?.harnessArmed).toBe(true);
  });

  it("refuses create while a /goal is open", () => {
    const { dir, id } = session();
    const result = executeHarnessGoalCommand("Ship it", dir, id, easyPort(true));
    expect(result.content).toContain("/goal clear");
    expect(goalHarness.get(dir, id)).toBeUndefined();
  });

  it("refuses a second create without clear", () => {
    const { dir, id } = session();
    executeHarnessGoalCommand("First", dir, id);
    const again = executeHarnessGoalCommand("Second", dir, id);
    expect(again.content).toContain("already");
  });
});
