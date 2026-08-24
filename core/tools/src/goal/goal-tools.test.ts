import { describe, expect, it } from "vitest";
import { CreateGoalTool } from "./create_goal/tool.js";
import { GetGoalTool } from "./get_goal/tool.js";
import { UpdateGoalTool } from "./update_goal/tool.js";
import type { SessionGoalPort, ToolContext } from "@little-house-studio/types";

function view() {
  return {
    id: "goal-1",
    revision: 2,
    objective: "do it",
    phase: "active" as const,
    maxGoalRounds: 256,
    roundsStarted: 3,
    createdAt: 1,
    updatedAt: 1,
    activation: "armed" as const,
  };
}

function port(over: Partial<SessionGoalPort> = {}): SessionGoalPort {
  const current = view();
  return {
    get: () => current,
    create: ({ objective }) => ({ ...current, objective, revision: 1 }),
    edit: () => current,
    pause: () => ({ ...current, phase: "paused", activation: "disarmed" }),
    resume: () => current,
    complete: () => ({ ...current, phase: "complete", activation: "disarmed" }),
    block: () => ({ ...current, phase: "blocked", activation: "disarmed" }),
    clear: () => ({ id: current.id, revision: current.revision + 1 }),
    disarm: () => ({ ...current, activation: "disarmed" }),
    isRootAgent: true,
    authority: { kind: "direct-human" },
    ...over,
  };
}

function ctx(sessionGoal?: SessionGoalPort, extra: { hostVerifiedGoalOpen?: boolean } = {}): ToolContext {
  return {
    sessionId: "s",
    projectRoot: "/",
    promptRoot: "/",
    sandboxRoot: "/",
    sandboxMode: "yolo",
    agentName: "coding",
    agentMode: "execute",
    pluginSettings: {},
    workingDir: "/",
    runtimePorts: { sessionGoal, hostVerifiedGoalOpen: extra.hostVerifiedGoalOpen },
    hostVerifiedGoalOpen: extra.hostVerifiedGoalOpen,
  };
}

describe("goal tools authority", () => {
  it("get_goal works without a human turn", async () => {
    const tool = new GetGoalTool();
    const result = await tool.execute({}, ctx(port({ authority: { kind: "none" } })));
    expect(result.ok).toBe(true);
    expect(result.message).toContain("goal-1");
  });

  it("create_goal rejects a goal-round / subagent", async () => {
    const tool = new CreateGoalTool();
    const sub = await tool.execute(
      { objective: "x" },
      ctx(port({ isRootAgent: false, authority: { kind: "direct-human" } })),
    );
    expect(sub.ok).toBe(false);
    const round = await tool.execute(
      { objective: "x" },
      ctx(port({
        authority: { kind: "goal-round", source: { kind: "goal", goalId: "goal-1", revision: 2, round: 3 } },
      })),
    );
    expect(round.ok).toBe(false);
  });

  it("create_goal and update_goal refuse a host-verified /ultragoal", async () => {
    const create = await new CreateGoalTool().execute(
      { objective: "x" },
      ctx(port(), { hostVerifiedGoalOpen: true }),
    );
    expect(create.ok).toBe(false);
    expect(create.message).toContain("host-verified");
    const update = await new UpdateGoalTool().execute(
      { goal_id: "goal-1", revision: 2, action: "complete" },
      ctx(port(), { hostVerifiedGoalOpen: true }),
    );
    expect(update.ok).toBe(false);
  });

  it("update_goal complete is rejected on a goal-mode round", async () => {
    const tool = new UpdateGoalTool();
    const result = await tool.execute(
      { goal_id: "goal-1", revision: 2, action: "complete" },
      ctx(port({
        authority: { kind: "goal-round", source: { kind: "goal", goalId: "goal-1", revision: 2, round: 3 } },
      })),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("task_completion");
  });
});
