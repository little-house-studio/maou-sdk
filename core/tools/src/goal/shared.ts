/**
 * /goal 工具共用策略：权限、filler、紧凑 JSON。
 */

import { createToolResponse, resolveToolRuntimePorts } from "../base.js";
import type { ToolContext, ToolResponse } from "../base.js";
import {
  BLOCKED_AFTER_CONSECUTIVE_ROUNDS,
  GoalError,
} from "@little-house-studio/types";
import type { GoalView, SessionGoalPort } from "@little-house-studio/types";

export const GET_GOAL_DESCRIPTION =
  "Read the current /goal contract, including its exact id/revision, objective, phase, completed " +
  "continuation rounds, round limit, blocker reason when present, and whether another continuation is armed. " +
  "Call this before updating a /goal. This is not the host-verified /ultragoal.";

export const CREATE_GOAL_DESCRIPTION =
  "Create one persisted /goal completion contract when the current direct human request " +
  "is a long-running objective that should continue across autonomous goal-mode rounds. You may " +
  "infer that intent without requiring the user to say \"create a goal\". Do not use this for " +
  "trivial single-turn work, and do not use it while a host-verified /ultragoal is open. " +
  "Execution rejects non-human and subagent authority.";

export const UPDATE_GOAL_DESCRIPTION =
  "Update the exact current /goal revision. edit, pause, and resume require a direct " +
  "top-level human request. During a goal-mode round, report progress with " +
  "<task_completion> at the end of your message instead of complete/blocked. " +
  "complete and blocked remain available on a direct human turn. " +
  "Disabled while a host-verified /ultragoal is open.";

export type GoalToolValue =
  | { goal: null }
  | {
      goal: {
        id: string;
        revision: number;
        objective: string;
        phase: GoalView["phase"];
        roundsStarted: number;
        maxGoalRounds: number;
        blockedReason?: { code: string; message: string };
      };
      activation: GoalView["activation"];
    };

export function goalValue(goal: GoalView | undefined): GoalToolValue {
  if (goal === undefined) return { goal: null };
  return {
    goal: {
      id: goal.id,
      revision: goal.revision,
      objective: goal.objective,
      phase: goal.phase,
      roundsStarted: goal.roundsStarted,
      maxGoalRounds: goal.maxGoalRounds,
      ...(goal.blockedReason
        ? { blockedReason: { code: goal.blockedReason.code, message: goal.blockedReason.message } }
        : {}),
    },
    activation: goal.activation,
  };
}

export function okGoal(goal: GoalView | undefined, extra?: string): ToolResponse {
  const text = JSON.stringify(goalValue(goal));
  return createToolResponse(true, extra ? `${text}\n\n${extra}` : text);
}

export function hasText(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

export function hasRoundCap(value: unknown): value is number {
  return typeof value === "number" && value !== 0;
}

export function requireGoalPort(
  ctx: ToolContext,
): { ok: true; port: SessionGoalPort } | { ok: false; response: ToolResponse } {
  const port = resolveToolRuntimePorts(ctx).sessionGoal;
  if (!port || typeof port.get !== "function") {
    return { ok: false, response: createToolResponse(false, "goal tools require a session goal port") };
  }
  return { ok: true, port };
}

export function rejectIfHostGoalOpen(ctx: ToolContext): ToolResponse | undefined {
  if (!resolveToolRuntimePorts(ctx).hostVerifiedGoalOpen) return undefined;
  return createToolResponse(
    false,
    "a host-verified /ultragoal is open; goal tools are disabled until /ultragoal clear",
  );
}

export function requireDirectHuman(port: SessionGoalPort): void {
  if (!port.isRootAgent || port.authority.kind !== "direct-human") {
    throw new GoalError(
      "this goal operation requires a direct human turn on a top-level agent",
      "GOAL_INVALID_TRANSITION",
    );
  }
}

export function requireCompletionAuthority(port: SessionGoalPort): "direct-human" | "goal-round" {
  if (port.authority.kind === "direct-human" && port.isRootAgent) return "direct-human";
  if (port.authority.kind === "goal-round") {
    const current = port.get();
    const source = port.authority.source;
    if (
      current &&
      source.goalId === current.id &&
      source.revision === current.revision &&
      source.round === current.roundsStarted
    ) {
      return "goal-round";
    }
  }
  throw new GoalError(
    "complete and blocked require a direct human turn or the current goal round",
    "GOAL_INVALID_TRANSITION",
  );
}

export function blockedThreshold(): number {
  return BLOCKED_AFTER_CONSECUTIVE_ROUNDS;
}

export function failGoal(error: unknown): ToolResponse {
  if (error instanceof GoalError) {
    return createToolResponse(false, `${error.code}: ${error.message}`);
  }
  return createToolResponse(false, error instanceof Error ? error.message : String(error));
}

export function renderGoalWrapup(objective: string, blockedReason?: string): string {
  const heading = `Objective: ${JSON.stringify(objective)}\n`;
  const grounding =
    "Report only what earlier rounds and tool results in this session actually establish; " +
    "when a detail is not in the session, say so instead of inventing it. ";
  if (blockedReason === undefined) {
    return (
      "<goal_complete>\n" +
      heading +
      "The goal is marked complete and this autonomous run is ending. Write the closing " +
      "message to the user now: state the outcome, summarize what was done and how it was " +
      "verified, and point to the concrete results (files, commits, or other artifacts). " +
      grounding +
      "Note anything the user should review or do next. Address the user directly. Do not " +
      "call any more tools in this run; further work waits for the user's next instruction.\n" +
      "</goal_complete>"
    );
  }
  return (
    "<goal_blocked>\n" +
    heading +
    `Blocked: ${JSON.stringify(blockedReason)}\n` +
    "The goal is marked blocked and this autonomous run is ending. Write the closing " +
    "message to the user now: state what has been completed so far, describe the concrete " +
    "blocking condition and what you tried, and say exactly what you need from the user to " +
    "continue. " +
    grounding +
    "Address the user directly. Do not call any more tools in this run; further work " +
    "waits for the user's next instruction.\n" +
    "</goal_blocked>"
  );
}
