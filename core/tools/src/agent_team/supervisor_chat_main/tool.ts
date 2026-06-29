/**
 * supervisor_chat_main —— 监督 Agent → 主 Agent 沟通工具。
 *
 * 监督 Agent 专用，仅在 /goal 模式下可用。
 * 监督 Agent 通过此工具把指令派给主 Agent，主 Agent 执行一轮 loop 后汇报。
 * 工具返回主 Agent 的最终输出文本（监督 Agent 据此判断是否继续）。
 */

import { Tool } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { createToolResponse } from "../../base.js";

export class SupervisorChatMainTool extends Tool {
  readonly definition: ToolDefinition = {
    name: "supervisor_chat_main",
    aliases: ["supervisor-chat", "chat-main"],
    allowedModes: null,
    description:
      "监督 Agent 跟主 Agent 沟通（仅 /goal 监督模式下可用）。" +
      "把指令派给主 Agent，主 Agent 执行一轮 loop 后汇报。" +
      "工具返回主 Agent 的最终输出文本。" +
      "监督 Agent 据此判断任务是否完成，未完成可继续调用此工具派发后续指令。",
    parameters: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description:
            "发给主 Agent 的指令/消息。应包含明确的执行指令，主 Agent 会执行并汇报。" +
            "首次派任务时，应包含完整的任务计划 MD。",
        },
        wait: {
          type: "boolean",
          description:
            "是否等待主 Agent 完成（默认 true）。" +
            "false=立即返回（fire-and-forget，主 Agent 异步执行）；" +
            "true=阻塞等待主 Agent 完成 loop 后返回汇报内容。",
        },
      },
      required: ["message"],
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

    const message = String(params.message ?? "").trim();
    const wait = params.wait !== false; // 默认 true

    if (!message) {
      return createToolResponse(false, "请提供 message（发给主 Agent 的指令）。");
    }

    // 查监督绑定（必须 state=started 才能跟主 Agent 沟通）
    const mgr = ctx.supervisorManager;
    if (!mgr) {
      return createToolResponse(false, "未注入 supervisorManager（harness 配置错误）。");
    }
    const binding = mgr.getBySupervisor(ctx.sessionId);
    if (!binding) {
      return createToolResponse(false, "未找到监督绑定记录（session 可能已过期）。");
    }
    if (binding.state !== "started") {
      return createToolResponse(false, `当前监督状态为 ${binding.state}，必须先 start 才能跟主 Agent 沟通。`);
    }

    // 必须有 callMainAgent 函数（由 harness 注入）
    if (!ctx.callMainAgent) {
      return createToolResponse(
        false,
        "未注入 callMainAgent 函数。harness 需在 ToolContext 注入此函数。",
      );
    }

    try {
      const gen = ctx.callMainAgent(message);
      let finalOutput = "";
      while (true) {
        const { value, done } = await gen.next();
        if (done) {
          finalOutput = value ?? "";
          break;
        }
      }

      if (!finalOutput.trim()) {
        return createToolResponse(
          true,
          "主 Agent 已执行完毕，但没有返回输出内容。可能任务已在执行但无最终文本响应。",
        );
      }

      return createToolResponse(
        true,
        `**主 Agent 汇报内容：**\n\n${finalOutput}`,
        { payload: { mainSessionId: binding.mainSessionId, outputLength: finalOutput.length } },
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return createToolResponse(false, `调用主 Agent 失败: ${errMsg}`);
    }
  }
}
