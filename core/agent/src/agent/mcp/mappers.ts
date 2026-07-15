/**
 * MCP ↔ Agent 纯映射（schema / result / error）。
 *
 * 无 I/O：可单测。区分：
 * - 协议/传输错误 → 抛出（JSON-RPC 失败、断开等）
 * - 工具执行错误 → CallToolResult.isError === true（不抛，映射为 ok:false）
 *
 * @see MCP spec 2025-11-25 tools/call result
 */

import type { JsonSchema, McpToolDescriptor } from "@little-house-studio/types";
import type { ToolResponse } from "@little-house-studio/tools";
import { createToolResponse } from "@little-house-studio/tools";
import { namespacedMcpToolName } from "./names.js";

/** MCP listTools 返回的单条工具（宽松形状，兼容 SDK 版本差异） */
export interface McpListedTool {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

/** MCP tools/call 结果内容块 */
export type McpContentBlock =
  | { type: "text"; text: string; [key: string]: unknown }
  | { type: "image"; data: string; mimeType: string; [key: string]: unknown }
  | { type: "audio"; data: string; mimeType: string; [key: string]: unknown }
  | { type: "resource"; resource: Record<string, unknown>; [key: string]: unknown }
  | { type: "resource_link"; uri: string; name?: string; [key: string]: unknown }
  | { type: string; [key: string]: unknown };

/** MCP tools/call 结果（标准 CallToolResult 子集） */
export interface McpCallToolResult {
  content?: McpContentBlock[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
  /** 兼容旧 CompatibilityCallToolResult */
  toolResult?: unknown;
  [key: string]: unknown;
}

/**
 * 将 MCP tool inputSchema 规范为 agent JsonSchema（保证 type:object）。
 */
export function mapMcpInputSchemaToJsonSchema(
  inputSchema: McpListedTool["inputSchema"] | undefined,
): JsonSchema {
  if (!inputSchema || typeof inputSchema !== "object") {
    return {
      type: "object",
      properties: {},
      additionalProperties: true,
    } as JsonSchema;
  }
  const schema = { ...inputSchema } as Record<string, unknown>;
  if (schema.type !== "object") {
    schema.type = "object";
  }
  if (schema.properties == null) {
    schema.properties = {};
  }
  return schema as JsonSchema;
}

/**
 * listTools 条目 → McpToolDescriptor（namespaced）。
 */
export function mapListedToolToDescriptor(
  connectionName: string,
  tool: McpListedTool,
): McpToolDescriptor {
  const originalName = tool.name;
  return {
    name: namespacedMcpToolName(connectionName, originalName),
    description: (tool.description ?? tool.annotations?.title ?? "").trim() ||
      `MCP tool ${originalName} (connection: ${connectionName})`,
    parameters: mapMcpInputSchemaToJsonSchema(tool.inputSchema),
    connectionName,
    originalName,
  };
}

/**
 * 将 CallToolResult.content 展平为可读文本（供 invoker / 日志）。
 */
export function flattenMcpContentToText(result: McpCallToolResult): string {
  if (result.toolResult !== undefined && (result.content == null || result.content.length === 0)) {
    try {
      return typeof result.toolResult === "string"
        ? result.toolResult
        : JSON.stringify(result.toolResult, null, 2);
    } catch {
      return String(result.toolResult);
    }
  }

  const blocks = result.content ?? [];
  if (blocks.length === 0) {
    if (result.structuredContent && Object.keys(result.structuredContent).length > 0) {
      try {
        return JSON.stringify(result.structuredContent, null, 2);
      } catch {
        return String(result.structuredContent);
      }
    }
    return "";
  }

  const parts: string[] = [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    switch (block.type) {
      case "text":
        parts.push(typeof (block as { text?: string }).text === "string"
          ? (block as { text: string }).text
          : "");
        break;
      case "image": {
        const b = block as { mimeType?: string; data?: string };
        parts.push(`[image ${b.mimeType ?? "unknown"} ${b.data ? `${b.data.length}b base64` : "no-data"}]`);
        break;
      }
      case "audio": {
        const b = block as { mimeType?: string; data?: string };
        parts.push(`[audio ${b.mimeType ?? "unknown"} ${b.data ? `${b.data.length}b base64` : "no-data"}]`);
        break;
      }
      case "resource": {
        try {
          parts.push(`[resource ${JSON.stringify((block as { resource?: unknown }).resource)}]`);
        } catch {
          parts.push("[resource]");
        }
        break;
      }
      case "resource_link": {
        const b = block as { uri?: string; name?: string };
        parts.push(`[resource_link ${b.name ?? ""} ${b.uri ?? ""}]`.trim());
        break;
      }
      default:
        try {
          parts.push(JSON.stringify(block));
        } catch {
          parts.push(`[${block.type}]`);
        }
    }
  }
  return parts.filter(Boolean).join("\n");
}

/**
 * 从 content 提取 image 块 → ToolResponse.images
 */
export function extractMcpImages(
  result: McpCallToolResult,
): { mimeType: string; data: string }[] {
  const images: { mimeType: string; data: string }[] = [];
  for (const block of result.content ?? []) {
    if (block?.type === "image" && typeof (block as { data?: string }).data === "string") {
      images.push({
        mimeType: String((block as { mimeType?: string }).mimeType ?? "image/png"),
        data: (block as { data: string }).data,
      });
    }
  }
  return images;
}

/**
 * CallToolResult → agent ToolResponse。
 *
 * - isError === true → ok:false（工具执行失败，非协议错误）
 * - 否则 ok:true，message 为展平文本
 */
export function mapCallToolResultToToolResponse(
  result: McpCallToolResult,
  meta?: {
    connectionName?: string;
    toolName?: string;
  },
): ToolResponse {
  const text = flattenMcpContentToText(result);
  const isError = result.isError === true;
  const images = extractMcpImages(result);

  return createToolResponse(
    !isError,
    text || (isError ? "(MCP tool error with empty content)" : "(MCP tool returned empty content)"),
    {
      images,
      payload: {
        mcp: true,
        mcpConnection: meta?.connectionName,
        mcpTool: meta?.toolName,
        isError,
        structuredContent: result.structuredContent,
        _meta: result._meta,
      },
      displayEvents: [
        {
          type: "terminal",
          stream: isError ? "error" : "info",
          text: meta?.toolName
            ? `[MCP] ${meta.connectionName ?? "?"}.${meta.toolName}${isError ? " failed" : " ok"}`
            : `[MCP] tools/call ${isError ? "isError" : "ok"}`,
        },
      ],
    },
  );
}

/**
 * 协议层错误 → 失败 ToolResponse（不断言 isError；用于 catch 路径）。
 */
export function mapProtocolErrorToToolResponse(
  err: unknown,
  meta?: { connectionName?: string; toolName?: string },
): ToolResponse {
  const message =
    err instanceof Error ? err.message : typeof err === "string" ? err : String(err);
  return createToolResponse(
    false,
    `MCP protocol/transport error` +
      (meta?.connectionName ? ` [${meta.connectionName}]` : "") +
      (meta?.toolName ? `.${meta.toolName}` : "") +
      `: ${message}`,
    {
      payload: {
        mcp: true,
        mcpConnection: meta?.connectionName,
        mcpTool: meta?.toolName,
        protocolError: true,
      },
    },
  );
}
