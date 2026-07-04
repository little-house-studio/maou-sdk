/**
 * subagent_delegate 工具 — 委托任务给子 Agent（文件即子 Agent 约定）。
 *
 * 设计：由 AgentRuntime 在工具初始化阶段动态实例化。每发现一个子 Agent
 * （SubagentRegistry 扫描 agents/<name>/subagents/<child>/ 目录），就调用
 * createSubagentDelegateTool(child, description) 生成一个工具实例，
 * 注册到 ToolRegistry，工具名 = `subagent_<child>`。LLM 调用此工具时，
 * 工具内部调 ctx.subagentExecutor.fork() 把任务委派给对应子 Agent。
 *
 * 与 agent_message 的区别：
 *   - agent_message：fork 克隆子 Agent（context_only 继承主 Agent 配置，
 *     主 Agent 与子 Agent 同配置，仅 session 独立）
 *   - subagent_delegate：委托给「文件即子 Agent」目录定义的独立子 Agent
 *     （context_and_config，子 Agent 用自己的 agent.json / ROLE 配置）
 *
 * 注：不进 registerBuiltins 静态注册（避免无子 Agent 时向 LLM 暴露无意义工具）。
 * AgentRuntime 在 run() 工具初始化阶段按 SubagentRegistry 扫描结果动态注册。
 */

import { Tool } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { createToolResponse } from "../../base.js";

/**
 * 创建一个 subagent delegate 工具实例（对应一个子 Agent）。
 *
 * @param subagentName 子 Agent 名（目录名）
 * @param description 子 Agent 描述（从 agent.json/defineAgent 提取）
 */
export function createSubagentDelegateTool(
  subagentName: string,
  description: string,
): Tool {
  const toolName = `subagent_${subagentName}`;
  const desc =
    description?.trim() ||
    `委托任务给子 Agent「${subagentName}」。子 Agent 在独立 session 中执行，返回最终输出。`;

  // 局部类：每个实例绑定一个子 Agent 名
  class _SubagentDelegateTool extends Tool {
    // 不设 schemaDir：动态实例的 schema 由 definition.parameters 直接生成
    // （schema.json 的 name 是静态 "subagent_delegate"，与动态工具名 subagent_<name>
    //   不一致，故动态实例不使用 schemaDir，避免 nativeToolSchemas 读到错误的 name）
    readonly definition: ToolDefinition = {
      name: toolName,
      aliases: [],
      description: desc,
      parameters: {
        type: "object",
        properties: {
          task: {
            type: "string",
            description: `要委托给「${subagentName}」的任务描述（自然语言）。`,
          },
        },
        required: ["task"],
        additionalProperties: false,
      },
      allowedModes: ["execute"],
    };

    async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
      const task = String(params.task ?? "").trim();
      if (!task) {
        return createToolResponse(false, "请提供 task（要委托给子 Agent 的任务描述）。");
      }
      if (!ctx.subagentExecutor) {
        return createToolResponse(
          false,
          `子 Agent 执行器未注入，无法委托任务给「${subagentName}」。` +
            `runtime 需通过 setSubagentExecutor() 注入执行器（SDK Runtime 门面已默认注入）。`,
        );
      }

      const taskId = `delegate-${subagentName}-${Date.now().toString(36)}`;
      try {
        const result = await ctx.subagentExecutor.fork(taskId, task, {
          // 委托给文件即子 Agent：用独立 agent 配置
          forkMode: "context_and_config",
          agentName: subagentName,
        });
        const status = result.ok ? "✅" : "❌";
        const lines = [
          `${status} 子 Agent「${subagentName}」执行完成（${result.elapsedMs}ms）`,
          `taskId: ${result.taskId}`,
          `subSessionId: ${result.subSessionId}`,
          result.error ? `error: ${result.error}` : "",
          "── 输出 ──",
          result.output || "(无输出)",
        ].filter(Boolean);
        return createToolResponse(result.ok, lines.join("\n"), {
          payload: { result, subagent: subagentName },
          displayEvents: [
            { type: "terminal", stream: "info", text: `[子 Agent] ${subagentName} 完成: ok=${result.ok}` },
          ],
        });
      } catch (err) {
        return createToolResponse(
          false,
          `委托子 Agent「${subagentName}」失败: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  return new _SubagentDelegateTool();
}

/**
 * SubagentDelegateTool — 静态占位类，仅用于类型导出（不进 registerBuiltins）。
 *
 * 真正的工具实例由 AgentRuntime 通过 createSubagentDelegateTool() 动态创建。
 * 此类导出仅为：① 文档化工具契约；② 让调用方可 `import { SubagentDelegateTool }`
 *    做类型断言。LLM 永远看不到此占位（无静态注册 → nativeToolSchemas 不含它）。
 */
export class SubagentDelegateTool extends Tool {
  readonly definition: ToolDefinition = {
    name: "__subagent_delegate_slot__",
    aliases: [],
    description:
      "[内部占位] subagent delegate 工具类别。实际工具由 runtime 动态注册为 subagent_<name>。",
    parameters: {
      type: "object",
      properties: {
        task: { type: "string", description: "任务描述" },
      },
      required: ["task"],
      additionalProperties: false,
    },
    allowedModes: ["execute"],
  };

  async execute(_params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResponse> {
    return createToolResponse(
      false,
      "subagent_delegate 占位工具不应被调用。" +
        "实际工具由 runtime 在工具初始化阶段动态注册为 subagent_<name>。" +
        "若看到此消息，说明没有子 Agent 被发现，或工具初始化有误。",
    );
  }
}
