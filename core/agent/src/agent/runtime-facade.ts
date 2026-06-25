/**
 * Runtime 门面 —— 通用高层 AgentRuntime 包装。
 *
 * 包装本包的 AgentRuntime（./runtime.js），叠加：
 * - LLM POST 日志注入（每次调用写 raw.jsonl）
 * - ModelCaller / ToolExecutor 装配
 * - agent 管理（list/init/factory presets）
 * - 按 sessionId 隔离的请求上下文（引用计数）
 *
 * 所有 agent 应用（coding-agent / 未来别的 agent）复用此门面。
 * 注：门面携带应用级日志（pino），是有意并入 agent 层的取舍。
 */

import { PromptCompiler } from "@little-house-studio/prompt";
import { SessionStore } from "@little-house-studio/context";
import { ModelCaller } from "@little-house-studio/llm";
import type { APIPreset } from "@little-house-studio/llm";
import type { LLMClient } from "@little-house-studio/llm";
import type { LLMPostLogger } from "@little-house-studio/llm";
import type { LLMPostLogRecord } from "@little-house-studio/llm";
import { ToolExecutor } from "@little-house-studio/tools";
import type { ToolRegistry } from "@little-house-studio/tools";
import type { StreamEvent } from "@little-house-studio/types";
import type { ConfigStore } from "@little-house-studio/types";
import { AgentRuntime } from "./runtime.js";
import { GitWatcher } from "../agent_factory/git-watcher.js";
import { createAppLogger } from "./app-logger.js";
import { join } from "node:path";

// ─── Runtime 门面 ──────────────────────────────────────────────────────────

export interface AppRuntimeOptions {
  configStore: ConfigStore;
  sessionStore: SessionStore;
  toolRegistry: ToolRegistry;
  llmClient: LLMClient;
  maouRoot?: string;
  projectRoot?: string;
}

/**
 * Runtime — 供 server / 应用层使用的高层门面。
 * 包装 AgentRuntime 并提供 agent 管理、项目管理等服务端 API。
 */
export class Runtime {
  private configStore: ConfigStore;
  private sessionStore: SessionStore;
  private toolRegistry: ToolRegistry;
  private llmClient: LLMClient;
  private maouRoot: string;
  private projectRoot: string;
  private agentRuntime: AgentRuntime | null = null;
  private appLogger = createAppLogger();
  /**
   * 按 sessionId 隔离的请求上下文。
   * 同一 session 并发 run 时，用引用计数避免后者覆盖前者 / finally 误删前者。
   * Map<sessionId, { ctx, refCount }>
   */
  private lastRequestContext = new Map<string, { ctx: { source?: string; traceId?: string; agentName?: string }; refCount: number }>();
  gitWatcher: GitWatcher;

  constructor(options: AppRuntimeOptions) {
    this.configStore = options.configStore;
    this.sessionStore = options.sessionStore;
    this.toolRegistry = options.toolRegistry;
    this.llmClient = options.llmClient;
    this.maouRoot = options.maouRoot ?? join(process.env.HOME ?? '', '.maou');
    this.projectRoot = options.projectRoot ?? process.cwd();
    this.gitWatcher = new GitWatcher(this.maouRoot, this.projectRoot);
  }

  private getRuntime(): AgentRuntime {
    if (!this.agentRuntime) {
      const config = this.configStore.get();
      const compiler = new PromptCompiler({ promptRoot: config.api.promptRoot, projectRoot: process.cwd() });

      // 注入 LLM POST 日志记录器 —— 每次 LLM 调用自动写入 raw.jsonl
      const sessionStore = this.sessionStore;
      const requestContextMap = this.lastRequestContext;

      // 启用完整 body 压缩存储
      (this.llmClient as { setPostLogOptions?: (opts: { keepFullBody?: boolean }) => void }).setPostLogOptions?.({ keepFullBody: true });

      (this.llmClient as { setPostLogger?: (fn: LLMPostLogger) => void }).setPostLogger?.(
        (record: LLMPostLogRecord) => {
          try {
            const sessionId = record.session_id || "unknown";
            const entry = requestContextMap.get(sessionId);
            const requestCtx = entry?.ctx;

            // 1. 上下文补全（source/trace_id/agent_name）
            if (requestCtx?.source) record.source = record.source || requestCtx.source;
            if (requestCtx?.traceId) record.trace_id = record.trace_id || requestCtx.traceId;
            if (requestCtx?.agentName) record.agent_name = record.agent_name || requestCtx.agentName;

            // 2. 落盘标准化 llm.post（向后兼容 /post-logs API）
            sessionStore.appendRawEntry(sessionId, record);

            // 3. 落盘 type-based 条目（供前端 /rawdata/:round 调试面板消费）
            const round = typeof record.round === "number" ? record.round : undefined;
            const retry = typeof record.retry === "number" ? record.retry : undefined;
            const createdAt = record.created_at;

            // 3a. llm_request
            const requestBody = record.request?.body_full ?? record.request?.body_summary;
            sessionStore.appendRawEntry(sessionId, {
              type: "llm_request",
              round,
              retry,
              created_at: createdAt,
              data: {
                url: record.request?.url,
                method: record.request?.method,
                headers: record.request?.headers,
                ...(typeof requestBody === "string"
                  ? { body: requestBody }
                  : { body_compressed: requestBody }),
                model: record.model,
              },
            });

            // 3b. llm_response
            const responseData: Record<string, unknown> = {
              content: record.response?.raw_text ?? "",
              sse_events: record.response?.events ?? [],
              http_status: record.response?.http_status ?? null,
              content_type: record.response?.content_type,
              is_stream_reassembled: record.response?.is_stream_reassembled ?? false,
              usage: record.usage ?? null,
              tool_calls: record.tool_calls_summary ?? [],
            };
            if (record.response?.payload_compressed) {
              responseData.payload_compressed = record.response.payload_compressed;
            }
            sessionStore.appendRawEntry(sessionId, {
              type: "llm_response",
              round,
              retry,
              created_at: createdAt,
              data: responseData,
            });

            this.appLogger.info({
              event: "llm.post",
              session_id: sessionId,
              trace_id: record.trace_id,
              source: record.source,
              model: record.model,
              round: record.round,
              retry: record.retry,
              duration_ms: record.duration_ms,
              error: record.error,
            }, "llm post log recorded");
          } catch {
            // 写日志失败不应影响主流程
          }
        },
      );

      // 创建 ModelCaller 用于 LLM 调用
      const caller = new ModelCaller({
        client: this.llmClient,
        emitEvent: (type, data) => ({ type, data }),
        emitLog: (level, message) => ({ type: "log", data: { level, message } }),
        maxRetries: 3,
        loopThreshold: 10,
        toolRegistry: this.toolRegistry,
      });

      // 创建 ToolExecutor
      const toolExecutor = new ToolExecutor(this.toolRegistry);

      this.agentRuntime = new AgentRuntime({
        compiler,
        sessions: this.sessionStore,
        tools: this.toolRegistry,
        toolExecutor,
        callModel: (params) => caller.callStream({
          sessionId: params.sessionId ?? "",
          roundIndex: params.round ?? 0,
          preset: params.preset,
          messages: params.messages as Record<string, string>[],
          autoFormat: params.autoFormat ?? true,
          jsonSettings: params.jsonSettings ?? null,
          stream: params.stream,
          toolSchemas: params.toolSchemas,
          nativeToolCalling: params.nativeToolCalling,
          abortSignal: params.abortSignal,
        }),
        log: (level, msg) => console[level === "error" ? "error" : "log"](`[Runtime] ${msg}`),
        maouRoot: this.maouRoot,
      });
    }
    return this.agentRuntime;
  }

  /** 运行 agent 循环 */
  async *run(params: {
    sessionId?: string;
    userMessage: string;
    preset: Record<string, unknown>;
    autoFormat?: boolean;
    agentMode?: boolean;
    sandboxMode?: string;
    stream?: boolean;
    initAgentName?: string;
    images?: unknown[];
    userPostData?: unknown;
    userName?: string;
    abortSignal?: AbortSignal;
    platformContext?: string;
    source?: string;
    traceId?: string;
  }): AsyncGenerator<StreamEvent> {
    const preset = params.preset as unknown as APIPreset;
    const sessionKey = params.sessionId || "unknown";

    // 引用计数：同一 session 并发 run 时各自持有一份引用，避免互相覆盖。
    const existing = this.lastRequestContext.get(sessionKey);
    if (existing) {
      existing.refCount++;
      existing.ctx = {
        source: params.source,
        traceId: params.traceId,
        agentName: params.initAgentName,
      };
    } else {
      this.lastRequestContext.set(sessionKey, {
        ctx: {
          source: params.source,
          traceId: params.traceId,
          agentName: params.initAgentName,
        },
        refCount: 1,
      });
    }

    try {
      yield* this.getRuntime().run(params.sessionId ?? null, params.userMessage, {
        preset,
        autoFormat: params.autoFormat,
        agentMode: params.agentMode,
        sandboxMode: params.sandboxMode,
        stream: params.stream,
        initAgentName: params.initAgentName,
        userName: params.userName,
        abortSignal: params.abortSignal,
        platformContext: params.platformContext,
      });
    } finally {
      // 引用计数 -1，归零时才删除，避免并发 run 互相误删
      const entry = this.lastRequestContext.get(sessionKey);
      if (entry) {
        entry.refCount--;
        if (entry.refCount <= 0) {
          this.lastRequestContext.delete(sessionKey);
        }
      }
    }
  }

  /** 刷新编译和缓存 */
  refresh(): Record<string, unknown> {
    this.agentRuntime = null;
    this.configStore.reload();
    return { ok: true, message: "已刷新" };
  }

  /** 列出所有 agent */
  async listAgents(): Promise<Record<string, unknown>[]> {
    try {
      const { AgentRegistry } = await import("./registry.js");
      const registry = new AgentRegistry(this.maouRoot, this.projectRoot);
      return registry.list();
    } catch {
      return [];
    }
  }

  /** 初始化新 agent */
  async initAgent(name: string): Promise<Record<string, unknown>> {
    try {
      const { initMainAgent } = await import("./registry.js");
      initMainAgent(this.maouRoot);
      return { ok: true, name };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  /** 获取 Agent 工厂预设 */
  async getAgentFactoryPresets(): Promise<Record<string, unknown>> {
    try {
      const { AgentFactory } = await import("./factory.js");
      const factory = new AgentFactory(this.maouRoot, process.cwd());
      return { presets: factory.listPresets() };
    } catch {
      return { presets: [] };
    }
  }

  /** 预览 agent 配置 */
  previewAgent(data: Record<string, unknown>): Record<string, unknown> {
    return { name: data.name, role: data.role, preview: true };
  }

  /** 创建 agent */
  createAgent(data: Record<string, unknown>): Record<string, unknown> {
    return { ok: true, ...data };
  }
}
