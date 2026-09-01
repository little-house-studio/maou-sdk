/**
 * report_to_parent — 子会话汇报通道。父/兄默认不可见。
 */

import { Tool, toolDir, createToolResponse, toolFail } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { pushQuietReport, wakeParent } from "./host.js";

function parentIdOf(ctx: ToolContext): string | undefined {
  const explicit = ctx.parentSessionId?.trim();
  if (explicit) return explicit;
  const mark = "::fork::";
  const idx = ctx.sessionId.lastIndexOf(mark);
  if (idx > 0) return ctx.sessionId.slice(0, idx);
  return undefined;
}

export class ReportToParentTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);
  readonly definition: ToolDefinition = {
    name: "report_to_parent",
    aliases: [],
    description:
      "Report progress to the parent session. wake=true enqueues on the parent inbox; " +
      "wake=false injects into the parent dynamic context. Does not abort this session.",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string" },
        wake: { type: "boolean" },
      },
      required: ["message"],
      additionalProperties: false,
    },
    allowedModes: ["plan", "execute"],
    parallelSafe: false,
  };

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    const parentId = parentIdOf(ctx);
    if (!parentId) {
      return toolFail("precondition", "report_to_parent requires a parent session", {
        code: "no_parent",
      });
    }
    const message = String(params.message ?? "").trim();
    if (!message) {
      return toolFail("invalid_args", "message is required");
    }
    const wake = params.wake === true;
    if (wake) {
      if (!wakeParent(parentId, message, ctx.sessionId, ctx.agentName)) {
        return toolFail("precondition", "parent inbox is not bound", { code: "no_wake_host" });
      }
    } else {
      pushQuietReport(parentId, {
        fromSessionId: ctx.sessionId,
        fromAgent: ctx.agentName,
        message,
        at: Date.now(),
      });
    }
    return createToolResponse(true, wake ? "reported to parent inbox" : "reported quietly", {
      payload: { parentSessionId: parentId, wake },
    });
  }
}
