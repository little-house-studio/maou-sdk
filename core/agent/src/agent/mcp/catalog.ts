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

/** full=列出每条 tool；servers_only=仅服务名；auto=工具数≤阈值 full 否则 servers_only */
export type McpCatalogDetail = "full" | "servers_only" | "auto";

/** 默认：指令总数 ≤ 此值时注入完整 tool 列表，否则仅注入 MCP 服务索引 */
export const MCP_CATALOG_FULL_INJECT_THRESHOLD = 25;

/**
 * 渲染为 system prompt 片段（与 skill bake 类似的可缓存说明区）。
 *
 * 内容严格来自 MCP 协商结果：server 实现名/版本、tools/list 描述、
 * 可选 resources/prompts 名。调用约定指向标准 tool-calling（mcp__ 前缀仅为 host 命名空间）。
 *
 * `detail` / `fullInjectThreshold`：控制是否把每条指令写进提示词。
 * 超过阈值时只列服务，让模型用 MCP 元工具（list/search）再查指令。
 */
export function formatMcpCatalogPrompt(
  snapshot: McpCatalogSnapshot,
  opts?: {
    detail?: McpCatalogDetail;
    fullInjectThreshold?: number;
  },
): string {
  if (snapshot.servers.length === 0) return "";

  const threshold = opts?.fullInjectThreshold ?? MCP_CATALOG_FULL_INJECT_THRESHOLD;
  let detail: "full" | "servers_only" = "full";
  const mode = opts?.detail ?? "auto";
  if (mode === "servers_only") {
    detail = "servers_only";
  } else if (mode === "auto") {
    detail = snapshot.toolCount <= threshold ? "full" : "servers_only";
  }

  const lines: string[] = [];
  lines.push("<mcp_servers>");
  lines.push(
    "MCP (Model Context Protocol) servers are connected from config files only (not auto-installed).",
  );
  lines.push(
    "Config (write to enable; enabled:false or delete to disable; next user message reloads): " +
      "~/.maou/mcp.json · ~/.maou/agents/<agent>/mcp.json · <project>/.mcp.json · <project>/.maou/mcp.json · " +
      "<project>/.maou/agents/<agent>/mcp.json · connections/*.json under those agent dirs. " +
      "Also: ~/.cursor/mcp.json, Claude Desktop, ~/.claude.json mcpServers.",
  );
  if (detail === "full") {
    lines.push(
      "Tool names use the host namespace: mcp__<server>__<tool> (also present in your tool schema).",
    );
    lines.push(
      "Invoke them like any other tool using the exact names below.",
    );
  } else {
    lines.push(
      `There are ${snapshot.toolCount} MCP tools across servers (above the full-catalog threshold of ${threshold}).`,
    );
    lines.push(
      "Only server names are listed here. To discover tools/schemas, use the MCP meta-tool (`mcp` with action=list or call).",
    );
    lines.push(
      "Do not invent tool names; look them up before calling.",
    );
  }
  lines.push("");

  for (const s of snapshot.servers) {
    const impl =
      s.serverName != null
        ? ` implementation="${escapeXml(s.serverName)}${s.serverVersion ? `@${escapeXml(s.serverVersion)}` : ""}"`
        : "";
    lines.push(
      `<mcp_server name="${escapeXml(s.name)}" status="${escapeXml(s.status)}" tools="${s.tools.length}"${impl}>`,
    );
    if (s.description) {
      lines.push(`  <description>${escapeXml(s.description)}</description>`);
    }
    if (s.lastError) {
      lines.push(`  <error>${escapeXml(s.lastError)}</error>`);
    }
    if (detail === "full") {
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
    } else {
      lines.push(
        `  <tools count="${s.tools.length}" listed="false" hint="use mcp list/search for this server" />`,
      );
    }
    lines.push("</mcp_server>");
    lines.push("");
  }

  lines.push(
    `Total MCP tools: ${snapshot.toolCount}. Catalog detail: ${detail}.`,
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
    detail?: McpCatalogDetail;
    fullInjectThreshold?: number;
  },
): Promise<string> {
  let snap = snapshotMcpCatalog(manager);
  const detail = opts?.detail ?? "auto";
  const threshold = opts?.fullInjectThreshold ?? MCP_CATALOG_FULL_INJECT_THRESHOLD;
  const willListTools =
    detail === "full" ||
    (detail === "auto" && snap.toolCount <= threshold);
  // servers_only 时不必 enrich resources/prompts（省往返）
  if (opts?.enrichLists !== false && willListTools) {
    snap = await enrichMcpCatalogWithProtocolLists(manager, snap, opts);
  }
  return formatMcpCatalogPrompt(snap, {
    detail,
    fullInjectThreshold: threshold,
  });
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
