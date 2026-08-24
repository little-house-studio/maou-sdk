import { Tool, toolDir, createToolResponse, resolveToolRuntimePorts } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";

export const SUBMIT_PLAN_DESCRIPTION =
  "Submit a complete markdown implementation plan for user review while plan mode is active. " +
  "The plan must start with a # heading and be decision-complete. " +
  "Do not use this to start implementation. The user will /plan approve or /plan revise.";

export class SubmitPlanTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);
  readonly definition: ToolDefinition = {
    name: "submit_plan",
    aliases: [],
    description: SUBMIT_PLAN_DESCRIPTION,
    parameters: {
      type: "object",
      properties: {
        plan: {
          type: "string",
          description: "Full markdown plan starting with a # heading.",
        },
      },
      required: ["plan"],
      additionalProperties: false,
    },
    allowedModes: ["plan"],
    parallelSafe: false,
  };

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    const port = resolveToolRuntimePorts(ctx).sessionPlan;
    if (!port) {
      return createToolResponse(false, "submit_plan requires a session plan port");
    }
    if (!port.isActive()) {
      return createToolResponse(false, "submit_plan is only available while /plan mode is active");
    }
    const markdown = String(params.plan ?? "").trim();
    if (!markdown.startsWith("#")) {
      return createToolResponse(false, "plan markdown must start with a # heading");
    }
    try {
      const snap = port.writePlan(markdown);
      return createToolResponse(
        true,
        JSON.stringify({
          submitted: true,
          revision: snap.revision,
          status: snap.status,
          planFile: port.planFile(),
        }) +
          "\n\nPlan recorded for review. The user will /plan approve, /plan revise <notes>, or /plan off. Do not implement yet.",
      );
    } catch (error) {
      return createToolResponse(false, error instanceof Error ? error.message : String(error));
    }
  }
}
