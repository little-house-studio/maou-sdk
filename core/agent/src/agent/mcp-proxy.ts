/**
 * MCP 代理工具（P2-4）—— 子 Agent 复用父 Agent 的 MCP 连接。
 *
 * 设计：
 *   父 Agent 通过 ConnectionRegistry 建立 MCP 连接后，把 MCP server 暴露的工具
 *   提取为 McpToolDescriptor 列表，注入 SubagentExecutor.parentMcpTools。
 *   fork 时（inheritMcp !== false），把每个 descriptor 包装成一个 proxy Tool
 *   注册到子 Agent 的 ToolRegistry。proxy 工具 execute 时通过 McpToolInvoker
 *   把调用转发给父 Agent 的 MCP 连接——子 Agent 不建连、不持有 MCP client。
 *
 * 解耦：
 *   - McpToolDescriptor + McpToolInvoker 是最小契约（types 包定义）
 *   - 真实会话由 `./mcp`（McpSession / McpConnectionManager）基于官方 SDK 实现
 *   - AgentRuntime / Runtime 门面装配 invoker（manager.createInvoker）
 *   - mcp-proxy.ts 只负责把 descriptor → Tool 包装 + 转发调用（子 Agent 不建连）
 *
 * @see ./mcp/index.ts 标准 MCP host/client
 * @see DESIGN.md P2-4「MCP 代理工具」
 */

import { Tool } from "@little-house-studio/tools";
import type { ToolContext, ToolResponse, ToolDefinition } from "@little-house-studio/tools";
import type { JsonSchema } from "@little-house-studio/types";
import { createToolResponse } from "@little-house-studio/tools";
import type { McpToolDescriptor, McpToolInvoker } from "@little-house-studio/types";
import { isMcpToolExecutionError } from "./mcp/manager.js";

/** invoker 文本契约的兼容前缀（旧路径）；优先使用 McpToolExecutionError */
const IS_ERROR_PREFIX = "[isError]";

/**
 * 包装后的 proxy 工具描述符（带 invoker，可执行）。
 * createMcpProxyTools 的输入：父 Agent 的 MCP 工具 + 转发器。
 */
export interface McpProxyToolInput {
  /** 父 Agent 的 MCP 工具描述符 */
  descriptor: McpToolDescriptor;
  /** 转发器（调父 Agent MCP 连接）。undefined → proxy 返回错误 */
  invoker?: McpToolInvoker;
}

/**
 * 把父 Agent 的 MCP 工具列表包装成子 Agent 可用的 proxy Tool 实例。
 *
 * 每个 McpToolDescriptor → 一个 Tool 实例：
 *   - 工具名 = descriptor.name（建议 mcp__<conn>__<tool>）
 *   - 工具参数 schema = descriptor.parameters
 *   - execute 调 invoker(descriptor.connectionName, descriptor.originalName, params)
 *
 * @param inputs 父 Agent MCP 工具 + 转发器列表
 * @returns Tool 实例数组（注册到子 Agent 的 ToolRegistry）
 */
export function createMcpProxyTools(inputs: McpProxyToolInput[]): Tool[] {
  return inputs.map(({ descriptor, invoker }) => createMcpProxyTool(descriptor, invoker));
}

/**
 * 创建单个 MCP proxy 工具实例。
 *
 * @param descriptor MCP 工具描述符（来自父 Agent MCP 连接的 listTools）
 * @param invoker 转发器（调父 Agent MCP 连接）。undefined 时 proxy 返回错误
 */
export function createMcpProxyTool(
  descriptor: McpToolDescriptor,
  invoker?: McpToolInvoker,
): Tool {
  const toolName = descriptor.name;
  const desc =
    descriptor.description?.trim() ||
    `MCP 工具「${descriptor.originalName}」（来自连接 ${descriptor.connectionName}，代理自父 Agent）。`;

  class _McpProxyTool extends Tool {
    readonly definition: ToolDefinition = {
      name: toolName,
      aliases: [],
      description: desc,
      parameters: (descriptor.parameters ?? {
        type: "object",
        properties: {},
        additionalProperties: true,
      }) as JsonSchema,
      allowedModes: ["execute"],
      // MCP 工具大多是读操作（list/search/get），默认 parallelSafe；
      // 实际副作用由 MCP server 端决定，proxy 无法准确判断——保守起见
      // 标记为非并行（false），让 runtime 串行执行，避免并发副作用。
      parallelSafe: false,
    };

    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResponse> {
      if (!invoker) {
        return createToolResponse(
          false,
          `MCP 工具「${descriptor.originalName}」未连接（父 Agent 未注入 MCP 转发器）。` +
            `父 Agent 需在 SubagentExecutor 装配时传入 invoker（调 McpClient.callTool）。`,
        );
      }
      try {
        const result = await invoker(
          descriptor.connectionName,
          descriptor.originalName,
          params ?? {},
        );
        // 兼容：旧 invoker 用 "[isError] …" 字符串标记工具失败
        if (typeof result === "string" && result.startsWith(IS_ERROR_PREFIX)) {
          const msg = result.slice(IS_ERROR_PREFIX.length).trim() || result;
          return createToolResponse(false, msg, {
            payload: {
              mcp: true,
              mcpConnection: descriptor.connectionName,
              mcpTool: descriptor.originalName,
              isError: true,
            },
            displayEvents: [
              {
                type: "terminal",
                stream: "error",
                text: `[MCP Proxy] ${descriptor.connectionName}.${descriptor.originalName} isError`,
              },
            ],
          });
        }
        return createToolResponse(true, result || "(MCP 工具无输出)", {
          payload: {
            mcpConnection: descriptor.connectionName,
            mcpTool: descriptor.originalName,
          },
          displayEvents: [
            {
              type: "terminal",
              stream: "info",
              text: `[MCP Proxy] ${descriptor.connectionName}.${descriptor.originalName} 完成`,
            },
          ],
        });
      } catch (err) {
        // 工具执行失败（CallToolResult.isError）→ ok:false，不是协议错误
        if (isMcpToolExecutionError(err)) {
          return createToolResponse(false, err.message || "(MCP tool isError)", {
            payload: {
              mcp: true,
              mcpConnection: descriptor.connectionName,
              mcpTool: descriptor.originalName,
              isError: true,
            },
            displayEvents: [
              {
                type: "terminal",
                stream: "error",
                text: `[MCP Proxy] ${descriptor.connectionName}.${descriptor.originalName} isError`,
              },
            ],
          });
        }
        return createToolResponse(
          false,
          `MCP 工具「${descriptor.originalName}」（连接 ${descriptor.connectionName}）调用失败: ` +
            `${err instanceof Error ? err.message : String(err)}`,
          {
            payload: {
              mcp: true,
              mcpConnection: descriptor.connectionName,
              mcpTool: descriptor.originalName,
              protocolError: true,
            },
          },
        );
      }
    }
  }

  return new _McpProxyTool();
}
