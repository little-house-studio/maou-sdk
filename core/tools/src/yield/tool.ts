/**
 * yield 工具 — 子 Agent 提交结构化结果并结束运行（P2-1）。
 *
 * 设计目的：
 *   - 子 Agent 完成任务后，通过此工具把结构化 result 交给父 Agent
 *   - fork 检测到 yield 后结束子 Agent 循环（子 Agent 不再继续跑）
 *   - 若父 Agent 设了 outputSchema，fork 会校验 result；校验失败让子 Agent 重试
 *
 * 与 todo_finish 的区别：
 *   - todo_finish 标记 todo_manage 里的清单节点完成（会话级 todo 规划）
 *   - yield 是子 Agent 把最终产出交回父 Agent（fork/subagent 委托系统）
 *   - 子 Agent 通常只调其一：被 fork 出来的子 Agent 调 yield；todo 节点完成调 todo_finish
 *
 * 依赖：ToolContext.yieldResult（由 SubagentExecutor.fork 注入到子 Agent 的 ctx）。
 * 未注入时返回错误（说明当前不是子 Agent 上下文，是主 Agent）。
 *
 * 工具本身不结束 loop（endsLoop 未设）——loop 的结束由 fork 检测到 yield 事件后
 * 通过 abortController 完成；工具只负责把 result 通过回调上交。这样设计是因为
 * 工具的 endsLoop 会让当前轮结束后退出 loop，但 fork 需要在更外层（事件消费层）
 * 检测 yield，故用 abort + 事件而非 endsLoop 标记。
 */

import { Tool, toolDir } from "../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../base.js";
import { createToolResponse } from "../base.js";

export class YieldTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);
  readonly definition: ToolDefinition = {
    name: "yield",
    aliases: ["submit", "return_result"],
    description:
      "子 Agent 提交结构化结果并结束运行。仅在作为子 Agent（被 agent_message fork / subagent_delegate 调用）时使用。" +
      "调用后 fork 检测到 yield 即结束子 Agent 循环并把结果交回父 Agent；" +
      "若父 Agent 设了 outputSchema，结果会先校验，校验失败会反馈让你重新 yield。",
    parameters: {
      type: "object",
      properties: {
        result: {
          type: "string",
          description:
            "提交的结果（必填）。可以是纯文本，也可以是 JSON 字符串" +
            "（若父 Agent 设了 outputSchema，应按 schema 输出 JSON 字符串）。" +
            "这是子 Agent 给父 Agent 的最终结构化产出，请确保完整、准确。",
        },
        summary: {
          type: "string",
          description: "简短摘要（可选，200 字内）。一句话说明结果要点，便于父 Agent 快速预览。",
        },
      },
      required: ["result"],
      additionalProperties: false,
    },
    allowedModes: ["plan", "execute"],
    // yield 不设 parallelSafe（写操作/有状态：触发 fork 结束）
    parallelSafe: false,
  };

  async execute(
    params: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResponse> {
    const result = String(params.result ?? "").trim();
    const summary = String(params.summary ?? "").trim();

    if (!result) {
      return createToolResponse(
        false,
        "❌ yield 缺少必填参数 result（提交的结果）。正确用法示例：\n" +
          '{"tool": "yield", "params": {"result": "{ \\"answer\\": \\"...\\", \\"files\\": [...] }", "summary": "已完成 X 并产出 Y"}}\n' +
          "请用完整准确的结果重试。",
      );
    }

    // 依赖 fork 注入 yieldResult；未注入说明当前不是子 Agent 上下文
    const submit = ctx.yieldResult;
    if (!submit) {
      return createToolResponse(
        false,
        "⚠️ yield 未启用：当前不是子 Agent 上下文（ToolContext.yieldResult 未注入）。\n" +
          "yield 工具仅供被 fork / subagent_delegate 出来的子 Agent 提交结果。\n" +
          "若你是主 Agent，直接在对话中给出结果即可，不需要调用此工具。",
      );
    }

    // 通过回调把 result + summary 上交给 fork
    // fork 检测到 yield 后会结束子 Agent 循环（通过 abortController）
    try {
      submit(result, summary || undefined);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return createToolResponse(
        false,
        `yield 提交失败：${errMsg.slice(0, 200)}`,
        { payload: { ok: false, error: errMsg } },
      );
    }

    // 返回成功提示（子 Agent 通常会在被 abort 前看到此结果）
    const preview = result.length > 200 ? result.slice(0, 200) + "…" : result;
    return createToolResponse(
      true,
      `[yield] 已提交结果${summary ? `（summary: ${summary.slice(0, 100)}）` : ""}。\n` +
        `fork 将结束子 Agent 循环并把结果交回父 Agent。预览：\n${preview}`,
      {
        payload: {
          ok: true,
          summary: summary || null,
          resultLength: result.length,
        },
        displayEvents: [
          { type: "terminal", stream: "info", text: `[yield] 子 Agent 提交结果（${result.length} 字符）` },
        ],
      },
    );
  }
}
