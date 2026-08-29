import { Tool, toolDir, createToolResponse, resolveToolRuntimePorts } from "../../base.js";
import { toolFail } from "../../errors.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { getAskUserHost, requestAskUser } from "../../ask_user/host.js";
import type { AskUserPlanDecision } from "../../ask_user/host.js";

export const SUBMIT_PLAN_DESCRIPTION =
  "Submit a complete markdown implementation plan for user review while plan mode is active. " +
  "The plan must start with a # heading and be decision-complete. " +
  "Do not use this to start implementation. This call blocks until the user approves, " +
  "rejects, or asks to discuss it.";

/**
 * 审阅只对根会话弹（子 agent 的计划不该抢用户的屏），且必须有宿主接住。
 * 两者任一不成立就退回「写盘 + 让用户走 /plan approve」的老路，绝不硬失败。
 */
function canBlockForReview(ctx: ToolContext): boolean {
  if (!getAskUserHost()) return false;
  if (ctx.parentSessionId) return false;
  return !resolveToolRuntimePorts(ctx).isSupervisorSession;
}

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
    let snap;
    try {
      snap = port.writePlan(markdown);
    } catch (error) {
      return createToolResponse(false, error instanceof Error ? error.message : String(error));
    }
    const planFile = port.planFile();
    const base = {
      submitted: true,
      revision: snap.revision,
      status: snap.status,
      planFile,
    };

    if (!canBlockForReview(ctx)) {
      // 无 UI 宿主（headless / 子 agent）：保持老行为，交给 /plan approve
      return createToolResponse(
        true,
        JSON.stringify(base) +
          "\n\nPlan recorded for review. The user will /plan approve, /plan revise <notes>, or /plan off. Do not implement yet.",
      );
    }

    let decision: AskUserPlanDecision["decision"];
    let note: string | undefined;
    try {
      const result = await requestAskUser({
        sessionId: ctx.sessionId,
        kind: "plan_review",
        title: snap.objective?.trim() || undefined,
        planId: snap.id,
        planMarkdown: markdown,
        planFile,
        planRevision: snap.revision,
      });
      if (result.kind !== "plan_review") {
        // 分类显式给，别让宿主协议错误掉进 classify 的正则里
        return toolFail(
          "precondition",
          "plan review host returned the wrong answer kind",
          { code: "plan_review_host" },
        );
      }
      decision = result.decision;
      note = result.note?.trim() || undefined;
    } catch (error) {
      // 超时 / 被新的提问顶掉：计划已落盘，退回手动路径，别把这一轮判死
      return createToolResponse(
        true,
        JSON.stringify({ ...base, review: "unavailable" }) +
          `\n\nPlan review could not be collected (${
            error instanceof Error ? error.message : String(error)
          }). The plan is saved; the user will /plan approve, /plan revise <notes>, or /plan off. Do not implement yet.`,
      );
    }

    if (decision === "approve") {
      const approved = port.approve();
      return createToolResponse(
        true,
        JSON.stringify({
          ...base,
          decision,
          status: approved?.status ?? "approved",
          ...(note ? { note } : {}),
        }) +
          "\n\nThe user APPROVED the plan. Plan mode is off — start implementing it now, step by step." +
          (note ? `\nUser note: ${note}` : ""),
      );
    }

    if (decision === "reject") {
      return createToolResponse(
        true,
        JSON.stringify({ ...base, decision, ...(note ? { note } : {}) }) +
          "\n\nThe user REJECTED the plan. Stay in plan mode, rework it, and submit_plan again. Do not implement." +
          (note ? `\nUser note: ${note}` : ""),
      );
    }

    return createToolResponse(
      true,
      JSON.stringify({ ...base, decision, ...(note ? { note } : {}) }) +
        "\n\nThe user wants to DISCUSS the plan in chat. Stay in plan mode, stop this turn, and wait for their message." +
        (note ? `\nUser note: ${note}` : ""),
    );
  }
}
