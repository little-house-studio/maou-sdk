/**
 * McpSession —— 单连接 MCP 客户端会话（host/client 侧）。
 *
 * 基于官方 `@modelcontextprotocol/sdk` Client：
 * - connect() 时自动 initialize + capability 协商
 * - tools/list|call、resources/list|read、prompts/list|get
 * - list_changed 通知 → 可选自动刷新工具缓存
 *
 * 传输：stdio / SSE / Streamable HTTP / 外部注入 Transport（测试用 InMemory）。
 *
 * Spec: MCP 2025-11-25（JSON-RPC 2.0）
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ConnectionAuth } from "../define-connection.js";
import type { McpCallToolResult, McpListedTool } from "./mappers.js";
import {
  flattenMcpContentToText,
  mapCallToolResultToToolResponse,
  mapListedToolToDescriptor,
  mapProtocolErrorToToolResponse,
} from "./mappers.js";
import type { McpToolDescriptor } from "@little-house-studio/types";
import type { ToolResponse } from "@little-house-studio/tools";

// ─── 配置 ──────────────────────────────────────────────────────────────────

export type McpTransportKind = "stdio" | "sse" | "streamable-http" | "auto";

export interface McpSessionConfig {
  /** 连接名（namespacing / 日志） */
  name: string;
  /** 描述（可选） */
  description?: string;
  /** 远程 URL（SSE 或 Streamable HTTP） */
  url?: string;
  /** stdio：可执行文件 */
  command?: string;
  /** stdio：参数 */
  args?: string[];
  /** stdio：环境变量（与默认 env 合并） */
  env?: Record<string, string>;
  /** stdio：工作目录 */
  cwd?: string;
  /**
   * 传输类型。auto（默认）：
   * - 有 command → stdio
   * - 有 url 且 path 含 /sse → sse
   * - 有 url → streamable-http
   */
  transport?: McpTransportKind;
  /** HTTP 认证（SSE / Streamable HTTP） */
  auth?: ConnectionAuth;
  /** 测试/自定义：直接注入 Transport（优先于 url/command） */
  transportInstance?: Transport;
  /** 客户端实现信息 */
  clientInfo?: { name?: string; version?: string };
  /** 工具列表变更回调（list_changed） */
  onToolsChanged?: (tools: McpListedTool[], error?: Error) => void;
  /** 日志 */
  log?: (level: "debug" | "info" | "warning" | "error", message: string) => void;
}

export type McpSessionStatus = "idle" | "connecting" | "connected" | "error" | "closed";

// ─── Auth headers ──────────────────────────────────────────────────────────

async function resolveAuthHeaders(auth?: ConnectionAuth): Promise<Record<string, string>> {
  if (!auth) return {};
  if (auth.type === "token") {
    const { token } = await Promise.resolve(auth.getToken());
    if (auth.header) {
      if (auth.header.includes("{token}")) {
        const rendered = auth.header.replaceAll("{token}", token);
        const colon = rendered.indexOf(":");
        if (colon > 0) {
          return { [rendered.slice(0, colon).trim()]: rendered.slice(colon + 1).trim() };
        }
        return { Authorization: rendered };
      }
      // header 字段当作 header 名
      if (!auth.header.includes(" ")) {
        return { [auth.header]: `Bearer ${token}` };
      }
      return { Authorization: auth.header.replaceAll("{token}", token) };
    }
    return { Authorization: `Bearer ${token}` };
  }
  if (auth.type === "api_key") {
    if (auth.header) {
      return { [auth.header]: auth.value };
    }
    // 默认 query 风格在 transport 层难通用；放 header
    return { [auth.key]: auth.value };
  }
  if (auth.type === "oauth") {
    const { token } = await Promise.resolve(auth.getToken());
    return { Authorization: `Bearer ${token}` };
  }
  return {};
}

function resolveTransportKind(cfg: McpSessionConfig): Exclude<McpTransportKind, "auto"> {
  if (cfg.transport && cfg.transport !== "auto") return cfg.transport;
  if (cfg.command) return "stdio";
  if (cfg.url) {
    try {
      const u = new URL(cfg.url);
      if (u.pathname.includes("/sse") || u.searchParams.get("transport") === "sse") {
        return "sse";
      }
    } catch {
      /* fallthrough */
    }
    return "streamable-http";
  }
  throw new Error(
    `MCP connection "${cfg.name}": need command (stdio), url (http/sse), or transportInstance`,
  );
}

// ─── Session ───────────────────────────────────────────────────────────────

export class McpSession {
  readonly name: string;
  readonly description: string;
  private readonly cfg: McpSessionConfig;
  private client: Client | null = null;
  private transport: Transport | null = null;
  private _status: McpSessionStatus = "idle";
  private _lastError: string | null = null;
  private _toolsCache: McpListedTool[] = [];
  private _ownsTransport = true;
  private log: NonNullable<McpSessionConfig["log"]>;

  constructor(cfg: McpSessionConfig) {
    this.cfg = cfg;
    this.name = cfg.name;
    this.description = cfg.description ?? cfg.name;
    this.log = cfg.log ?? (() => {});
  }

  get status(): McpSessionStatus {
    return this._status;
  }

  get lastError(): string | null {
    return this._lastError;
  }

  get connected(): boolean {
    return this._status === "connected" && this.client != null;
  }

  /** 底层 Client（已连接时） */
  getClient(): Client | null {
    return this.client;
  }

  getServerCapabilities(): ReturnType<Client["getServerCapabilities"]> {
    return this.client?.getServerCapabilities();
  }

  getServerVersion(): ReturnType<Client["getServerVersion"]> {
    return this.client?.getServerVersion();
  }

  getInstructions(): string | undefined {
    return this.client?.getInstructions();
  }

  /**
   * 建立连接并完成 initialize。
   * 幂等：已 connected 则 no-op。
   */
  async connect(): Promise<void> {
    if (this._status === "connected" && this.client) return;
    if (this._status === "connecting") {
      throw new Error(`MCP connection "${this.name}" is already connecting`);
    }

    this._status = "connecting";
    this._lastError = null;

    try {
      const clientInfo = {
        name: this.cfg.clientInfo?.name ?? "maou-agent",
        version: this.cfg.clientInfo?.version ?? "0.1.0",
      };

      const onToolsChanged = this.cfg.onToolsChanged;
      const client = new Client(clientInfo, {
        capabilities: {},
        listChanged: onToolsChanged
          ? {
              tools: {
                onChanged: (error, tools) => {
                  if (error) {
                    this.log("warning", `[MCP:${this.name}] tools list_changed error: ${error.message}`);
                    onToolsChanged(this._toolsCache, error);
                    return;
                  }
                  const listed = (tools ?? []) as McpListedTool[];
                  this._toolsCache = listed;
                  this.log("info", `[MCP:${this.name}] tools list_changed → ${listed.length} tools`);
                  onToolsChanged(listed);
                },
              },
            }
          : undefined,
      });

      let transport: Transport;
      if (this.cfg.transportInstance) {
        transport = this.cfg.transportInstance;
        this._ownsTransport = false;
      } else {
        transport = await this.createTransport();
        this._ownsTransport = true;
      }

      await client.connect(transport);
      this.client = client;
      this.transport = transport;
      this._status = "connected";

      const ver = client.getServerVersion();
      const caps = client.getServerCapabilities();
      this.log(
        "info",
        `[MCP:${this.name}] connected` +
          (ver ? ` server=${ver.name}@${ver.version}` : "") +
          (caps ? ` caps=${Object.keys(caps).join(",")}` : ""),
      );

      // 预拉 tools
      try {
        await this.listTools({ force: true });
      } catch (err) {
        this.log(
          "warning",
          `[MCP:${this.name}] initial listTools failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } catch (err) {
      this._status = "error";
      this._lastError = err instanceof Error ? err.message : String(err);
      this.client = null;
      this.transport = null;
      throw err;
    }
  }

  /**
   * 断开连接并释放传输（stdio 子进程等）。
   */
  async disconnect(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.transport = null;
    this._toolsCache = [];
    this._status = "closed";
    if (client) {
      try {
        await client.close();
      } catch (err) {
        this.log(
          "warning",
          `[MCP:${this.name}] close error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * 重连：先 disconnect 再 connect。
   */
  async reconnect(): Promise<void> {
    await this.disconnect();
    this._status = "idle";
    await this.connect();
  }

  private ensureClient(): Client {
    if (!this.client || this._status !== "connected") {
      throw new Error(
        `MCP connection "${this.name}" is not connected (status=${this._status}` +
          (this._lastError ? `, lastError=${this._lastError}` : "") +
          `)`,
      );
    }
    return this.client;
  }

  /**
   * tools/list
   */
  async listTools(opts?: { force?: boolean }): Promise<McpListedTool[]> {
    if (!opts?.force && this._toolsCache.length > 0) {
      return this._toolsCache;
    }
    const client = this.ensureClient();
    const result = await client.listTools();
    this._toolsCache = (result.tools ?? []) as McpListedTool[];
    return this._toolsCache;
  }

  /**
   * 缓存中的 tools → descriptors
   */
  async listToolDescriptors(opts?: { force?: boolean }): Promise<McpToolDescriptor[]> {
    const tools = await this.listTools(opts);
    return tools.map((t) => mapListedToolToDescriptor(this.name, t));
  }

  /**
   * tools/call — 返回原始 MCP 结果（保留 isError）。
   * 协议错误会抛出。
   */
  async callToolRaw(
    toolName: string,
    args: Record<string, unknown> = {},
  ): Promise<McpCallToolResult> {
    const client = this.ensureClient();
    const result = await client.callTool({
      name: toolName,
      arguments: args,
    });
    return result as McpCallToolResult;
  }

  /**
   * tools/call — 文本结果。
   * isError 时仍返回文本（不抛）；协议错误抛出。
   */
  async callToolText(toolName: string, args: Record<string, unknown> = {}): Promise<string> {
    const result = await this.callToolRaw(toolName, args);
    const text = flattenMcpContentToText(result);
    if (result.isError) {
      // 工具执行失败：返回错误文本但不抛（调用方可检查前缀/自行处理）
      return text || `Tool ${toolName} failed (isError)`;
    }
    return text;
  }

  /**
   * tools/call → agent ToolResponse（isError → ok:false）。
   * 协议错误 → ok:false + protocolError payload（不抛，便于 Tool 路径）。
   */
  async callToolAsResponse(
    toolName: string,
    args: Record<string, unknown> = {},
  ): Promise<ToolResponse> {
    try {
      const result = await this.callToolRaw(toolName, args);
      return mapCallToolResultToToolResponse(result, {
        connectionName: this.name,
        toolName,
      });
    } catch (err) {
      return mapProtocolErrorToToolResponse(err, {
        connectionName: this.name,
        toolName,
      });
    }
  }

  /**
   * resources/list
   */
  async listResources(): Promise<
    { uri: string; name?: string; description?: string; mimeType?: string }[]
  > {
    const client = this.ensureClient();
    const caps = client.getServerCapabilities();
    if (caps && !caps.resources) {
      return [];
    }
    const result = await client.listResources();
    return (result.resources ?? []) as {
      uri: string;
      name?: string;
      description?: string;
      mimeType?: string;
    }[];
  }

  /**
   * resources/read
   */
  async readResource(uri: string): Promise<{
    contents: {
      uri: string;
      mimeType?: string;
      text?: string;
      blob?: string;
    }[];
  }> {
    const client = this.ensureClient();
    const result = await client.readResource({ uri });
    return {
      contents: (result.contents ?? []) as {
        uri: string;
        mimeType?: string;
        text?: string;
        blob?: string;
      }[],
    };
  }

  /**
   * prompts/list
   */
  async listPrompts(): Promise<
    { name: string; description?: string; arguments?: { name: string; description?: string; required?: boolean }[] }[]
  > {
    const client = this.ensureClient();
    const caps = client.getServerCapabilities();
    if (caps && !caps.prompts) {
      return [];
    }
    const result = await client.listPrompts();
    return (result.prompts ?? []) as {
      name: string;
      description?: string;
      arguments?: { name: string; description?: string; required?: boolean }[];
    }[];
  }

  /**
   * prompts/get
   */
  async getPrompt(
    name: string,
    args?: Record<string, string>,
  ): Promise<{
    description?: string;
    messages: unknown[];
  }> {
    const client = this.ensureClient();
    const result = await client.getPrompt({
      name,
      arguments: args,
    });
    return {
      description: result.description,
      messages: (result.messages ?? []) as unknown[],
    };
  }

  // ── transport factory ──

  private async createTransport(): Promise<Transport> {
    const kind = resolveTransportKind(this.cfg);

    if (kind === "stdio") {
      if (!this.cfg.command) {
        throw new Error(`MCP connection "${this.name}": stdio requires command`);
      }
      return new StdioClientTransport({
        command: this.cfg.command,
        args: this.cfg.args,
        env: this.cfg.env,
        cwd: this.cfg.cwd,
        stderr: "pipe",
      });
    }

    if (!this.cfg.url) {
      throw new Error(`MCP connection "${this.name}": ${kind} requires url`);
    }
    const url = new URL(this.cfg.url);
    const headers = await resolveAuthHeaders(this.cfg.auth);
    const requestInit =
      Object.keys(headers).length > 0 ? { headers } : undefined;

    if (kind === "sse") {
      return new SSEClientTransport(url, {
        requestInit,
      });
    }

    // streamable-http（推荐远程传输）
    return new StreamableHTTPClientTransport(url, {
      requestInit,
    });
  }
}

// re-export for callers that only need result type
export type { McpCallToolResult, McpListedTool };
