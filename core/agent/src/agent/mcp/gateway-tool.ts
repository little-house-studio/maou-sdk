/**
 * MCP Gateway 元工具 —— 单一 `mcp` 门面（宿主自定义，非 MCP 协议字段）。
 *
 * 两个 action：
 *   - list：返回匹配范围内每个 tool 的完整信息（name/description/parameters），一次拿齐
 *   - call：执行
 *
 * 可选 server / query 过滤；name 可只查单工具。无 brief/full 分裂。
 * 旧 action search/schema 兼容映射到 list。
 */

import { Tool, createToolResponse } from "@little-house-studio/tools";
import type { ToolContext, ToolResponse, ToolDefinition } from "@little-house-studio/tools";
import type { McpToolDescriptor } from "@little-house-studio/types";
import {
  isNamespacedMcpToolName,
  parseNamespacedMcpToolName,
} from "./names.js";
import { MCP_GATEWAY_TOOL_NAME } from "./strategy.js";
import type { McpToolCallHandler } from "./tool-bridge.js";
import { describeMcpConfigLocations } from "./config-discover.js";
import { rejectIfMcpArgsInvalid } from "./validate-args.js";

export interface McpGatewayBackend {
  listDescriptors(): McpToolDescriptor[];
  listConnectionStates(): {
    name: string;
    status: string;
    toolCount: number;
    description?: string;
    lastError?: string | null;
  }[];
  /** 执行原始 MCP tools/call（connection + original tool name） */
  callHandler: McpToolCallHandler;
}

function matchScore(d: McpToolDescriptor, query: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 1;
  const name = d.name.toLowerCase();
  const orig = d.originalName.toLowerCase();
  const conn = d.connectionName.toLowerCase();
  const desc = (d.description ?? "").toLowerCase();
  let score = 0;
  if (name === q || orig === q) score += 100;
  if (name.includes(q) || orig.includes(q)) score += 50;
  if (conn.includes(q)) score += 20;
  for (const part of q.split(/[\s_/.-]+/).filter(Boolean)) {
    if (name.includes(part) || orig.includes(part)) score += 10;
    if (desc.includes(part)) score += 5;
    if (conn.includes(part)) score += 3;
  }
  return score;
}

function resolveDescriptor(
  name: string,
  pool: McpToolDescriptor[],
  all: McpToolDescriptor[],
): McpToolDescriptor | null {
  const direct =
    pool.find((x) => x.name === name) ?? all.find((x) => x.name === name);
  if (direct) return direct;
  if (!isNamespacedMcpToolName(name)) return null;
  const parsed = parseNamespacedMcpToolName(name);
  if (!parsed) return null;
  const byConn = all.filter((x) => x.connectionName === parsed.connectionName);
  return (
    byConn.find((x) => x.name.endsWith(`__${parsed.originalName}`)) ??
    byConn.find(
      (x) =>
        x.originalName.replace(/[^a-zA-Z0-9_-]+/g, "_") === parsed.originalName,
    ) ??
    null
  );
}

/** 单工具完整信息（list 默认输出单元） */
function toolEntry(d: McpToolDescriptor): Record<string, unknown> {
  return {
    name: d.name,
    connection: d.connectionName,
    originalName: d.originalName,
    description: d.description ?? "",
    parameters: d.parameters ?? { type: "object", properties: {} },
  };
}

/**
 * 创建唯一 LLM 可见的 MCP 门面工具。
 */
export function createMcpGatewayTool(backend: McpGatewayBackend): Tool {
  const configHelp = describeMcpConfigLocations({ agentName: "coding" });

  class McpGatewayTool extends Tool {
    readonly definition: ToolDefinition = {
      name: MCP_GATEWAY_TOOL_NAME,
      aliases: ["mcp_gateway", "mcp_call"],
      description:
        "MCP gateway (host facade for all connected MCP servers). " +
        "Actions: list | call. " +
        "list returns FULL tool info (description + parameters schema) for every matching tool in one shot. " +
        "Optional filters: server, query, name (single tool). " +
        "call executes mcp__<server>__<tool> with arguments. " +
        "MCP is NOT auto-installed; only config-listed servers load. Next user message reloads after config edits. " +
        "Config:\n" +
        configHelp,
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["list", "call", "search", "schema"],
            description:
              "list: return full catalog (all tools with complete schemas; filter with server/query/name). " +
              "call: execute a tool. " +
              "search/schema: legacy aliases of list.",
          },
          query: {
            type: "string",
            description: "Optional: filter list by keywords (server/tool/description)",
          },
          name: {
            type: "string",
            description:
              "For list: only this tool (mcp__server__tool). For call: tool to execute.",
          },
          arguments: {
            type: "object",
            description: "For call: JSON arguments for the MCP tool",
            additionalProperties: true,
          },
          server: {
            type: "string",
            description: "Optional: only tools from this MCP connection/server",
          },
        },
        required: ["action"],
        additionalProperties: false,
      },
      allowedModes: ["execute"],
      parallelSafe: false,
    };

    async execute(
      params: Record<string, unknown>,
      _ctx: ToolContext,
    ): Promise<ToolResponse> {
      let action = String(params.action ?? "").toLowerCase();
      if (action === "search" || action === "schema") action = "list";

      const serverFilter =
        typeof params.server === "string" && params.server.trim()
          ? params.server.trim()
          : undefined;
      const query =
        typeof params.query === "string" && params.query.trim()
          ? params.query.trim()
          : "";
      const nameParam =
        typeof params.name === "string" && params.name.trim()
          ? params.name.trim()
          : "";

      const allDescriptors = backend.listDescriptors();
      let descriptors = allDescriptors;
      if (serverFilter) {
        const sf = serverFilter.toLowerCase();
        descriptors = descriptors.filter(
          (d) =>
            d.connectionName.toLowerCase() === sf ||
            d.connectionName.toLowerCase().includes(sf),
        );
      }

      try {
        switch (action) {
          case "list": {
            // 单工具
            if (nameParam) {
              const d = resolveDescriptor(nameParam, descriptors, allDescriptors);
              if (!d) {
                return createToolResponse(
                  false,
                  `Unknown MCP tool "${nameParam}". Try action=list without name.`,
                  { payload: { mcp: true, gateway: true, action: "list" } },
                );
              }
              return createToolResponse(
                true,
                JSON.stringify(toolEntry(d), null, 2),
                {
                  payload: {
                    mcp: true,
                    gateway: true,
                    action: "list",
                    name: d.name,
                    count: 1,
                  },
                },
              );
            }

            // 可选关键词过滤（仍返回完整 schema，不截断条数）
            let rows: McpToolDescriptor[];
            if (query) {
              rows = descriptors
                .map((d) => ({ d, score: matchScore(d, query) }))
                .filter((x) => x.score > 0)
                .sort((a, b) => b.score - a.score)
                .map((x) => x.d);
            } else {
              rows = descriptors;
            }

            const states = backend.listConnectionStates().filter((s) => {
              if (!serverFilter) return true;
              const sf = serverFilter.toLowerCase();
              return (
                s.name.toLowerCase() === sf || s.name.toLowerCase().includes(sf)
              );
            });

            const catalog = {
              servers: states.map((s) => ({
                name: s.name,
                status: s.status,
                toolCount: s.toolCount,
                description: s.description,
                lastError: s.lastError ?? undefined,
              })),
              tools: rows.map(toolEntry),
              count: rows.length,
              filter: {
                server: serverFilter,
                query: query || undefined,
              },
            };

            const header =
              `# MCP catalog: ${rows.length} tool(s), ${states.length} server(s)` +
              (serverFilter ? `, server~${serverFilter}` : "") +
              (query ? `, query="${query}"` : "") +
              "\n# Each tool includes full description + parameters (JSON Schema).\n" +
              "# Execute: mcp({ action: \"call\", name: \"mcp__server__tool\", arguments: {...} })\n";

            if (rows.length === 0) {
              return createToolResponse(
                true,
                header +
                  (query || serverFilter
                    ? "\n(no matches)\n"
                    : "\n(no MCP tools connected)\n"),
                {
                  payload: {
                    mcp: true,
                    gateway: true,
                    action: "list",
                    count: 0,
                    catalog,
                  },
                },
              );
            }

            return createToolResponse(
              true,
              header + "\n" + JSON.stringify(catalog, null, 2),
              {
                payload: {
                  mcp: true,
                  gateway: true,
                  action: "list",
                  count: rows.length,
                  query: query || undefined,
                  server: serverFilter,
                },
              },
            );
          }

          case "call": {
            const name = nameParam;
            if (!name) {
              return createToolResponse(false, "call requires name (mcp__server__tool)", {
                payload: { mcp: true, gateway: true, action: "call" },
              });
            }
            if (!isNamespacedMcpToolName(name)) {
              return createToolResponse(
                false,
                `name must be namespaced mcp__<server>__<tool>, got "${name}"`,
                { payload: { mcp: true, gateway: true, action: "call" } },
              );
            }
            const d = resolveDescriptor(name, descriptors, allDescriptors);
            if (!d) {
              return createToolResponse(
                false,
                `Unknown MCP tool "${name}". Use action=list first.`,
                { payload: { mcp: true, gateway: true, action: "call" } },
              );
            }
            const connectionName = d.connectionName;
            const originalName = d.originalName;

            const args =
              params.arguments &&
              typeof params.arguments === "object" &&
              !Array.isArray(params.arguments)
                ? (params.arguments as Record<string, unknown>)
                : {};

            if (d.parameters) {
              const rejected = rejectIfMcpArgsInvalid({
                toolLabel: name,
                connectionName,
                originalName,
                schema: d.parameters,
                args,
                viaGateway: true,
              });
              if (rejected) return rejected;
            }

            const out = await backend.callHandler(connectionName, originalName, args);
            if (typeof out === "string") {
              return createToolResponse(true, out || "(empty)", {
                payload: {
                  mcp: true,
                  gateway: true,
                  action: "call",
                  name,
                  connection: connectionName,
                  tool: originalName,
                },
              });
            }
            return {
              ...out,
              payload: {
                ...(out.payload ?? {}),
                mcp: true,
                gateway: true,
                action: "call",
                name,
              },
            };
          }

          default:
            return createToolResponse(
              false,
              `Unknown action "${action}". Use list | call.`,
              { payload: { mcp: true, gateway: true } },
            );
        }
      } catch (err) {
        return createToolResponse(
          false,
          err instanceof Error ? err.message : String(err),
          {
            payload: {
              mcp: true,
              gateway: true,
              action,
              error: true,
            },
          },
        );
      }
    }
  }

  return new McpGatewayTool();
}
