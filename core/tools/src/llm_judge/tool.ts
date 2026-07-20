/**
 * llm_judge 工具 — 让 agent 在循环中调用辅助 LLM 做判断
 *
 * 设计目的：
 *   - 主模型 vs 辅助模型分离：主模型负责 agent 主循环（推理 + 工具调用），
 *     辅助模型负责独立判断任务（安全检查 / 代码审查 / 路由判定 / 二次确认等）
 *   - 不污染主调用上下文：辅助调用走 AuxModelCaller 独立管道，独立 token 统计
 *   - 可作为「自我审视」机制：主模型在关键决策点调用辅助模型做 sanity check
 *
 * 与直接用主模型做判断的区别：
 *   - 主模型调用 = 自己审自己（确认偏误）
 *   - llm_judge = 独立辅助模型审主模型（更客观，可换更小/更快模型做路由判定）
 *
 * 依赖：ToolContext.auxModelCaller（由 AgentRuntime 在 processToolCalls 中注入）。
 * 未注入时返回错误（说明 runtime 未配置 AuxModelCaller）。
 */

import { Tool, toolDir, resolveToolRuntimePorts } from "../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../base.js";
import { createToolResponse } from "../base.js";

export class LlmJudgeTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);
  readonly definition: ToolDefinition = {
    name: "llm_judge",
    aliases: ["llm-judge", "aux_judge", "aux-judge"],
    description:
      "调用辅助 LLM 做独立判断（安全检查/代码审查/路由判定/二次确认等）。" +
      "辅助模型与主模型分离，独立 token 统计，不污染主调用上下文。" +
      "适用场景：在关键决策点让独立模型做 sanity check；路由判定（选哪个方案）；" +
      "安全检查（这段代码/命令是否安全）；代码审查（审查自己写的代码）。" +
      "注意：辅助模型通常更小/更快，适合做轻量判断；复杂推理仍由主模型自己做。",
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description:
            "要判断的问题（必填）。例如：'以下命令是否安全执行？'、'这段代码是否有 bug？'、" +
            "'用户意图更接近方案 A 还是方案 B？'。请把判断条件写清楚。",
        },
        context: {
          type: "string",
          description:
            "给辅助模型的上下文（可选）。如待审查的代码片段、待检查的命令、方案选项列表等。" +
            "辅助模型会同时看到 question 和 context，据此给出判断。",
        },
        format: {
          type: "string",
          enum: ["text", "json"],
          description:
            "返回格式（可选，默认 text）。text=辅助模型自由文本判断；" +
            "json=辅助模型返回 JSON 对象（适合结构化判定，如 { safe: true, reason: \"...\" }）。",
        },
      },
      required: ["question"],
      additionalProperties: false,
    },
    allowedModes: ["plan", "execute"],
    // 辅助模型调用是网络请求，单次调用即可，无需并发优化标记
    parallelSafe: false,
  };

  async execute(
    params: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResponse> {
    const question = String(params.question ?? "").trim();
    const context = String(params.context ?? "").trim();
    const format = params.format === "json" ? "json" : "text";

    if (!question) {
      return createToolResponse(
        false,
        '❌ llm_judge 缺少必填参数 question（要判断的问题）。正确用法示例：\n' +
          '{"tool": "llm_judge", "params": {"question": "以下命令是否安全？", "context": "rm -rf /"}}\n' +
          "请用明确的判断问题重试。",
      );
    }

    // 依赖 runtime 注入 auxModelCaller；未注入说明 runtime 未配置辅助模型
    const ports = resolveToolRuntimePorts(ctx);
    const aux = ports.auxModelCaller;
    if (!aux) {
      return createToolResponse(
        false,
        "⚠️ llm_judge 未启用：当前 runtime 未注入 AuxModelCaller。" +
          "需要在 runtime 配置中启用辅助模型调用器（见 RuntimeOptions.auxModelCaller）。" +
          "若仅需主模型自己判断，请直接在对话中给出判断结果，不必调用此工具。",
      );
    }

    // 解析辅助模型 preset：优先用 resolveHelperPreset（agent 专属辅助模型），
    // 回退 mainPreset（未配置辅助模型时用主模型）
    const mainPreset = ports.mainPreset;
    if (!mainPreset) {
      return createToolResponse(
        false,
        "⚠️ llm_judge 无法调用：ToolContext.mainPreset 未注入（runtime 配置异常）。",
      );
    }
    const agentName = ports.runtimeAgentName ?? ctx.agentName ?? "main";
    const resolveFn = ports.resolveHelperPreset;
    const helperPreset = resolveFn ? resolveFn(agentName, mainPreset) : mainPreset;

    // 构建提示词：system 说明角色，user 是 question + context
    const systemPrompt =
      "你是独立的辅助判断模型。主 Agent 通过 llm_judge 工具把判断任务委托给你。" +
      "请基于给出的 question 和 context 给出客观、简洁、明确的判断。" +
      "不要寒暄，直接给出判断结论与简要理由。" +
      (format === "json"
        ? "请输出一个 JSON 对象（如 { ok: true, reason: \"...\" }），不要输出 JSON 以外的文字。"
        : "");

    const userPrompt = context
      ? `## Question\n${question}\n\n## Context\n${context}`
      : `## Question\n${question}`;

    const tag = `llm_judge:${agentName}`;

    try {
      if (format === "json") {
        const result = await aux.callJson(
          {
            preset: helperPreset,
            systemPrompt,
            userPrompt,
            abortSignal: undefined,
            context: { sessionId: ctx.sessionId, tag },
          },
          mainPreset, // fallback 主 preset
        );
        if (!result.ok) {
          return createToolResponse(
            false,
            `辅助模型调用失败${result.error ? `：${result.error}` : ""}（preset=${result.presetName}）。` +
              "可稍后重试，或由主模型直接做判断。",
            { payload: { ok: false, preset: result.presetName, error: result.error } },
          );
        }
        const jsonStr = result.json ? JSON.stringify(result.json) : result.content;
        return createToolResponse(
          true,
          `[llm_judge | preset=${result.presetName} | format=json]\n${jsonStr}`,
          {
            payload: {
              ok: true,
              preset: result.presetName,
              json: result.json,
              raw: result.content,
            },
          },
        );
      }

      // text 格式
      const result = await aux.callText(
        {
          preset: helperPreset,
          systemPrompt,
          userPrompt,
          abortSignal: undefined,
          context: { sessionId: ctx.sessionId, tag },
        },
        mainPreset, // fallback 主 preset
      );
      if (!result.ok) {
        return createToolResponse(
          false,
          `辅助模型调用失败${result.error ? `：${result.error}` : ""}（preset=${result.presetName}）。` +
            "可稍后重试，或由主模型直接做判断。",
          { payload: { ok: false, preset: result.presetName, error: result.error } },
        );
      }
      return createToolResponse(
        true,
        `[llm_judge | preset=${result.presetName} | format=text]\n${result.content}`,
        {
          payload: {
            ok: true,
            preset: result.presetName,
            content: result.content,
          },
        },
      );
    } catch (err) {
      const errMsg = String(err).slice(0, 300);
      return createToolResponse(
        false,
        `辅助模型调用异常：${errMsg}。可稍后重试，或由主模型直接做判断。`,
        { payload: { ok: false, error: errMsg } },
      );
    }
  }
}
