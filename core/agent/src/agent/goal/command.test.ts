import { describe, expect, it } from "vitest";
import { executeGoalCommand, parseGoalCommand, GOAL_USAGE } from "./command.js";
import type { GoalView, SessionGoalPort } from "@little-house-studio/types";

function view(over: Partial<GoalView> = {}): GoalView {
  return {
    id: "goal-1",
    revision: 1,
    objective: "do the work",
    phase: "active",
    maxGoalRounds: 256,
    roundsStarted: 0,
    createdAt: 1,
    updatedAt: 1,
    activation: "armed",
    ...over,
  };
}

function port(current: GoalView | undefined, extra: Partial<SessionGoalPort> = {}): SessionGoalPort {
  let goal = current;
  return {
    get: () => goal,
    create: ({ objective }) => {
      goal = view({ objective, revision: 1, activation: "armed", phase: "active" });
      return goal;
    },
    edit: (_ref, request) => {
      goal = view({ ...goal!, ...request, revision: (goal?.revision ?? 1) + 1 });
      return goal!;
    },
    pause: () => {
      goal = view({ ...goal!, phase: "paused", activation: "disarmed", revision: (goal?.revision ?? 1) + 1 });
      return goal!;
    },
    resume: () => {
      goal = view({ ...goal!, phase: "active", activation: "armed", revision: (goal?.revision ?? 1) + 1 });
      return goal!;
    },
    complete: () => {
      goal = view({ ...goal!, phase: "complete", activation: "disarmed", revision: (goal?.revision ?? 1) + 1 });
      return goal!;
    },
    block: (_ref, reason) => {
      goal = view({
        ...goal!,
        phase: "blocked",
        activation: "disarmed",
        blockedReason: reason,
        revision: (goal?.revision ?? 1) + 1,
      });
      return goal!;
    },
    clear: () => {
      const ref = { id: goal!.id, revision: goal!.revision + 1 };
      goal = undefined;
      return ref;
    },
    disarm: () => {
      if (goal) goal = { ...goal, activation: "disarmed" };
      return goal;
    },
    isRootAgent: true,
    authority: { kind: "direct-human" },
    ...extra,
  };
}

describe("parseGoalCommand", () => {
  it("treats empty as show and control words as exact input", () => {
    expect(parseGoalCommand("")).toEqual({ kind: "show" });
    expect(parseGoalCommand("pause")).toEqual({ kind: "pause" });
    expect(parseGoalCommand("RESUME")).toEqual({ kind: "resume" });
    expect(parseGoalCommand("clear")).toEqual({ kind: "clear" });
    expect(parseGoalCommand("edit")).toEqual({ kind: "invalid-edit" });
    expect(parseGoalCommand("edit new objective")).toEqual({ kind: "edit", objective: "new objective" });
    expect(parseGoalCommand("Ship it")).toEqual({ kind: "create", objective: "Ship it" });
  });
});

describe("executeGoalCommand", () => {
  it("shows usage when nothing is set", () => {
    const result = executeGoalCommand("", port(undefined));
    expect(result.content).toContain(GOAL_USAGE);
  });

  it("creates, pauses, and refuses replace without clear", () => {
    const p = port(undefined);
    const created = executeGoalCommand("Ship the alignment", p);
    expect(created.content).toContain("Goal created");
    expect(created.meta?.goalArmed).toBe(true);
    const again = executeGoalCommand("something else", p);
    expect(again.content).toContain("already active");
    const paused = executeGoalCommand("pause", p);
    expect(paused.content).toContain("Goal paused");
  });

  it("refuses create while a host-verified ultragoal is open", () => {
    const result = executeGoalCommand("Ship it", port(undefined), { harnessOpen: true });
    expect(result.content).toContain("/ultragoal clear");
    expect(result.meta?.goalArmed).toBeUndefined();
  });

  it("still shows and clears while a host-verified ultragoal is open", () => {
    const p = port(view());
    expect(executeGoalCommand("", p, { harnessOpen: true }).content).toContain("Goal");
    expect(executeGoalCommand("clear", p, { harnessOpen: true }).content).toContain("cleared");
  });
});
