/**
 * MCP → Agent Tool 桥接。
 *
 * 将 McpToolDescriptor 包装为可注册到 ToolRegistry 的 Tool 实例；
 * execute 时经 McpToolInvoker 或 session 转发 tools/call，
 * 结果映射为 agent ToolResponse（保留 isError 语义）。
 */

import { Tool, createToolResponse } from "@little-house-studio/tools";
import type { ToolContext, ToolResponse, ToolDefinition } from "@little-house-studio/tools";
import type { JsonSchema, McpToolDescriptor, McpToolInvoker } from "@little-house-studio/types";
import type { ToolRegistry } from "@little-house-studio/tools";
import { mapProtocolErrorToToolResponse } from "./mappers.js";

/**
 * 可返回文本或完整 ToolResponse 的调用器。
 * 文本路径兼容既有 McpToolInvoker；ToolResponse 路径保留 isError / images。
 */
export type McpToolCallHandler = (
  connectionName: string,
  toolName: string,
  args: Record<string, unknown>,
) => Promise<string | ToolResponse>;

/**
 * 从 descriptor + handler 创建 Tool。
 */
export function createMcpBridgeTool(
  descriptor: McpToolDescriptor,
  handler: McpToolCallHandler,
): Tool {
  const toolName = descriptor.name;
  const desc =
    descriptor.description?.trim() ||
    `MCP tool「${descriptor.originalName}」(connection: ${descriptor.connectionName})`;

  class _McpBridgeTool extends Tool {
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
      // MCP 副作用不可知：默认串行，避免并发破坏 server 状态
      parallelSafe: false,
    };

    async execute(params: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResponse> {
      try {
        const out = await handler(
          descriptor.connectionName,
          descriptor.originalName,
          params ?? {},
        );
        if (typeof out === "string") {
          return createToolResponse(true, out || "(MCP tool returned empty content)", {
            payload: {
              mcp: true,
              mcpConnection: descriptor.connectionName,
              mcpTool: descriptor.originalName,
            },
            displayEvents: [
              {
                type: "terminal",
                stream: "info",
                text: `[MCP] ${descriptor.connectionName}.${descriptor.originalName} ok`,
              },
            ],
          });
        }
        return out;
      } catch (err) {
        return mapProtocolErrorToToolResponse(err, {
          connectionName: descriptor.connectionName,
          toolName: descriptor.originalName,
        });
      }
    }
  }

  return new _McpBridgeTool();
}

/**
 * 将 McpToolInvoker（仅返回 string）提升为 handler。
 * 注意：string invoker 无法表达 isError；优先使用 session.callToolAsResponse。
 */
export function invokerAsHandler(invoker: McpToolInvoker): McpToolCallHandler {
  return async (connectionName, toolName, args) => invoker(connectionName, toolName, args);
}

/**
 * 批量注册 MCP tools 到 ToolRegistry。
 * @returns 注册的工具名列表
 */
export function registerMcpTools(
  registry: ToolRegistry,
  descriptors: McpToolDescriptor[],
  handler: McpToolCallHandler,
): string[] {
  const names: string[] = [];
  for (const d of descriptors) {
    const tool = createMcpBridgeTool(d, handler);
    registry.register(tool);
    names.push(d.name);
  }
  return names;
}

/**
 * 按名称列表从 ToolRegistry 卸载 MCP tools。
 */
export function unregisterMcpTools(registry: ToolRegistry, names: Iterable<string>): void {
  for (const name of names) {
    registry.unregister(name);
  }
}
