/**
 * defineConnection — 外部连接定义 API（对标 Vercel Eve）
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";

// ─── 认证类型 ──────────────────────────────────────────────────────────────

export interface TokenAuth {
  type: "token";
  getToken: () => Promise<{ token: string }> | { token: string };
  header?: string; // 默认 "Authorization: Bearer {token}"
}

export interface OAuthAuth {
  type: "oauth";
  clientId: string;
  clientSecret?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  scopes?: string[];
  getToken: () => Promise<{ token: string }> | { token: string };
}

export interface ApiKeyAuth {
  type: "api_key";
  key: string;
  value: string;
  header?: string; // 默认放在 query param
}

export type ConnectionAuth = TokenAuth | OAuthAuth | ApiKeyAuth;

// ─── MCP 连接 ──────────────────────────────────────────────────────────────

/**
 * MCP 传输类型（与 McpSession 对齐）。
 * - stdio：本地子进程
 * - sse：遗留 HTTP+SSE
 * - streamable-http：推荐远程传输（MCP 2025-03+）
 * - auto：按 command/url 推断
 */
export type McpConnectionTransport = "stdio" | "sse" | "streamable-http" | "auto";

export interface DefineMcpConnectionConfig {
  /**
   * MCP Server URL（SSE 或 Streamable HTTP 端点）。
   * 与 command 二选一（或同时提供时由 transport 决定）。
   */
  url?: string;

  /**
   * stdio：启动 MCP server 的可执行文件。
   * 例：`npx`、`node`、`uvx`
   */
  command?: string;

  /** stdio：命令行参数 */
  args?: string[];

  /** stdio：附加环境变量（与默认 env 合并） */
  env?: Record<string, string>;

  /** stdio：工作目录 */
  cwd?: string;

  /**
   * 传输类型。默认 auto：
   * - 有 command → stdio
   * - 有 url 且 path 含 /sse → sse
   * - 有 url → streamable-http
   */
  transport?: McpConnectionTransport;

  /** 连接描述（给 LLM 看） */
  description: string;

  /** 认证配置（HTTP 传输） */
  auth?: ConnectionAuth;

  /** 是否启用（默认 true） */
  enabled?: boolean;

  /** 附加配置（会并入 DefinedConnection.config） */
  config?: Record<string, unknown>;
}

// ─── OpenAPI 连接 ──────────────────────────────────────────────────────────

export interface DefineOpenApiConnectionConfig {
  /** OpenAPI 文档 URL 或本地路径 */
  specUrl: string;

  /** 连接描述 */
  description: string;

  /** API 基础 URL */
  baseUrl: string;

  /** 认证配置 */
  auth?: ConnectionAuth;

  /** 是否启用（默认 true） */
  enabled?: boolean;

  /** 附加配置 */
  config?: Record<string, unknown>;
}

// ─── DefinedConnection ─────────────────────────────────────────────────────

export type ConnectionType = "mcp" | "openapi";

export interface DefinedConnection {
  readonly _type: "defineConnection";
  readonly _source: "file";

  /** 连接名（文件名去掉扩展名） */
  name: string;

  /** 连接类型 */
  connectionType: ConnectionType;

  /** 描述 */
  description: string;

  /** 是否启用 */
  enabled: boolean;

  /** 认证 */
  auth?: ConnectionAuth;

  /** 附加配置（stdio 的 command/args/env/cwd/transport 亦写入此处以便 JSON 配置） */
  config: Record<string, unknown>;

  /** MCP 特有：Server URL */
  url?: string;

  /** MCP 特有：stdio command */
  command?: string;

  /** MCP 特有：stdio args */
  args?: string[];

  /** MCP 特有：stdio env */
  env?: Record<string, string>;

  /** MCP 特有：stdio cwd */
  cwd?: string;

  /** MCP 特有：传输类型 */
  transport?: McpConnectionTransport;

  /** OpenAPI 特有：Spec URL */
  specUrl?: string;

  /** OpenAPI 特有：Base URL */
  baseUrl?: string;
}

// ─── defineMcpConnection ───────────────────────────────────────────────────

/**
 * 定义一个 MCP Server 连接（stdio / SSE / Streamable HTTP）
 */
export function defineMcpConnection(config: DefineMcpConnectionConfig): (name: string) => DefinedConnection {
  return (name: string) => {
    if (!config.url && !config.command) {
      throw new Error(
        `defineMcpConnection("${name}"): require url (HTTP) or command (stdio)`,
      );
    }
    // 将 stdio 字段镜像进 config，便于 JSON 加载与 manager.connectionToConfig 统一读取
    const mergedConfig: Record<string, unknown> = {
      ...(config.config ?? {}),
    };
    if (config.command != null) mergedConfig.command = config.command;
    if (config.args != null) mergedConfig.args = config.args;
    if (config.env != null) mergedConfig.env = config.env;
    if (config.cwd != null) mergedConfig.cwd = config.cwd;
    if (config.transport != null) mergedConfig.transport = config.transport;

    return {
      _type: "defineConnection",
      _source: "file",
      name,
      connectionType: "mcp",
      description: config.description,
      enabled: config.enabled ?? true,
      auth: config.auth,
      config: mergedConfig,
      url: config.url,
      command: config.command,
      args: config.args,
      env: config.env,
      cwd: config.cwd,
      transport: config.transport,
    };
  };
}

// ─── defineOpenApiConnection ───────────────────────────────────────────────

/**
 * 定义一个 OpenAPI 连接
 */
export function defineOpenApiConnection(config: DefineOpenApiConnectionConfig): (name: string) => DefinedConnection {
  return (name: string) => ({
    _type: "defineConnection",
    _source: "file",
    name,
    connectionType: "openapi",
    description: config.description,
    enabled: config.enabled ?? true,
    auth: config.auth,
    config: config.config ?? {},
    specUrl: config.specUrl,
    baseUrl: config.baseUrl,
  });
}

// ─── ConnectionRegistry ────────────────────────────────────────────────────

/**
 * 展开 command/args 中的环境变量：
 * - `${VAR}` / `$VAR`
 * 未定义变量替换为空字符串。
 */
export function expandConnectionEnv(value: string): string {
  return value
    .replace(/\$\{([^}]+)\}/g, (_, key: string) => process.env[key] ?? "")
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, key: string) => process.env[key] ?? "");
}

/**
 * 连接注册表
 * 扫描 agent/connections/ 目录，发现并加载连接定义。
 *
 * 搜索顺序（后者同名覆盖前者）：
 * 1. `<maouRoot>/agents/<name>/connections/`（全局 ~/.maou）
 * 2. 可选 projectRoot：`<projectRoot>/.maou/agents/<name>/connections/`（项目级）
 */
export class ConnectionRegistry {
  private _connections = new Map<string, DefinedConnection>();
  private _maouRoot: string;

  constructor(maouRoot: string) {
    this._maouRoot = maouRoot;
  }

  /**
   * 扫描指定 agent 的 connections/ 目录
   * @param agentName agent 名
   * @param opts.projectRoot 若提供，额外扫描项目级 .maou/agents/<name>/connections
   */
  async loadForAgent(
    agentName: string,
    opts?: { projectRoot?: string },
  ): Promise<number> {
    this._connections.clear();
    const dirs: string[] = [
      join(this._maouRoot, "agents", agentName, "connections"),
    ];
    if (opts?.projectRoot) {
      const projDir = join(opts.projectRoot, ".maou", "agents", agentName, "connections");
      if (projDir !== dirs[0]) dirs.push(projDir);
    }

    let count = 0;
    for (const connectionsDir of dirs) {
      if (!existsSync(connectionsDir)) continue;
      count += await this._loadDir(connectionsDir);
    }
    return count;
  }

  private async _loadDir(connectionsDir: string): Promise<number> {
    let count = 0;
    try {
      const entries = readdirSync(connectionsDir).sort();
      for (const entry of entries) {
        if (entry.startsWith(".")) continue;
        if (!entry.endsWith(".ts") && !entry.endsWith(".mjs") && !entry.endsWith(".json")) continue;

        const fullPath = join(connectionsDir, entry);
        const connName = basename(entry, entry.includes(".") ? entry.slice(entry.lastIndexOf(".")) : "");

        try {
          if (entry.endsWith(".json")) {
            // JSON 配置文件
            const data = JSON.parse(readFileSync(fullPath, "utf-8"));
            if (data && typeof data === "object" && "type" in data) {
              const baseConfig =
                data.config && typeof data.config === "object" && !Array.isArray(data.config)
                  ? { ...(data.config as Record<string, unknown>) }
                  : {};
              // 顶层 stdio 字段并入 config
              if (data.command != null) baseConfig.command = data.command;
              if (data.args != null) baseConfig.args = data.args;
              if (data.env != null) baseConfig.env = data.env;
              if (data.cwd != null) baseConfig.cwd = data.cwd;
              if (data.transport != null) baseConfig.transport = data.transport;

              let command = data.command ?? (baseConfig.command as string | undefined);
              let args = (data.args ?? baseConfig.args) as string[] | undefined;
              if (typeof command === "string") command = expandConnectionEnv(command);
              if (Array.isArray(args)) {
                args = args.map((a) => (typeof a === "string" ? expandConnectionEnv(a) : a));
                baseConfig.args = args;
              }
              if (typeof command === "string") baseConfig.command = command;

              this._connections.set(connName, {
                _type: "defineConnection",
                _source: "file",
                name: connName,
                connectionType: data.type === "mcp" ? "mcp" : "openapi",
                description: data.description || connName,
                enabled: data.enabled ?? true,
                auth: data.auth,
                config: baseConfig,
                url: data.url,
                command,
                args,
                env: data.env ?? (baseConfig.env as Record<string, string> | undefined),
                cwd: data.cwd ?? (baseConfig.cwd as string | undefined),
                transport: data.transport ?? (baseConfig.transport as McpConnectionTransport | undefined),
                specUrl: data.specUrl,
                baseUrl: data.baseUrl,
              });
              count++;
            }
          } else {
            // .ts / .mjs 文件 — 动态 import
            const absolutePath = await import("node:path").then((m) => m.resolve(fullPath));
            const module = await import(absolutePath);
            const defaultExport = module.default;
            if (defaultExport && typeof defaultExport === "function") {
              const conn = defaultExport(connName);
              if (conn && conn._type === "defineConnection") {
                this._connections.set(connName, conn);
                count++;
              }
            } else if (defaultExport && defaultExport._type === "defineConnection") {
              this._connections.set(connName, defaultExport);
              count++;
            }
          }
        } catch { /* skip malformed */ }
      }
    } catch { /* ignore */ }

    return count;
  }

  get(name: string): DefinedConnection | undefined {
    return this._connections.get(name);
  }

  listAll(): DefinedConnection[] {
    return [...this._connections.values()];
  }

  get count(): number {
    return this._connections.size;
  }
}


