/**
 * `/goal`：同会话一条合同，闲时续跑；宿主按 `<task_completion>` 收口。
 */

import { GoalError } from "@little-house-studio/types";
import type { GoalPhase, GoalView, SessionGoalPort } from "@little-house-studio/types";
import type { CommandResult } from "../command-registry.js";

export const GOAL_USAGE = "Usage: /goal [<objective>|clear|edit <objective>|pause|resume]";
/** @deprecated 用 GOAL_USAGE */
export const EASYGOAL_USAGE = GOAL_USAGE;

type GoalCommand =
  | { readonly kind: "show" }
  | { readonly kind: "create"; readonly objective: string }
  | { readonly kind: "edit"; readonly objective: string }
  | { readonly kind: "invalid-edit" }
  | { readonly kind: "pause" }
  | { readonly kind: "resume" }
  | { readonly kind: "clear" };

export function parseGoalCommand(rawInput: string): GoalCommand {
  const input = rawInput.trim();
  if (input.length === 0) return { kind: "show" };
  const control = input.toLowerCase();
  if (control === "clear") return { kind: "clear" };
  if (control === "pause") return { kind: "pause" };
  if (control === "resume") return { kind: "resume" };
  if (control === "edit") return { kind: "invalid-edit" };
  if (/^edit(?=\s)/iu.test(input)) return { kind: "edit", objective: input.slice(4).trim() };
  return { kind: "create", objective: input };
}

/** @deprecated 用 parseGoalCommand */
export const parseEasyGoalCommand = parseGoalCommand;

function phaseLabel(phase: GoalPhase): string {
  return phase;
}

function commandHint(goal: GoalView): string {
  if (goal.phase === "active") {
    return goal.activation === "armed"
      ? "/goal edit <objective>, /goal pause, /goal clear"
      : "/goal edit <objective>, /goal resume, /goal clear";
  }
  if (goal.phase === "complete") return "/goal <objective>, /goal clear";
  return "/goal edit <objective>, /goal resume, /goal clear";
}

export function renderGoalText(title: string, goal: GoalView): string {
  const reason = goal.phase === "blocked" ? goal.blockedReason : undefined;
  const blocker = reason ? [`Blocker: ${reason.code}: ${reason.message}`] : [];
  return [
    title,
    `Status: ${phaseLabel(goal.phase)}`,
    ...blocker,
    `Objective: ${goal.objective}`,
    `Rounds: ${goal.roundsStarted}/${goal.maxGoalRounds}`,
    `Activation: ${goal.activation}`,
    "",
    `Commands: ${commandHint(goal)}`,
  ].join("\n");
}

export const renderEasyGoalText = renderGoalText;

function missingGoal(action: string): CommandResult {
  return {
    content: `No goal is currently set; /goal ${action} requires one. ${GOAL_USAGE}`,
  };
}

export function goalIsOpen(port: SessionGoalPort | undefined): boolean {
  const current = port?.get();
  return Boolean(current && current.phase !== "complete");
}

/** @deprecated 用 goalIsOpen */
export const easyGoalIsOpen = goalIsOpen;

export function executeGoalCommand(
  args: string,
  port: SessionGoalPort | undefined,
  extras?: { harnessOpen?: boolean },
): CommandResult {
  if (!port) {
    return { content: `Goal service is not available. ${GOAL_USAGE}` };
  }
  const command = parseGoalCommand(args);
  const blocks = Boolean(extras?.harnessOpen) && command.kind !== "show" && command.kind !== "clear";
  if (blocks) {
    return {
      content: "A host-verified /ultragoal is already open. Use /ultragoal clear before starting /goal.",
    };
  }
  try {
    const current = port.get();
    switch (command.kind) {
      case "show":
        return current === undefined
          ? { content: `No goal is currently set.\n${GOAL_USAGE}` }
          : { content: renderGoalText("Goal", current), meta: { goal: current } };
      case "invalid-edit":
        return { content: `Goal editing requires a replacement objective.\n${GOAL_USAGE}` };
      case "create": {
        if (current !== undefined && current.phase !== "complete") {
          return {
            content: `A goal is already ${phaseLabel(current.phase)}. Use /goal edit <objective> to change it or /goal clear before replacing it.`,
          };
        }
        const created = port.create({ objective: command.objective });
        return {
          content: renderGoalText("Goal created", created),
          meta: { goal: created, goalArmed: true },
        };
      }
      case "edit": {
        if (current === undefined) return missingGoal("edit");
        if (current.phase === "complete") {
          const replaced = port.create({ objective: command.objective });
          return {
            content: renderGoalText("Goal created", replaced),
            meta: { goal: replaced, goalArmed: true },
          };
        }
        const edited = port.edit({ id: current.id, revision: current.revision }, { objective: command.objective });
        return { content: renderGoalText("Goal updated", edited), meta: { goal: edited } };
      }
      case "pause":
        if (current === undefined) return missingGoal("pause");
        return {
          content: renderGoalText(
            "Goal paused",
            port.pause({ id: current.id, revision: current.revision }),
          ),
        };
      case "resume": {
        if (current === undefined) return missingGoal("resume");
        const resumed = port.resume({ id: current.id, revision: current.revision });
        return {
          content: renderGoalText("Goal resumed", resumed),
          meta: { goal: resumed, goalArmed: true },
        };
      }
      case "clear":
        if (current === undefined) return { content: "No goal to clear." };
        port.clear({ id: current.id, revision: current.revision });
        return { content: "Goal cleared." };
      default:
        return { content: GOAL_USAGE };
    }
  } catch (error: unknown) {
    if (error instanceof GoalError) {
      return {
        content: "The goal command is not valid for the current state. Run /goal to view available commands.",
      };
    }
    throw error;
  }
}

export const executeEasyGoalCommand = executeGoalCommand;
