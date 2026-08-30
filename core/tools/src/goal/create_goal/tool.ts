import { Tool, toolDir } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { CREATE_GOAL_DESCRIPTION, failGoal, hasRoundCap, okGoal, rejectIfHostGoalOpen, requireDirectHuman, requireGoalPort } from "../shared.js";

export class CreateGoalTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);
  readonly definition: ToolDefinition = {
    name: "create_goal",
    aliases: [],
    description: CREATE_GOAL_DESCRIPTION,
    parameters: {
      type: "object",
      properties: {
        objective: {
          type: "string",
          description: "The concrete completion objective inferred from the direct human request.",
        },
        max_goal_rounds: {
          type: "number",
          description: "Optional positive safe-integer limit on automatic continuation rounds.",
        },
      },
      required: ["objective"],
      additionalProperties: false,
    },
    allowedModes: ["plan", "execute"],
    parallelSafe: false,
  };

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    const blocked = rejectIfHostGoalOpen(ctx);
    if (blocked) return blocked;
    const ready = requireGoalPort(ctx);
    if (!ready.ok) return ready.response;
    try {
      requireDirectHuman(ready.port);
      const goal = ready.port.create({
        objective: String(params.objective ?? ""),
        ...(hasRoundCap(params.max_goal_rounds) ? { maxGoalRounds: params.max_goal_rounds } : {}),
      });
      return okGoal(goal);
    } catch (error) {
      return failGoal(error);
    }
  }
}
