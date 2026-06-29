/**
 * supervisor_task_control —— 监督 Agent 生命周期控制工具。
 *
 * 监督 Agent 专用，仅在 /goal 模式下可用。
 * action:
 *   - start: 启动监督（绑定 plan，进入工作状态）
 *   - confirm_end: 向用户发起验收（第一次确认）
 *   - end: 完全结束监督模式（清除绑定，切回主 Agent）
 */

import { Tool } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { createToolResponse } from "../../base.js";

export class SupervisorTaskControlTool extends Tool {
  readonly definition: ToolDefinition = {
    name: "supervisor_task_control",
    aliases: ["supervisor-control", "supervisor_task"],
    allowedModes: null,
    description:
      "监督 Agent 生命周期控制（仅 /goal 监督模式下可用）。" +
      "action=start: 启动监督，把确认后的任务计划 MD 绑定到主 Agent；" +
      "action=confirm_end: 任务完成，向用户发起验收；" +
      "action=end: 用户验收通过，完全结束监督模式。" +
      "必须在监督 Agent session 内调用。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["start", "confirm_end", "end"],
          description: "start=启动监督 | confirm_end=发起验收 | end=完全结束监督",
        },
        plan: {
          type: "string",
          description:
            "任务计划 MD（action=start 时必填）—— 包含任务要求、细节、验收标准等。" +
            "确认开始后，这份计划会绑定到主 Agent 作为任务文件。",
        },
        summary: {
          type: "string",
          description:
            "任务总结（action=confirm_end 时建议填）—— 简要说明任务完成情况，发给用户验收。",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
  };

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    // 仅监督 Agent session 可用
    if (!ctx.isSupervisorSession) {
      return createToolResponse(
        false,
        "此工具仅在 /goal 监督模式下可用。用 /goal 指令启动监督模式。",
      );
    }

    const mgr = ctx.supervisorManager;
    if (!mgr) {
      return createToolResponse(false, "未注入 supervisorManager（harness 配置错误）。");
    }

    const action = String(params.action ?? "").trim();
    const plan = String(params.plan ?? "").trim();
    const summary = String(params.summary ?? "").trim();

    // 查监督绑定
    const binding = mgr.getBySupervisor(ctx.sessionId);
    if (!binding) {
      return createToolResponse(false, "未找到监督绑定记录（session 可能已过期）。");
    }

    switch (action) {
      case "start": {
        if (!plan) {
          return createToolResponse(false, "action=start 时必须传 plan（任务计划 MD）。");
        }
        if (binding.state !== "planning") {
          return createToolResponse(false, `当前状态为 ${binding.state}，不能 start（只能从 planning 状态启动）。`);
        }
        mgr.updatePlan(binding.mainSessionId, plan);
        mgr.updateState(binding.mainSessionId, "started");
        return createToolResponse(
          true,
          "✅ 监督已启动。任务计划已绑定。现在可以用 supervisor_chat_main 工具派任务给主 Agent。",
          { payload: { state: "started", planLength: plan.length } },
        );
      }
      case "confirm_end": {
        if (binding.state !== "started") {
          return createToolResponse(false, `当前状态为 ${binding.state}，只能从 started 状态发起验收。`);
        }
        mgr.updateState(binding.mainSessionId, "confirming");
        const userMsg = summary
          ? `📋 **任务完成验收**\n\n${summary}\n\n请确认是否可以结束监督模式（回复"确认"或"继续修改"）。`
          : `📋 **任务完成验收**\n\n主 Agent 已汇报任务完成。请确认是否可以结束监督模式（回复"确认"或"继续修改"）。`;
        return createToolResponse(
          true,
          userMsg,
          { payload: { state: "confirming" } },
        );
      }
      case "end": {
        if (binding.state !== "confirming") {
          return createToolResponse(false, `当前状态为 ${binding.state}，只能从 confirming 状态结束（请先调用 confirm_end）。`);
        }
        mgr.updateState(binding.mainSessionId, "ended");
        const unbound = mgr.unbind(binding.mainSessionId);
        return createToolResponse(
          true,
          "✅ 监督模式已结束。聊天对象切换回主 Agent。",
          {
            payload: { state: "ended", unbound },
            // 通过 displayEvents 通知前端切换 session
            displayEvents: [{
              type: "supervisor_end",
              text: binding.mainSessionId,
              stream: "info",
            }],
          },
        );
      }
      default:
        return createToolResponse(false, `不支持的 action: ${action}。支持: start / confirm_end / end`);
    }
  }
}
