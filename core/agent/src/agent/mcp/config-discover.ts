/**
 * 行业标准 MCP 配置发现（mcpServers JSON）。
 *
 * 与 Claude Desktop / Cursor / Claude Code / VS Code 通用的配置形状对齐，
 * **不自创协议字段**：只解析社区已广泛使用的 mcpServers 条目。
 *
 * 参考：
 * - Claude Desktop: ~/Library/Application Support/Claude/claude_desktop_config.json
 * - Cursor: ~/.cursor/mcp.json, <project>/.cursor/mcp.json
 * - Claude Code: ~/.claude.json (mcpServers), <project>/.mcp.json
 * - 通用: { "mcpServers": { "<name>": { command, args, env, url, type, ... } } }
 *
 * Maou 额外约定（同形状，便于产品默认路径）：
 * - ~/.maou/mcp.json
 * - ~/.maou/agents/<agent>/mcp.json
 * - <project>/.maou/mcp.json
 * - 既有 agents/<agent>/connections/*.json（由 ConnectionRegistry 处理，此处不重复）
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { DefinedConnection, McpConnectionTransport } from "../define-connection.js";
import { expandConnectionEnv } from "../define-connection.js";

/** 标准 mcpServers 单条配置（宽松解析，兼容各客户端） */
export interface StandardMcpServerEntry {
  /** stdio */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  /** 远程 */
  url?: string;
  /** 传输：stdio | sse | http | streamable-http | auto（缺省按 command/url 推断） */
  type?: string;
  transport?: string;
  /** Claude Code / 部分客户端用 disabled */
  disabled?: boolean;
  enabled?: boolean;
  description?: string;
  /** 透传 */
  [key: string]: unknown;
}

export interface StandardMcpConfigFile {
  mcpServers?: Record<string, StandardMcpServerEntry>;
  /** 少数文件整文件就是 mcpServers map */
  [key: string]: unknown;
}

export interface DiscoverMcpConfigOptions {
  maouRoot: string;
  projectRoot?: string;
  agentName?: string;
  /**
   * 额外配置文件路径（测试用）。
   * 仍须为标准 mcpServers JSON。
   */
  extraConfigPaths?: string[];
  /** 是否扫描 Claude Desktop / Cursor / Claude 全局（默认 true） */
  includeIndustryPaths?: boolean;
}

export interface DiscoveredMcpConfigSource {
  path: string;
  serverNames: string[];
}

/**
 * 行业 + Maou 标准配置文件搜索路径（后写覆盖先写的同名 server）。
 */
export function listStandardMcpConfigPaths(opts: DiscoverMcpConfigOptions): string[] {
  const home = homedir();
  const paths: string[] = [];
  const industry = opts.includeIndustryPaths !== false;

  if (industry) {
    // Claude Desktop (macOS)
    paths.push(
      join(home, "Library/Application Support/Claude/claude_desktop_config.json"),
    );
    // Claude Desktop (Linux 常见)
    paths.push(join(home, ".config/Claude/claude_desktop_config.json"));
    // Cursor 用户级
    paths.push(join(home, ".cursor/mcp.json"));
    // Claude Code 用户级（整文件可能很大，仅取 mcpServers）
    paths.push(join(home, ".claude.json"));
  }

  // Maou 用户级
  paths.push(join(opts.maouRoot, "mcp.json"));
  if (opts.agentName) {
    paths.push(join(opts.maouRoot, "agents", opts.agentName, "mcp.json"));
  }

  if (opts.projectRoot) {
    if (industry) {
      paths.push(join(opts.projectRoot, ".mcp.json"));
      paths.push(join(opts.projectRoot, ".cursor/mcp.json"));
    }
    paths.push(join(opts.projectRoot, ".maou/mcp.json"));
    if (opts.agentName) {
      paths.push(join(opts.projectRoot, ".maou/agents", opts.agentName, "mcp.json"));
    }
  }

  if (opts.extraConfigPaths) {
    paths.push(...opts.extraConfigPaths);
  }

  // 去重保序
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

/**
 * 给工具 description / catalog 用的配置路径说明（仅文档，不启动任何进程）。
 * 不自动启用 MCP：必须写入下列文件之一，且 `enabled` 不为 false。
 * 配置变更后，下一次 agent run 会按文件指纹热加载（同名覆盖，项目/agent 优先）。
 */
export function describeMcpConfigLocations(opts?: {
  agentName?: string;
  projectRoot?: string;
  maouRoot?: string;
}): string {
  const home = homedir();
  const maou = opts?.maouRoot ?? join(home, ".maou");
  const agent = opts?.agentName ?? "coding";
  const proj = opts?.projectRoot;
  const lines = [
    "MCP is file-configured only (no auto-install registry). Enable a server by writing config; disable with enabled:false or delete the entry.",
    "Standard mcpServers JSON (same shape as Cursor/Claude Desktop), later paths override same server name:",
    `  - ${join(maou, "mcp.json")}`,
    `  - ${join(maou, "agents", agent, "mcp.json")}`,
    ...(proj
      ? [
          `  - ${join(proj, ".mcp.json")}`,
          `  - ${join(proj, ".maou", "mcp.json")}`,
          `  - ${join(proj, ".maou", "agents", agent, "mcp.json")}`,
        ]
      : [
          "  - <project>/.mcp.json",
          "  - <project>/.maou/mcp.json",
          "  - <project>/.maou/agents/<agent>/mcp.json",
        ]),
    "Also scanned if present: ~/.cursor/mcp.json, Claude Desktop config, ~/.claude.json (mcpServers).",
    "Legacy one-file-per-server (type:mcp, command/args or url, enabled):",
    `  - ${join(maou, "agents", agent, "connections")}/*.json`,
    proj
      ? `  - ${join(proj, ".maou", "agents", agent, "connections")}/*.json (overrides global same name)`
      : "  - <project>/.maou/agents/<agent>/connections/*.json (overrides global same name)",
    "After editing these files, the next user message / agent run reloads MCP (hot-reload by config fingerprint; unchanged servers keep their process).",
  ];
  return lines.join("\n");
}

/**
 * 将标准 type 字段映射为 maou transport。
 * 规范：streamable-http / http → streamable-http；sse → sse；stdio → stdio。
 */
export function mapStandardTransport(
  entry: StandardMcpServerEntry,
): McpConnectionTransport | undefined {
  const raw = (entry.type ?? entry.transport ?? "").toString().toLowerCase();
  if (!raw || raw === "stdio") {
    if (entry.command) return "stdio";
    if (entry.url) return "streamable-http";
    return undefined;
  }
  if (raw === "sse") return "sse";
  if (raw === "http" || raw === "streamable-http" || raw === "streamable_http") {
    return "streamable-http";
  }
  if (raw === "auto") return "auto";
  return "auto";
}

/**
 * 单条 mcpServers 条目 → DefinedConnection（与 connections/*.json 统一下游）。
 */
export function standardEntryToConnection(
  name: string,
  entry: StandardMcpServerEntry,
): DefinedConnection | null {
  if (!entry || typeof entry !== "object") return null;

  const enabled =
    entry.disabled === true
      ? false
      : entry.enabled === false
        ? false
        : true;

  let command =
    typeof entry.command === "string" ? expandConnectionEnv(entry.command) : undefined;
  let args = Array.isArray(entry.args)
    ? entry.args.map((a) => (typeof a === "string" ? expandConnectionEnv(a) : String(a)))
    : undefined;
  const url = typeof entry.url === "string" ? expandConnectionEnv(entry.url) : undefined;
  const env =
    entry.env && typeof entry.env === "object" && !Array.isArray(entry.env)
      ? Object.fromEntries(
          Object.entries(entry.env as Record<string, string>).map(([k, v]) => [
            k,
            typeof v === "string" ? expandConnectionEnv(v) : String(v),
          ]),
        )
      : undefined;
  const cwd =
    typeof entry.cwd === "string" ? expandConnectionEnv(entry.cwd) : undefined;

  if (!command && !url) return null;

  const transport = mapStandardTransport(entry);
  const config: Record<string, unknown> = {};
  if (command != null) config.command = command;
  if (args != null) config.args = args;
  if (env != null) config.env = env;
  if (cwd != null) config.cwd = cwd;
  if (transport != null) config.transport = transport;

  return {
    _type: "defineConnection",
    _source: "file",
    name,
    connectionType: "mcp",
    description:
      (typeof entry.description === "string" && entry.description) ||
      `MCP server "${name}"`,
    enabled,
    config,
    url,
    command,
    args,
    env,
    cwd,
    transport,
  };
}

/**
 * 从单个 JSON 文件解析 mcpServers。
 */
export function parseMcpServersFile(
  filePath: string,
): { connections: DefinedConnection[]; names: string[] } {
  if (!existsSync(filePath)) return { connections: [], names: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return { connections: [], names: [] };
  }
  if (!raw || typeof raw !== "object") return { connections: [], names: [] };

  const obj = raw as StandardMcpConfigFile;
  let servers = obj.mcpServers;
  // 兼容：整文件直接是 server map（无 mcpServers 包装）且值含 command/url
  if (!servers && !("mcpServers" in obj)) {
    const keys = Object.keys(obj);
    const looksLikeMap =
      keys.length > 0 &&
      keys.every((k) => {
        const v = obj[k];
        return (
          v &&
          typeof v === "object" &&
          !Array.isArray(v) &&
          ("command" in (v as object) || "url" in (v as object))
        );
      });
    if (looksLikeMap) {
      servers = obj as unknown as Record<string, StandardMcpServerEntry>;
    }
  }
  if (!servers || typeof servers !== "object") {
    return { connections: [], names: [] };
  }

  const connections: DefinedConnection[] = [];
  const names: string[] = [];
  for (const [name, entry] of Object.entries(servers)) {
    if (!name || name.startsWith("_")) continue;
    const conn = standardEntryToConnection(name, entry ?? {});
    if (conn) {
      connections.push(conn);
      names.push(name);
    }
  }
  return { connections, names };
}

/**
 * 发现并合并所有标准配置源的 MCP server 定义。
 * 同名 server：后出现的路径覆盖先出现的（项目级覆盖全局）。
 */
export function discoverStandardMcpConnections(opts: DiscoverMcpConfigOptions): {
  connections: DefinedConnection[];
  sources: DiscoveredMcpConfigSource[];
} {
  const byName = new Map<string, DefinedConnection>();
  const sources: DiscoveredMcpConfigSource[] = [];

  for (const path of listStandardMcpConfigPaths(opts)) {
    if (!existsSync(path)) continue;
    const { connections, names } = parseMcpServersFile(path);
    if (names.length === 0) continue;
    sources.push({ path, serverNames: names });
    for (const c of connections) {
      byName.set(c.name, c);
    }
  }

  return {
    connections: [...byName.values()],
    sources,
  };
}
