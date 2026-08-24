import { Tool, toolDir, createToolResponse } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { GoalError } from "@little-house-studio/types";
import {
  UPDATE_GOAL_DESCRIPTION,
  failGoal,
  hasRoundCap,
  hasText,
  okGoal,
  rejectIfHostGoalOpen,
  requireCompletionAuthority,
  requireDirectHuman,
  requireGoalPort,
} from "../shared.js";

const UPDATE_ACTIONS = ["edit", "pause", "resume", "complete", "blocked"] as const;
type UpdateAction = (typeof UPDATE_ACTIONS)[number];

export class UpdateGoalTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);
  readonly definition: ToolDefinition = {
    name: "update_goal",
    aliases: [],
    description: UPDATE_GOAL_DESCRIPTION,
    parameters: {
      type: "object",
      properties: {
        goal_id: { type: "string", description: "Exact id returned by get_goal." },
        revision: { type: "number", description: "Exact positive revision returned by get_goal." },
        action: {
          type: "string",
          enum: [...UPDATE_ACTIONS],
          description: "edit | pause | resume | complete | blocked",
        },
        objective: { type: "string", description: "Replacement objective; valid only with action edit." },
        max_goal_rounds: { type: "number", description: "Replacement cap; valid only with action edit." },
        blocked_reason: {
          type: "string",
          description: "Concrete blocking condition; required only with action blocked.",
        },
      },
      required: ["goal_id", "revision", "action"],
      additionalProperties: false,
    },
    allowedModes: ["execute"],
    parallelSafe: false,
  };

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    const blocked = rejectIfHostGoalOpen(ctx);
    if (blocked) return blocked;
    const ready = requireGoalPort(ctx);
    if (!ready.ok) return ready.response;
    const port = ready.port;
    try {
      const goalId = String(params.goal_id ?? "").trim();
      const revision = params.revision;
      if (!goalId || !Number.isSafeInteger(revision) || (revision as number) < 1) {
        throw new GoalError("goal_id must be non-empty and revision must be a positive safe integer", "GOAL_STALE_REVISION");
      }
      const ref = { id: goalId, revision: revision as number };
      const action = String(params.action ?? "") as UpdateAction;
      const replacements = {
        ...(hasText(params.objective) ? { objective: params.objective } : {}),
        ...(hasRoundCap(params.max_goal_rounds) ? { maxGoalRounds: params.max_goal_rounds } : {}),
      };

      if (action === "edit") {
        requireDirectHuman(port);
        if (hasText(params.blocked_reason)) {
          throw new GoalError("blocked_reason is valid only with action blocked", "GOAL_INVALID_EDIT");
        }
        return okGoal(port.edit(ref, replacements));
      }
      if (action === "pause" || action === "resume") {
        requireDirectHuman(port);
        if (hasText(params.objective) || hasRoundCap(params.max_goal_rounds) || hasText(params.blocked_reason)) {
          throw new GoalError(
            "objective and max_goal_rounds are valid only with action edit; blocked_reason is valid only with action blocked",
            "GOAL_INVALID_EDIT",
          );
        }
        return okGoal(action === "pause" ? port.pause(ref) : port.resume(ref));
      }

      if (port.authority.kind === "goal-round" && (action === "complete" || action === "blocked")) {
        return createToolResponse(
          false,
          "During a goal-mode round, end with <task_completion>...</task_completion> instead of update_goal complete/blocked.",
        );
      }

      requireCompletionAuthority(port);
      if (hasText(params.objective) || hasRoundCap(params.max_goal_rounds)) {
        throw new GoalError("objective and max_goal_rounds are valid only with action edit", "GOAL_INVALID_EDIT");
      }
      if (action === "complete" && hasText(params.blocked_reason)) {
        throw new GoalError("blocked_reason is valid only with action blocked", "GOAL_INVALID_EDIT");
      }
      if (action === "blocked" && !hasText(params.blocked_reason)) {
        throw new GoalError("blocked_reason is required with action blocked", "GOAL_INVALID_BLOCK_REASON");
      }
      if (action !== "complete" && action !== "blocked") {
        throw new GoalError(`unknown update_goal action "${action}"`, "GOAL_INVALID_EDIT");
      }

      const goal = action === "complete"
        ? port.complete(ref)
        : port.block(ref, { code: "model-reported", message: String(params.blocked_reason) });
      return okGoal(goal);
    } catch (error) {
      return failGoal(error);
    }
  }
}
