/**
 * TaskFinishTool — 汇报任务完成
 * 对应 Python: core/tools/impls/todo_tool.py TaskFinishTool
 *
 * 调用 TaskManager.finish() 将指定任务标记为 completed，
 * 自动更新依赖链并返回当前进度表格。
 */

import { Tool, toolDir } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { createToolResponse } from "../../base.js";
import { TASK_MANAGER } from "../task_manage/tool.js";
import { errToString } from "../../browser/god_tool/use_browser/_util.js";

export class TaskFinishTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);
  readonly definition: ToolDefinition = {
    name: "task_finish",
    aliases: [],
    description:
      "汇报当前任务节点已完成。" +
      "系统会自动更新状态为 completed，检查依赖链并返回当前进度表格。",
    parameters: {
      type: "object",
      properties: {
        task_id: {
          type: "string",
          description: "已完成的任务 ID",
        },
        summary: {
          type: "string",
          description: "完成汇报（200 字内），说明做了什么、结果如何",
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
    const taskId = String(params.task_id ?? params.taskId ?? params.id ?? "").trim();
    const summary = String(params.summary ?? "").trim();

    if (!taskId) {
      return createToolResponse(false, "task_id 不能为空");
    }

    try {
      const rendered = TASK_MANAGER.finish(ctx.sessionId, taskId, summary);

      const allTasks = TASK_MANAGER.getTasks?.(ctx.sessionId) ?? [];
      const remaining = allTasks.filter((t) => t.status !== "completed").length;

      return createToolResponse(true, rendered, {
        payload: {
          completed_task: taskId,
          remaining,
        },
        displayEvents: [
          { type: "terminal", stream: "info", text: `[任务 ${taskId} 完成]` },
        ],
      });
    } catch (err) {
      return createToolResponse(false, `任务完成操作失败: ${errToString(err)}（提示：请确认 task_id 是否正确；可先调用 task_manage action="list" 查看当前任务列表）`);
    }
  }
}
