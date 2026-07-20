/**
 * TodoFinishTool — 汇报单条 todo 完成（completed | failed）
 *
 * 公开名 todo_finish；兼容别名 task_finish。
 * 生产路径走 TodoOrchestrator.finish（依赖锁 / lane / 事件）。
 */

import { Tool, toolDir } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { createToolResponse } from "../../base.js";
import { errToString } from "../../util/common.js";

export class TodoFinishTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);
  readonly definition: ToolDefinition = {
    name: "todo_finish",
    aliases: ["task_finish"],
    description:
      "汇报当前负责的**一个** todo 节点完成或失败。" +
      "status=completed 解锁依赖它的下游；status=failed 不解锁下游、也不自动失败其它节点。" +
      "一次调用只代表 task_id 这一个节点。链结束时请带上 report 完整汇报。",
    parameters: {
      type: "object",
      properties: {
        task_id: {
          type: "string",
          description: "当前节点 ID",
        },
        status: {
          type: "string",
          enum: ["completed", "failed"],
          description: "completed=成功完成 | failed=失败类完成（写明原因）",
        },
        summary: {
          type: "string",
          description: "短说明（做了什么 / 失败原因摘要）",
        },
        report: {
          type: "string",
          description: "完整交接汇报（链终点或需要下游阅读时填写）",
        },
        reason: {
          type: "string",
          description: "failed 时的原因（可与 summary 相同）",
        },
      },
      required: ["task_id", "summary"],
    },
    allowedModes: ["execute"],
    endsLoop: true,
  };

  async execute(
    params: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResponse> {
    const taskId = String(
      params.task_id ?? params.todo_id ?? params.taskId ?? params.id ?? "",
    ).trim();
    const summary = String(params.summary ?? "").trim();
    const report = params.report != null ? String(params.report) : undefined;
    const reason = params.reason != null ? String(params.reason) : undefined;
    let status = String(params.status ?? "completed").trim().toLowerCase();
    if (status !== "completed" && status !== "failed") {
      status = "completed";
    }

    if (!taskId) {
      return createToolResponse(false, "task_id（todo id）不能为空");
    }
    if (!summary) {
      return createToolResponse(false, "summary 不能为空");
    }
    if (status === "failed" && !reason && !summary) {
      return createToolResponse(false, "failed 时请在 summary 或 reason 中说明原因");
    }

    try {
      const { getTodoOrchestrator } = await import("../todo-orchestrator-host.js");
      const orch = getTodoOrchestrator();
      const rendered = orch.finish(ctx.sessionId, {
        taskId,
        status: status as "completed" | "failed",
        summary,
        report,
        reason,
        actorSessionId: ctx.sessionId,
      });
      const notices = orch.drainNotices(ctx.sessionId);
      const allTasks = orch.getTasks(ctx.sessionId);
      const remaining = allTasks.filter(
        (t) => t.status === "pending" || t.status === "in_progress",
      ).length;

      return createToolResponse(true, rendered, {
        payload: {
          completed_task: taskId,
          completed_todo: taskId,
          status,
          remaining,
          todo_notices: notices,
          lanes: orch.getLanes(ctx.sessionId),
        },
        displayEvents: [
          {
            type: "terminal",
            stream: "info",
            text: status === "failed" ? `[todo ${taskId} failed]` : `[todo ${taskId} 完成]`,
          },
        ],
      });
    } catch (err) {
      return createToolResponse(
        false,
        `Todo 完成操作失败: ${errToString(err)}（提示：确认 task_id；可先 todo_manage action=list）`,
      );
    }
  }
}

/** @deprecated 使用 TodoFinishTool */
export const TaskFinishTool = TodoFinishTool;
