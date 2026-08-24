/**
 * `/ultragoal`：宿主编排的长目标（规划合同、暗厢评审、验审、同回合续跑）。
 */

import { goalHarness } from "@little-house-studio/context";
import type { GoalHarnessSnapshot } from "@little-house-studio/types";
import type { CommandResult } from "../command-registry.js";
import { goalIsOpen } from "./command.js";
import type { SessionGoalPort } from "@little-house-studio/types";

export const HARNESS_GOAL_USAGE =
  "Usage: /ultragoal [<objective> [--budget <tokens>] | status | pause | resume | clear]";
export const ULTRAGOAL_USAGE = HARNESS_GOAL_USAGE;

export type HarnessGoalCommand =
  | { readonly kind: "status" }
  | { readonly kind: "pause" }
  | { readonly kind: "resume" }
  | { readonly kind: "clear" }
  | { readonly kind: "create"; readonly objective: string; readonly tokenBudget?: number };

export function parseGoalBudget(trimmed: string): { objective: string; tokenBudget?: number } {
  const idx = trimmed.lastIndexOf("--budget");
  if (idx < 0) return { objective: trimmed };
  const head = trimmed.slice(0, idx).trimEnd();
  const tail = trimmed.slice(idx + "--budget".length);
  const flagOwnToken = /\s$/.test(trimmed.slice(0, idx)) && /^\s/.test(tail);
  const value = tail.trim();
  if (
    flagOwnToken &&
    head &&
    value &&
    !value.includes(" ") &&
    /^\d+$/.test(value)
  ) {
    const budget = Number(value);
    if (Number.isSafeInteger(budget) && budget > 0) {
      return { objective: head, tokenBudget: budget };
    }
  }
  return { objective: trimmed };
}

export function parseHarnessGoalCommand(rawInput: string): HarnessGoalCommand {
  const trimmed = rawInput.trim();
  const key = trimmed.toLowerCase();
  if (key === "" || key === "status") return { kind: "status" };
  if (key === "pause") return { kind: "pause" };
  if (key === "resume") return { kind: "resume" };
  if (key === "clear") return { kind: "clear" };
  const parsed = parseGoalBudget(trimmed);
  return { kind: "create", objective: parsed.objective, tokenBudget: parsed.tokenBudget };
}

export function renderHarnessGoalText(title: string, snap: GoalHarnessSnapshot): string {
  const budget = snap.tokenBudget ? `${snap.tokensUsed}/${snap.tokenBudget}` : String(snap.tokensUsed);
  const pause = snap.pauseMessage ? [`Pause: ${snap.pauseMessage}`] : [];
  return [
    title,
    `Status: ${snap.status} | Phase: ${snap.phase}`,
    `Objective: ${snap.objective}`,
    `Tokens: ${budget}`,
    `Worker rounds: ${snap.workerRounds} | Verify rounds: ${snap.verifyRounds}`,
    `Plan: ${snap.planReady ? "ready" : "missing"}`,
    ...pause,
    "",
    "Commands: /ultragoal status, /ultragoal pause, /ultragoal resume, /ultragoal clear",
  ].join("\n");
}

export function executeHarnessGoalCommand(
  args: string,
  sessionDir: string | undefined,
  sessionId: string,
  easyPort?: SessionGoalPort,
): CommandResult {
  if (!sessionDir) {
    return { content: `Ultragoal service is not available. ${HARNESS_GOAL_USAGE}` };
  }
  const command = parseHarnessGoalCommand(args);
  const current = goalHarness.get(sessionDir, sessionId);

  switch (command.kind) {
    case "status":
      return current
        ? { content: renderHarnessGoalText("Ultragoal", current), meta: { harness: current } }
        : { content: `No ultragoal is currently set.\n${HARNESS_GOAL_USAGE}` };
    case "pause": {
      if (!current) return { content: `No ultragoal is currently set. ${HARNESS_GOAL_USAGE}` };
      if (current.status !== "active") {
        return { content: renderHarnessGoalText("Ultragoal is not active", current) };
      }
      const paused = goalHarness.pause(sessionDir, sessionId, "user");
      return {
        content: paused
          ? renderHarnessGoalText("Ultragoal paused. Use /ultragoal resume to continue.", paused)
          : "Ultragoal is not active.",
      };
    }
    case "clear":
      if (!goalHarness.clear(sessionDir, sessionId)) return { content: "No ultragoal to clear." };
      return { content: "Ultragoal cleared." };
    case "resume": {
      if (!current) return { content: `No ultragoal is currently set. Use /ultragoal <objective>.` };
      if (current.status === "complete") {
        return { content: "Ultragoal is already complete. Use /ultragoal <objective> to start a new one." };
      }
      if (current.status === "budget_limited") {
        return { content: "Ultragoal is budget-limited. Use /ultragoal clear, then /ultragoal <objective>." };
      }
      const resumed = goalHarness.resume(sessionDir, sessionId);
      if (!resumed) return { content: "Could not resume the ultragoal." };
      const prompt =
        resumed.planReady
          ? "Ultragoal resumed. Continue working toward the objective."
          : "Ultragoal resumed. The host will write the plan, then you start.";
      return {
        content: renderHarnessGoalText("Ultragoal resumed.", resumed),
        meta: { asUserTask: true, taskPrompt: prompt, harnessArmed: true },
      };
    }
    case "create": {
      if (goalIsOpen(easyPort)) {
        return {
          content: "An /goal is already open. Use /goal clear before starting /ultragoal.",
        };
      }
      if (current && current.status !== "complete" && current.status !== "budget_limited") {
        return {
          content: `An ultragoal is already ${current.status}. Use /ultragoal clear before replacing it.`,
        };
      }
      try {
        const created = goalHarness.create(sessionDir, sessionId, command.objective, command.tokenBudget);
        return {
          content: renderHarnessGoalText("Ultragoal created", created),
          meta: {
            asUserTask: true,
            taskPrompt: "Begin the host-verified ultragoal. Wait for the written plan, then implement it.",
            harnessArmed: true,
          },
        };
      } catch (error) {
        return {
          content: error instanceof Error ? error.message : String(error),
        };
      }
    }
    default:
      return { content: HARNESS_GOAL_USAGE };
  }
}
