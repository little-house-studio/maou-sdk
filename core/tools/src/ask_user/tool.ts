/**
 * ask_user — 一类提问工具：问卷 / 计划审阅。仅根会话。
 */

import { Tool, toolDir, createToolResponse, toolFail, resolveToolRuntimePorts } from "../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../base.js";
import { requestAskUser, type AskUserQuestion } from "./host.js";

function isRoot(ctx: ToolContext): boolean {
  if (ctx.parentSessionId) return false;
  const ports = resolveToolRuntimePorts(ctx);
  if (ports.isSupervisorSession) return false;
  return true;
}

function parseQuestions(raw: unknown): AskUserQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: AskUserQuestion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const id = String(rec.id ?? "").trim();
    const prompt = String(rec.prompt ?? "").trim();
    if (!id || !prompt) continue;
    const options = Array.isArray(rec.options)
      ? rec.options
          .filter((o): o is Record<string, unknown> => !!o && typeof o === "object")
          .map((o) => ({
            id: String(o.id ?? "").trim(),
            label: String(o.label ?? "").trim(),
            recommended: o.recommended === true,
          }))
          .filter((o) => o.id && o.label)
      : undefined;
    out.push({
      id,
      prompt,
      options,
      allowCustom: rec.allowCustom === true,
      skippable: rec.skippable === true,
    });
  }
  return out;
}

export class AskUserTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);
  readonly definition: ToolDefinition = {
    name: "ask_user",
    aliases: [],
    description:
      "Ask the human a questionnaire or to review the current plan. Root session only. " +
      "kind=questions: multiple items, skippable, custom answers, recommended options. " +
      "kind=plan_review: approve / reject / talk in chat.",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["questions", "plan_review"] },
        title: { type: "string" },
        questions: { type: "array" },
        plan_id: { type: "string" },
      },
      required: ["kind"],
      additionalProperties: false,
    },
    allowedModes: ["plan", "execute"],
    parallelSafe: false,
  };

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    if (!isRoot(ctx)) {
      return toolFail("mode_denied", "ask_user is only available on the root session", {
        code: "ask_user_not_root",
      });
    }
    const kind = String(params.kind ?? "").trim();
    if (kind !== "questions" && kind !== "plan_review") {
      return toolFail("invalid_args", "kind must be questions or plan_review");
    }
    if (kind === "questions") {
      const questions = parseQuestions(params.questions);
      if (!questions.length) {
        return toolFail("invalid_args", "questions kind requires a non-empty questions array");
      }
      try {
        const result = await requestAskUser({
          sessionId: ctx.sessionId,
          kind: "questions",
          title: String(params.title ?? "").trim() || undefined,
          questions,
        });
        return createToolResponse(true, JSON.stringify(result), { payload: result });
      } catch (err) {
        return toolFail("precondition", err instanceof Error ? err.message : String(err), {
          code: "ask_user_host",
        });
      }
    }

    try {
      const result = await requestAskUser({
        sessionId: ctx.sessionId,
        kind: "plan_review",
        title: String(params.title ?? "").trim() || undefined,
        planId: String(params.plan_id ?? "").trim() || undefined,
      });
      return createToolResponse(true, JSON.stringify(result), { payload: result });
    } catch (err) {
      return toolFail("precondition", err instanceof Error ? err.message : String(err), {
        code: "ask_user_host",
      });
    }
  }
}
