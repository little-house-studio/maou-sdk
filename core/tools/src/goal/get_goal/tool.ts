import { Tool, toolDir } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { GET_GOAL_DESCRIPTION, failGoal, okGoal, requireGoalPort } from "../shared.js";

export class GetGoalTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);
  readonly definition: ToolDefinition = {
    name: "get_goal",
    aliases: [],
    description: GET_GOAL_DESCRIPTION,
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    allowedModes: ["plan", "execute"],
    parallelSafe: true,
  };

  async execute(_params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    const ready = requireGoalPort(ctx);
    if (!ready.ok) return ready.response;
    try {
      return okGoal(ready.port.get());
    } catch (error) {
      return failGoal(error);
    }
  }
}
