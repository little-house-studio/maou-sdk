/**
 * MCP Gateway 元工具 —— 单工具搞定 list / search / schema / call。
 *
 * 行业 progressive discovery 简化版：不把上百个 mcp__* 塞进 tools[]，
 * 只暴露 `mcp`，由模型按需查名单再执行。
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

/**
 * 创建唯一 LLM 可见的 MCP 门面工具。
 */
export function createMcpGatewayTool(backend: McpGatewayBackend): Tool {
  class McpGatewayTool extends Tool {
    readonly definition: ToolDefinition = {
      name: MCP_GATEWAY_TOOL_NAME,
      aliases: ["mcp_gateway", "mcp_call"],
      description:
        "MCP (Model Context Protocol) gateway. Use this single tool for all MCP servers. " +
        "Workflow: action=list or search → (optional) action=schema → action=call. " +
        "Tool names look like mcp__<server>__<tool>. Do NOT invent raw server tool names without listing first.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["list", "search", "schema", "call"],
            description:
              "list: catalog all tools; search: filter by query; schema: full JSON schema for one tool; call: execute a tool",
          },
          query: {
            type: "string",
            description: "For search: keywords (server name, tool name, or natural language)",
          },
          name: {
            type: "string",
            description:
              "For schema/call: namespaced tool name, e.g. mcp__echo__echo (from list/search)",
          },
          arguments: {
            type: "object",
            description: "For call: JSON arguments object passed to the MCP tool",
            additionalProperties: true,
          },
          server: {
            type: "string",
            description: "Optional: filter list/search to one connection/server name",
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
      const action = String(params.action ?? "").toLowerCase();
      const serverFilter =
        typeof params.server === "string" && params.server.trim()
          ? params.server.trim()
          : undefined;

      let descriptors = backend.listDescriptors();
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
            const states = backend.listConnectionStates();
            const lines: string[] = [
              `# MCP catalog (${descriptors.length} tools, ${states.length} servers)`,
              "",
            ];
            for (const s of states) {
              lines.push(
                `## server: ${s.name} [${s.status}] tools=${s.toolCount}` +
                  (s.description ? ` — ${s.description}` : "") +
                  (s.lastError ? ` error=${s.lastError}` : ""),
              );
            }
            lines.push("", "## tools");
            for (const d of descriptors) {
              const desc = (d.description ?? "").replace(/\s+/g, " ").slice(0, 120);
              lines.push(`- ${d.name}${desc ? ` — ${desc}` : ""}`);
            }
            if (descriptors.length === 0) {
              lines.push("(no MCP tools connected)");
            }
            return createToolResponse(true, lines.join("\n"), {
              payload: {
                mcp: true,
                gateway: true,
                action: "list",
                count: descriptors.length,
              },
            });
          }

          case "search": {
            const query = String(params.query ?? "").trim();
            if (!query) {
              return createToolResponse(false, "search requires non-empty query", {
                payload: { mcp: true, gateway: true, action: "search" },
              });
            }
            const ranked = descriptors
              .map((d) => ({ d, score: matchScore(d, query) }))
              .filter((x) => x.score > 0)
              .sort((a, b) => b.score - a.score)
              .slice(0, 30);
            const lines = [
              `# MCP search "${query}" → ${ranked.length} match(es)`,
              "",
            ];
            for (const { d, score } of ranked) {
              const desc = (d.description ?? "").replace(/\s+/g, " ").slice(0, 160);
              lines.push(`- ${d.name} (score=${score})${desc ? ` — ${desc}` : ""}`);
            }
            if (ranked.length === 0) {
              lines.push("No matches. Try action=list.");
            }
            return createToolResponse(true, lines.join("\n"), {
              payload: {
                mcp: true,
                gateway: true,
                action: "search",
                count: ranked.length,
              },
            });
          }

          case "schema": {
            const name = String(params.name ?? "").trim();
            if (!name) {
              return createToolResponse(false, "schema requires name (mcp__server__tool)", {
                payload: { mcp: true, gateway: true, action: "schema" },
              });
            }
            const d =
              descriptors.find((x) => x.name === name) ??
              backend.listDescriptors().find((x) => x.name === name);
            if (!d) {
              return createToolResponse(
                false,
                `Unknown MCP tool "${name}". Use action=list or search first.`,
                { payload: { mcp: true, gateway: true, action: "schema" } },
              );
            }
            const body = {
              name: d.name,
              connection: d.connectionName,
              originalName: d.originalName,
              description: d.description,
              parameters: d.parameters ?? { type: "object", properties: {} },
            };
            return createToolResponse(
              true,
              JSON.stringify(body, null, 2),
              {
                payload: {
                  mcp: true,
                  gateway: true,
                  action: "schema",
                  name: d.name,
                },
              },
            );
          }

          case "call": {
            const name = String(params.name ?? "").trim();
            if (!name) {
              return createToolResponse(false, "call requires name (mcp__server__tool)", {
                payload: { mcp: true, gateway: true, action: "call" },
              });
            }
            let connectionName: string;
            let originalName: string;
            if (isNamespacedMcpToolName(name)) {
              const parsed = parseNamespacedMcpToolName(name);
              if (!parsed) {
                return createToolResponse(false, `Invalid MCP name "${name}"`, {
                  payload: { mcp: true, gateway: true, action: "call" },
                });
              }
              // Prefer descriptor match (sanitized segments may differ slightly)
              const d =
                descriptors.find((x) => x.name === name) ??
                backend.listDescriptors().find((x) => x.name === name);
              if (d) {
                connectionName = d.connectionName;
                originalName = d.originalName;
              } else {
                // Fall back to parse; originalName is sanitized — try find by connection+sanitized
                const byConn = backend
                  .listDescriptors()
                  .filter((x) => x.connectionName === parsed.connectionName);
                const hit =
                  byConn.find((x) => x.name.endsWith(`__${parsed.originalName}`)) ??
                  byConn.find(
                    (x) =>
                      x.originalName.replace(/[^a-zA-Z0-9_-]+/g, "_") ===
                      parsed.originalName,
                  );
                if (!hit) {
                  return createToolResponse(
                    false,
                    `Unknown MCP tool "${name}". Use action=list or search.`,
                    { payload: { mcp: true, gateway: true, action: "call" } },
                  );
                }
                connectionName = hit.connectionName;
                originalName = hit.originalName;
              }
            } else {
              return createToolResponse(
                false,
                `name must be namespaced mcp__<server>__<tool>, got "${name}"`,
                { payload: { mcp: true, gateway: true, action: "call" } },
              );
            }

            const args =
              params.arguments &&
              typeof params.arguments === "object" &&
              !Array.isArray(params.arguments)
                ? (params.arguments as Record<string, unknown>)
                : {};

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
              `Unknown action "${action}". Use list | search | schema | call.`,
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
