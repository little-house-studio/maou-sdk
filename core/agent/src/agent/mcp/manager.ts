/**
 * McpConnectionManager —— 多连接生命周期 + 工具表同步。
 *
 * 职责：
 * 1. 从 ConnectionRegistry / DefinedConnection 批量建连
 * 2. 维护 McpSession 池（connect / disconnect / reconnect / refresh）
 * 3. 汇总 McpToolDescriptor，同步到 ToolRegistry
 * 4. 提供 McpToolInvoker（子 Agent proxy 复用）
 *
 * 失败策略：单连接失败 fail-closed（记录 error，不阻断其他连接）。
 */

import type { ToolRegistry } from "@little-house-studio/tools";
import type { McpToolDescriptor, McpToolInvoker } from "@little-house-studio/types";
import type { ToolResponse } from "@little-house-studio/tools";
import type { DefinedConnection } from "../define-connection.js";
import { ConnectionRegistry } from "../define-connection.js";
import { McpSession, type McpSessionConfig } from "./session.js";
import {
  registerMcpTools,
  unregisterMcpTools,
  type McpToolCallHandler,
} from "./tool-bridge.js";
import { flattenMcpContentToText, type McpListedTool } from "./mappers.js";
import { discoverStandardMcpConnections } from "./config-discover.js";
import { buildMcpCatalogPrompt } from "./catalog.js";
import { createMcpGatewayTool } from "./gateway-tool.js";
import {
  MCP_GATEWAY_TOOL_NAME,
  type McpToolExposureStrategy,
} from "./strategy.js";

/**
 * MCP 工具执行失败（CallToolResult.isError === true）。
 * 与协议/传输错误区分：proxy / bridge 应映射为 ok:false，而非「未连接」。
 */
export class McpToolExecutionError extends Error {
  readonly isMcpToolError = true as const;
  readonly connectionName?: string;
  readonly toolName?: string;

  constructor(
    message: string,
    opts?: { connectionName?: string; toolName?: string },
  ) {
    super(message);
    this.name = "McpToolExecutionError";
    this.connectionName = opts?.connectionName;
    this.toolName = opts?.toolName;
  }
}

/** 是否为工具执行失败（isError），供 proxy 映射 ok:false */
export function isMcpToolExecutionError(err: unknown): err is McpToolExecutionError {
  return (
    err instanceof McpToolExecutionError ||
    (!!err &&
      typeof err === "object" &&
      (err as { isMcpToolError?: boolean }).isMcpToolError === true)
  );
}

export interface McpManagerOptions {
  log?: (level: "debug" | "info" | "warning" | "error", message: string) => void;
  clientInfo?: { name?: string; version?: string };
  /**
   * list_changed 时是否自动刷新并重同步 ToolRegistry。
   * 需已调用 syncToRegistry 绑定 registry。
   * 默认 true。
   */
  autoResyncOnListChanged?: boolean;
}

export interface McpConnectionState {
  name: string;
  status: McpSession["status"];
  lastError: string | null;
  toolCount: number;
  serverName?: string;
  serverVersion?: string;
  description: string;
}

export class McpConnectionManager {
  private sessions = new Map<string, McpSession>();
  private descriptors: McpToolDescriptor[] = [];
  private registeredNames = new Set<string>();
  private boundRegistry: ToolRegistry | null = null;
  private log: NonNullable<McpManagerOptions["log"]>;
  private clientInfo?: { name?: string; version?: string };
  private autoResync: boolean;
  /** 当前已 load 的 agent 名（避免重复扫 connections） */
  private loadedAgent: string | null = null;
  /** Host→LLM 工具暴露策略（flat=全量 mcp__*，gateway=单工具 mcp） */
  private exposureStrategy: McpToolExposureStrategy = "flat";

  constructor(opts: McpManagerOptions = {}) {
    this.log = opts.log ?? (() => {});
    this.clientInfo = opts.clientInfo;
    this.autoResync = opts.autoResyncOnListChanged !== false;
  }

  /** 当前 MCP 工具暴露策略 */
  getToolExposureStrategy(): McpToolExposureStrategy {
    return this.exposureStrategy;
  }

  /**
   * 设置暴露策略；若已绑定 registry，立即按新策略重同步。
   */
  setToolExposureStrategy(strategy: McpToolExposureStrategy): void {
    if (this.exposureStrategy === strategy) return;
    this.exposureStrategy = strategy;
    if (this.boundRegistry) {
      this.syncToRegistry(this.boundRegistry);
    }
  }

  /** 当前已连接 session 数 */
  get sessionCount(): number {
    return this.sessions.size;
  }

  /** 已发现的 MCP 工具描述符 */
  listDescriptors(): McpToolDescriptor[] {
    return [...this.descriptors];
  }

  listToolNames(): string[] {
    return this.descriptors.map((d) => d.name);
  }

  getSession(name: string): McpSession | undefined {
    return this.sessions.get(name);
  }

  listConnectionStates(): McpConnectionState[] {
    return [...this.sessions.values()].map((s) => {
      const ver = s.getServerVersion();
      return {
        name: s.name,
        status: s.status,
        lastError: s.lastError,
        toolCount: this.descriptors.filter((d) => d.connectionName === s.name).length,
        serverName: ver?.name,
        serverVersion: ver?.version,
        description: s.description,
      };
    });
  }

  /**
   * DefinedConnection → McpSessionConfig
   */
  static connectionToConfig(
    conn: DefinedConnection,
    extras?: Partial<McpSessionConfig>,
  ): McpSessionConfig {
    const cfg = conn.config ?? {};
    const command =
      (typeof cfg.command === "string" ? cfg.command : undefined) ??
      (typeof (conn as { command?: string }).command === "string"
        ? (conn as { command?: string }).command
        : undefined);
    const args = Array.isArray(cfg.args)
      ? (cfg.args as string[])
      : Array.isArray((conn as { args?: string[] }).args)
        ? (conn as { args?: string[] }).args
        : undefined;
    const env =
      cfg.env && typeof cfg.env === "object" && !Array.isArray(cfg.env)
        ? (cfg.env as Record<string, string>)
        : (conn as { env?: Record<string, string> }).env;
    const cwd =
      typeof cfg.cwd === "string"
        ? cfg.cwd
        : typeof (conn as { cwd?: string }).cwd === "string"
          ? (conn as { cwd?: string }).cwd
          : undefined;
    const transport =
      (cfg.transport as McpSessionConfig["transport"]) ??
      (conn as { transport?: McpSessionConfig["transport"] }).transport;

    return {
      name: conn.name,
      description: conn.description,
      url: conn.url,
      command,
      args,
      env,
      cwd,
      transport,
      auth: conn.auth,
      ...extras,
    };
  }

  /**
   * 连接单个 session（config 或已有 DefinedConnection）。
   */
  async connect(config: McpSessionConfig | DefinedConnection): Promise<McpSession> {
    const sessionConfig: McpSessionConfig =
      "_type" in config && config._type === "defineConnection"
        ? McpConnectionManager.connectionToConfig(config as DefinedConnection, {
            clientInfo: this.clientInfo,
            log: this.log,
            onToolsChanged: (tools, err) => this.handleToolsChanged(config.name, tools, err),
          })
        : {
            ...(config as McpSessionConfig),
            clientInfo: (config as McpSessionConfig).clientInfo ?? this.clientInfo,
            log: (config as McpSessionConfig).log ?? this.log,
            onToolsChanged:
              (config as McpSessionConfig).onToolsChanged ??
              ((tools, err) => this.handleToolsChanged((config as McpSessionConfig).name, tools, err)),
          };

    // 若已存在：先断开
    const existing = this.sessions.get(sessionConfig.name);
    if (existing) {
      await existing.disconnect().catch(() => {});
      this.sessions.delete(sessionConfig.name);
    }

    const session = new McpSession(sessionConfig);
    await session.connect();
    this.sessions.set(session.name, session);
    await this.rebuildDescriptors();
    if (this.boundRegistry) {
      this.syncToRegistry(this.boundRegistry);
    }
    return session;
  }

  /**
   * 连接一组 DefinedConnection（跳过 disabled / 非 mcp）。
   * 单连接失败不抛，记入 state。
   */
  async connectAll(connections: DefinedConnection[]): Promise<{ ok: number; failed: number }> {
    let ok = 0;
    let failed = 0;
    for (const conn of connections) {
      if (conn.connectionType !== "mcp") continue;
      if (!conn.enabled) {
        this.log("info", `[MCP] skip disabled connection: ${conn.name}`);
        continue;
      }
      try {
        await this.connect(conn);
        ok++;
      } catch (err) {
        failed++;
        this.log(
          "error",
          `[MCP] connect failed ${conn.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
        // 占位 session 不可用：不加入 map（connect 内部已清理）
      }
    }
    return { ok, failed };
  }

  /**
   * 从 maouRoot + agentName 加载 connections/ 并建连。
   *
   * 生命周期（单例 Runtime 可切换多个 agent）：
   * - 切换 agentName：先 disconnectAll，避免上一 agent 的 session/工具泄漏
   * - 同 agent 重载：断开不在新 connections 集合内的 session，再 connectAll
   */
  async loadForAgent(
    maouRoot: string,
    agentName: string,
    opts?: {
      projectRoot?: string;
      /** 是否扫描 Claude/Cursor 等行业标准 mcpServers 路径（默认 true） */
      includeIndustryPaths?: boolean;
      extraConfigPaths?: string[];
    },
  ): Promise<{
    ok: number;
    failed: number;
    discovered: number;
    /** 配置来源路径摘要 */
    sources?: string[];
  }> {
    // 1) 行业标准 mcpServers 文件（Claude Desktop / Cursor / .mcp.json / ~/.maou/mcp.json …）
    const standard = discoverStandardMcpConnections({
      maouRoot,
      projectRoot: opts?.projectRoot,
      agentName,
      includeIndustryPaths: opts?.includeIndustryPaths,
      extraConfigPaths: opts?.extraConfigPaths,
    });

    // 2) 既有 agents/<name>/connections/*（JSON 单连接文件，兼容旧约定）
    const registry = new ConnectionRegistry(maouRoot);
    const connFileCount = await registry.loadForAgent(agentName, {
      projectRoot: opts?.projectRoot,
    });

    // 合并：同名后写覆盖 — connections/ 优先于全局 mcpServers（agent 局部更具体）
    const byName = new Map<string, DefinedConnection>();
    for (const c of standard.connections) {
      if (c.connectionType === "mcp") byName.set(c.name, c);
    }
    for (const c of registry.listAll()) {
      if (c.connectionType === "mcp") byName.set(c.name, c);
    }

    const all = [...byName.values()];
    const discovered = all.length;
    const desiredNames = new Set(
      all.filter((c) => c.enabled !== false).map((c) => c.name),
    );

    if (this.loadedAgent !== null && this.loadedAgent !== agentName) {
      this.log(
        "info",
        `[MCP] agent switch ${this.loadedAgent} → ${agentName}: disconnectAll (drop ${this.sessions.size} sessions)`,
      );
      await this.disconnectAll();
    } else {
      // 同 agent：裁掉已不在配置中的连接（避免 stale session/tools）
      for (const name of [...this.sessions.keys()]) {
        if (!desiredNames.has(name)) {
          this.log("info", `[MCP] prune stale connection not in agent set: ${name}`);
          await this.disconnect(name);
        }
      }
    }

    const result = await this.connectAll(all);
    this.loadedAgent = agentName;
    const sourcePaths = standard.sources.map((s) => s.path);
    this.log(
      "info",
      `[MCP] agent=${agentName} discovered=${discovered}` +
        ` (mcpServers_files=${standard.sources.length}, connections_files=${connFileCount})` +
        ` connected=${result.ok} failed=${result.failed}` +
        (opts?.projectRoot ? ` projectRoot=${opts.projectRoot}` : ""),
    );
    if (sourcePaths.length > 0) {
      this.log("debug", `[MCP] config sources: ${sourcePaths.join(" | ")}`);
    }
    return { ...result, discovered, sources: sourcePaths };
  }

  /**
   * 生成 system prompt 用的 MCP catalog（tools/list + 可选 resources/prompts）。
   * 主调用通道仍是 tool schema；此段为索引说明（合规、不替代 tools/call）。
   */
  async buildCatalogPrompt(opts?: {
    enrichLists?: boolean;
  }): Promise<string> {
    return buildMcpCatalogPrompt(this, {
      enrichLists: opts?.enrichLists,
    });
  }

  /**
   * 若当前已是该 agent 且仍有 session，则跳过；否则 loadForAgent。
   * agent 切换一定会走 loadForAgent（由 loadedAgent 比较触发 disconnectAll）。
   */
  async ensureLoadedForAgent(
    maouRoot: string,
    agentName: string,
    opts?: { projectRoot?: string },
  ): Promise<{ ok: number; failed: number; discovered: number }> {
    if (this.loadedAgent === agentName && this.sessions.size > 0) {
      return { ok: this.sessions.size, failed: 0, discovered: this.sessions.size };
    }
    return this.loadForAgent(maouRoot, agentName, opts);
  }

  async disconnect(name: string): Promise<void> {
    const session = this.sessions.get(name);
    if (!session) return;
    await session.disconnect();
    this.sessions.delete(name);
    await this.rebuildDescriptors();
    if (this.boundRegistry) {
      this.syncToRegistry(this.boundRegistry);
    }
  }

  async disconnectAll(): Promise<void> {
    const names = [...this.sessions.keys()];
    for (const name of names) {
      try {
        await this.sessions.get(name)?.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.sessions.clear();
    this.descriptors = [];
    this.loadedAgent = null;
    if (this.boundRegistry) {
      unregisterMcpTools(this.boundRegistry, this.registeredNames);
      this.registeredNames.clear();
    }
  }

  /**
   * 刷新工具列表（指定连接或全部）。
   */
  async refreshTools(connectionName?: string): Promise<McpToolDescriptor[]> {
    const targets = connectionName
      ? [this.sessions.get(connectionName)].filter(Boolean) as McpSession[]
      : [...this.sessions.values()];

    for (const s of targets) {
      if (!s.connected) continue;
      try {
        await s.listTools({ force: true });
      } catch (err) {
        this.log(
          "warning",
          `[MCP] refreshTools ${s.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    await this.rebuildDescriptors();
    if (this.boundRegistry) {
      this.syncToRegistry(this.boundRegistry);
    }
    return this.listDescriptors();
  }

  async reconnect(name: string): Promise<void> {
    const session = this.sessions.get(name);
    if (!session) {
      throw new Error(`MCP connection "${name}" not found`);
    }
    await session.reconnect();
    await this.rebuildDescriptors();
    if (this.boundRegistry) {
      this.syncToRegistry(this.boundRegistry);
    }
  }

  /**
   * 把当前 descriptors 注册到 ToolRegistry（替换本 manager 先前注册的 mcp 工具）。
   *
   * @param strategy 可选；缺省用 setToolExposureStrategy / 默认 flat
   *   - flat：每个 descriptor → mcp__server__tool
   *   - gateway：仅注册元工具 `mcp`（list/search/schema/call）
   */
  syncToRegistry(
    registry: ToolRegistry,
    strategy?: McpToolExposureStrategy,
  ): string[] {
    this.boundRegistry = registry;
    if (strategy) {
      this.exposureStrategy = strategy;
    }
    unregisterMcpTools(registry, this.registeredNames);
    this.registeredNames.clear();

    const handler = this.createHandler();
    const mode = this.exposureStrategy;

    if (mode === "gateway") {
      const gateway = createMcpGatewayTool({
        listDescriptors: () => this.listDescriptors(),
        listConnectionStates: () => this.listConnectionStates(),
        callHandler: handler,
      });
      registry.register(gateway);
      this.registeredNames.add(MCP_GATEWAY_TOOL_NAME);
      this.log(
        "info",
        `[MCP] synced gateway mode → tool "${MCP_GATEWAY_TOOL_NAME}" (${this.descriptors.length} underlying tools hidden from LLM tools[])`,
      );
      return [MCP_GATEWAY_TOOL_NAME];
    }

    const names = registerMcpTools(registry, this.descriptors, handler);
    for (const n of names) this.registeredNames.add(n);
    this.log(
      "info",
      `[MCP] synced flat mode → ${names.length} tools to registry`,
    );
    return names;
  }

  /**
   * 标准 McpToolInvoker（返回文本）。
   *
   * 工具执行失败（CallToolResult.isError）→ 抛出 {@link McpToolExecutionError}
   *（非协议/传输错误）。createMcpProxyTool 捕获后映射为 ok:false。
   * 协议/断连错误 → 普通 Error。
   */
  createInvoker(): McpToolInvoker {
    return async (connectionName, toolName, args) => {
      const session = this.sessions.get(connectionName);
      if (!session || !session.connected) {
        throw new Error(
          `MCP connection "${connectionName}" is not connected` +
            (session?.lastError ? ` (${session.lastError})` : ""),
        );
      }
      const result = await session.callToolRaw(toolName, args);
      const text = flattenMcpContentToText(result);
      if (result.isError) {
        throw new McpToolExecutionError(
          text || `tool ${toolName} failed (isError)`,
          { connectionName, toolName },
        );
      }
      return text;
    };
  }

  /**
   * 完整 ToolResponse handler（推荐 agent 主路径）。
   */
  createHandler(): McpToolCallHandler {
    return async (connectionName, toolName, args): Promise<string | ToolResponse> => {
      const session = this.sessions.get(connectionName);
      if (!session || !session.connected) {
        throw new Error(
          `MCP connection "${connectionName}" is not connected` +
            (session?.lastError ? ` (${session.lastError})` : ""),
        );
      }
      return session.callToolAsResponse(toolName, args);
    };
  }

  // ── internal ──

  private async rebuildDescriptors(): Promise<void> {
    const all: McpToolDescriptor[] = [];
    for (const session of this.sessions.values()) {
      if (!session.connected) continue;
      try {
        const descs = await session.listToolDescriptors({ force: false });
        all.push(...descs);
      } catch (err) {
        this.log(
          "warning",
          `[MCP] listToolDescriptors ${session.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    this.descriptors = all;
  }

  private handleToolsChanged(
    connectionName: string,
    _tools: McpListedTool[],
    error?: Error,
  ): void {
    if (error) return;
    // 异步刷新，避免阻塞通知路径
    void (async () => {
      try {
        await this.rebuildDescriptors();
        if (this.autoResync && this.boundRegistry) {
          this.syncToRegistry(this.boundRegistry);
        }
        this.log("info", `[MCP] ${connectionName} tools refreshed after list_changed`);
      } catch (err) {
        this.log(
          "warning",
          `[MCP] list_changed resync failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    })();
  }
}
