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

export interface DefineMcpConnectionConfig {
  /** MCP Server URL（SSE 端点） */
  url: string;

  /** 连接描述（给 LLM 看） */
  description: string;

  /** 认证配置 */
  auth?: ConnectionAuth;

  /** 是否启用（默认 true） */
  enabled?: boolean;

  /** 附加配置 */
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

  /** 附加配置 */
  config: Record<string, unknown>;

  /** MCP 特有：Server URL */
  url?: string;

  /** OpenAPI 特有：Spec URL */
  specUrl?: string;

  /** OpenAPI 特有：Base URL */
  baseUrl?: string;
}

// ─── defineMcpConnection ───────────────────────────────────────────────────

/**
 * 定义一个 MCP Server 连接
 */
export function defineMcpConnection(config: DefineMcpConnectionConfig): (name: string) => DefinedConnection {
  return (name: string) => ({
    _type: "defineConnection",
    _source: "file",
    name,
    connectionType: "mcp",
    description: config.description,
    enabled: config.enabled ?? true,
    auth: config.auth,
    config: config.config ?? {},
    url: config.url,
  });
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
 * 连接注册表
 * 扫描 agent/connections/ 目录，发现并加载连接定义
 */
export class ConnectionRegistry {
  private _connections = new Map<string, DefinedConnection>();
  private _maouRoot: string;

  constructor(maouRoot: string) {
    this._maouRoot = maouRoot;
  }

  /**
   * 扫描指定 agent 的 connections/ 目录
   */
  async loadForAgent(agentName: string): Promise<number> {
    this._connections.clear();
    const connectionsDir = join(this._maouRoot, "agents", agentName, "connections");
    if (!existsSync(connectionsDir)) return 0;

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
              this._connections.set(connName, {
                _type: "defineConnection",
                _source: "file",
                name: connName,
                connectionType: data.type === "mcp" ? "mcp" : "openapi",
                description: data.description || connName,
                enabled: data.enabled ?? true,
                auth: data.auth,
                config: data.config ?? {},
                url: data.url,
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


