/**
 * MCP catalog → system prompt 片段。
 *
 * 行业实践：
 * - **主通道**：tools/list → LLM tool/function schema（协议强制，见 tool-bridge）
 * - **辅通道**：在 system 中给出 server/tool 索引，帮助模型建立心智地图（类 skill bake）
 *
 * 本模块只消费协议已暴露的数据（tools/list 的 name/description，
 * 可选 resources/list、prompts/list），不发明非标准 tool 语义。
 */

import type { McpToolDescriptor } from "@little-house-studio/types";
import type { McpConnectionManager } from "./manager.js";
import type { McpConnectionState } from "./manager.js";

export interface McpCatalogServerBlock {
  name: string;
  status: string;
  description?: string;
  serverName?: string;
  serverVersion?: string;
  tools: { name: string; originalName: string; description: string }[];
  resourceUris?: string[];
  promptNames?: string[];
  lastError?: string | null;
}

export interface McpCatalogSnapshot {
  servers: McpCatalogServerBlock[];
  toolCount: number;
}

/**
 * 从已连接的 manager 生成 catalog 快照（同步部分：tools 描述符）。
 */
export function snapshotMcpCatalog(manager: McpConnectionManager): McpCatalogSnapshot {
  const states = manager.listConnectionStates();
  const descriptors = manager.listDescriptors();
  const byConn = new Map<string, McpToolDescriptor[]>();
  for (const d of descriptors) {
    const list = byConn.get(d.connectionName) ?? [];
    list.push(d);
    byConn.set(d.connectionName, list);
  }

  const servers: McpCatalogServerBlock[] = [];
  const stateByName = new Map<string, McpConnectionState>(
    states.map((s) => [s.name, s]),
  );

  // 已连接 / 已知 session
  const names = new Set<string>([
    ...states.map((s) => s.name),
    ...byConn.keys(),
  ]);

  for (const name of [...names].sort()) {
    const st = stateByName.get(name);
    const tools = (byConn.get(name) ?? []).map((d) => ({
      name: d.name,
      originalName: d.originalName,
      description: (d.description ?? "").trim(),
    }));
    servers.push({
      name,
      status: st?.status ?? "unknown",
      description: st?.description,
      serverName: st?.serverName,
      serverVersion: st?.serverVersion,
      tools,
      lastError: st?.lastError,
    });
  }

  return {
    servers,
    toolCount: descriptors.length,
  };
}

/**
 * 异步补充 resources / prompts 名称（协议 list；失败则跳过，不阻断）。
 */
export async function enrichMcpCatalogWithProtocolLists(
  manager: McpConnectionManager,
  snapshot: McpCatalogSnapshot,
  opts?: { maxResourcesPerServer?: number; maxPromptsPerServer?: number },
): Promise<McpCatalogSnapshot> {
  const maxR = opts?.maxResourcesPerServer ?? 12;
  const maxP = opts?.maxPromptsPerServer ?? 12;

  for (const block of snapshot.servers) {
    const session = manager.getSession(block.name);
    if (!session?.connected) continue;
    try {
      const resources = await session.listResources();
      block.resourceUris = resources.slice(0, maxR).map((r) => r.uri);
      if (resources.length > maxR) {
        block.resourceUris.push(`…+${resources.length - maxR} more`);
      }
    } catch {
      /* server 可能未实现 resources */
    }
    try {
      const prompts = await session.listPrompts();
      block.promptNames = prompts.slice(0, maxP).map((p) => p.name);
      if (prompts.length > maxP) {
        block.promptNames.push(`…+${prompts.length - maxP} more`);
      }
    } catch {
      /* server 可能未实现 prompts */
    }
  }
  return snapshot;
}

/**
 * 渲染为 system prompt 片段（与 skill bake 类似的可缓存说明区）。
 *
 * 内容严格来自 MCP 协商结果：server 实现名/版本、tools/list 描述、
 * 可选 resources/prompts 名。调用约定指向标准 tool-calling（mcp__ 前缀仅为 host 命名空间）。
 */
export function formatMcpCatalogPrompt(snapshot: McpCatalogSnapshot): string {
  if (snapshot.servers.length === 0) return "";

  const lines: string[] = [];
  lines.push("<mcp_servers>");
  lines.push(
    "MCP (Model Context Protocol) servers are connected. Their tools are registered in your normal tool-calling interface.",
  );
  lines.push(
    "Tool names use the host namespace: mcp__<server>__<tool> (server and tool segments are sanitized).",
  );
  lines.push(
    "Invoke them like any other tool using the exact names below (also present in your tool schema).",
  );
  lines.push(
    "Protocol notes: tool execution failures may return isError; resources/prompts are read-only context when listed.",
  );
  lines.push("");

  for (const s of snapshot.servers) {
    const impl =
      s.serverName != null
        ? ` implementation="${escapeXml(s.serverName)}${s.serverVersion ? `@${escapeXml(s.serverVersion)}` : ""}"`
        : "";
    lines.push(
      `<mcp_server name="${escapeXml(s.name)}" status="${escapeXml(s.status)}"${impl}>`,
    );
    if (s.description) {
      lines.push(`  <description>${escapeXml(s.description)}</description>`);
    }
    if (s.lastError) {
      lines.push(`  <error>${escapeXml(s.lastError)}</error>`);
    }
    if (s.tools.length === 0) {
      lines.push("  <tools none=\"true\" />");
    } else {
      lines.push("  <tools>");
      for (const t of s.tools) {
        const desc = t.description
          ? escapeXml(truncate(t.description, 200))
          : escapeXml(t.originalName);
        lines.push(
          `    <tool name="${escapeXml(t.name)}" original="${escapeXml(t.originalName)}">${desc}</tool>`,
        );
      }
      lines.push("  </tools>");
    }
    if (s.resourceUris && s.resourceUris.length > 0) {
      lines.push("  <resources>");
      for (const uri of s.resourceUris) {
        lines.push(`    <resource uri="${escapeXml(uri)}" />`);
      }
      lines.push("  </resources>");
    }
    if (s.promptNames && s.promptNames.length > 0) {
      lines.push("  <prompts>");
      for (const n of s.promptNames) {
        lines.push(`    <prompt name="${escapeXml(n)}" />`);
      }
      lines.push("  </prompts>");
    }
    lines.push("</mcp_server>");
    lines.push("");
  }

  lines.push(
    `Total MCP tools available via tool-calling: ${snapshot.toolCount}.`,
  );
  lines.push("</mcp_servers>");
  return lines.join("\n");
}

/**
 * 一步：snapshot + 可选 enrich + format。
 */
export async function buildMcpCatalogPrompt(
  manager: McpConnectionManager,
  opts?: {
    enrichLists?: boolean;
    maxResourcesPerServer?: number;
    maxPromptsPerServer?: number;
  },
): Promise<string> {
  let snap = snapshotMcpCatalog(manager);
  if (opts?.enrichLists !== false) {
    snap = await enrichMcpCatalogWithProtocolLists(manager, snap, opts);
  }
  return formatMcpCatalogPrompt(snap);
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
