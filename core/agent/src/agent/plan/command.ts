/**
 * `/plan`：调查并写成合同，用户确认后再执行。
 */

import {
  sessionPlan,
  sessionPlanFile,
  renderPlanImplement,
  renderPlanKickoff,
  renderPlanRevise,
} from "@little-house-studio/context";
import type { CommandResult } from "../command-registry.js";

export const PLAN_USAGE =
  "Usage: /plan [<objective>|off|status|view|approve|revise <notes>|clear]";

export type PlanCommand =
  | { readonly kind: "status" }
  | { readonly kind: "off" }
  | { readonly kind: "view" }
  | { readonly kind: "approve" }
  | { readonly kind: "clear" }
  | { readonly kind: "revise"; readonly notes: string }
  | { readonly kind: "invalid-revise" }
  | { readonly kind: "enter"; readonly objective?: string };

export function parsePlanCommand(rawInput: string): PlanCommand {
  const trimmed = rawInput.trim();
  const key = trimmed.toLowerCase();
  if (key === "" || key === "status") return { kind: "status" };
  if (key === "off") return { kind: "off" };
  if (key === "view") return { kind: "view" };
  if (key === "approve") return { kind: "approve" };
  if (key === "clear") return { kind: "clear" };
  if (key === "revise") return { kind: "invalid-revise" };
  if (/^revise(?=\s)/iu.test(trimmed)) return { kind: "revise", notes: trimmed.slice(6).trim() };
  return { kind: "enter", objective: trimmed };
}

export function executePlanCommand(
  args: string,
  sessionDir: string | undefined,
  sessionId: string,
): CommandResult {
  if (!sessionDir) {
    return { content: `Plan service is not available. ${PLAN_USAGE}` };
  }
  const command = parsePlanCommand(args);
  const current = sessionPlan.get(sessionDir, sessionId);
  const file = sessionPlanFile(sessionDir, sessionId);

  switch (command.kind) {
    case "status": {
      if (!current) {
        return {
          content: `No plan is currently set.\n${PLAN_USAGE}`,
        };
      }
      return { content: renderPlanStatus("Plan", current, file) };
    }
    case "view": {
      const text = sessionPlan.readPlan(sessionDir, sessionId);
      if (!text) return { content: `No plan file yet.\n${PLAN_USAGE}` };
      return { content: text };
    }
    case "off": {
      const next = sessionPlan.off(sessionDir, sessionId);
      return { content: next ? renderPlanStatus("Plan mode off.", next, file) : "No plan mode to leave." };
    }
    case "clear":
      if (!sessionPlan.clear(sessionDir, sessionId)) return { content: "No plan to clear." };
      return { content: "Plan cleared." };
    case "invalid-revise":
      return { content: `Revising requires notes.\n${PLAN_USAGE}` };
    case "revise": {
      if (!current) return { content: `No plan to revise. Use /plan <objective>.\n${PLAN_USAGE}` };
      sessionPlan.revise(sessionDir, sessionId);
      return {
        content: renderPlanStatus("Plan revise", current, file),
        meta: {
          asUserTask: true,
          taskPrompt: renderPlanRevise(command.notes, file),
          planArmed: true,
        },
      };
    }
    case "approve": {
      if (!current) return { content: `No plan to approve. ${PLAN_USAGE}` };
      const markdown = sessionPlan.readPlan(sessionDir, sessionId);
      if (!markdown?.trim()) {
        return { content: "No plan file to approve. Stay in /plan and submit a plan first." };
      }
      const approved = sessionPlan.approve(sessionDir, sessionId);
      return {
        content: approved ? renderPlanStatus("Plan approved.", approved, file) : "Could not approve the plan.",
        meta: {
          asUserTask: true,
          taskPrompt: renderPlanImplement(markdown),
        },
      };
    }
    case "enter": {
      const created = sessionPlan.enter(sessionDir, sessionId, command.objective);
      if (!command.objective) {
        return { content: renderPlanStatus("Plan mode on. Send a task or /plan <objective>.", created, file) };
      }
      return {
        content: renderPlanStatus("Plan mode on.", created, file),
        meta: {
          asUserTask: true,
          taskPrompt: renderPlanKickoff(command.objective, file),
          planArmed: true,
        },
      };
    }
    default:
      return { content: PLAN_USAGE };
  }
}

function renderPlanStatus(
  title: string,
  snap: { status: string; active: boolean; objective: string; planReady: boolean; revision: number },
  file: string,
): string {
  return [
    title,
    `Mode: ${snap.active ? "plan" : "off"} | Status: ${snap.status}`,
    `Objective: ${snap.objective || "(none)"}`,
    `Plan file: ${snap.planReady ? file : "(not written)"}`,
    `Revision: ${snap.revision}`,
    "",
    "Commands: /plan <objective>, /plan view, /plan approve, /plan revise <notes>, /plan off, /plan clear",
  ].join("\n");
}
