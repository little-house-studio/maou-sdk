/**
 * LLM HTTP 客户端 —— 使用 Node.js 内置 fetch 进行 API 调用
 * 对应 Python: core/llm/client.py
 */

import type {
  ProtocolAdapter,
  APIPreset,
  APIProtocol,
  ModelResponse,
  ModelDelta,
  LLMUsage,
  LLMToolCall,
} from "./adapters/types.js";
import {
  normalizeApiProtocol,
  completeApiUrl,
} from "./adapters/types.js";
import { ProtocolGateway } from "./adapters/router.js";
import { resolveCloudflareUrl } from "./adapters/cloudflare.js";
import { takeFauxResponse } from "./faux.js";
import { detectContextOverflow } from "./overflow.js";
import { normalizePostLogRecord, type NormalizePostLogOptions } from "./post-logger.js";
// 拆分后的职责模块（模块内部，不进 index.ts 导出）
import { extractUsageFromEvent } from "./usage-extractor.js";
import { applyAuthOverrides, sanitizeHeaders, isSensitiveHeader } from "./auth-overrides.js";
import { buildBedrockUrl, buildAzureUrl, buildVertexUrl } from "./url-builder.js";
import { readBedrockEventStream } from "./bedrock-stream.js";
import { waitForNetwork, NETWORK_PROBE_TIMEOUT_VALUE } from "./network-probe.js";
import { parseSSEStream } from "./sse-reader.js";
// 注意：@smithy/core/event-streams 已随 bedrock-stream.ts 拆出（动态 import 在那里），
// 不把它带进浏览器静态依赖图。
export { ProtocolGateway };
const MAX_RETRIES = 10;
/** 基础重试延迟 (ms) —— 设计要求 10s 一周期（指数退避以此起步，封顶 30s） */
const BASE_RETRY_DELAY = 10_000;

/** Bedrock 二进制事件流的 content-type */
const BEDROCK_EVENTSTREAM_CONTENT_TYPE = "application/vnd.amazon.eventstream";

/** LLM 调用日志条目 —— 每次 HTTP 调用自动生成 */
export interface LLMCallLogEntry {
  /** 请求发给 LLM 的完整内容 */
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: unknown;
  };
  /** LLM 返回的完整内容 */
  response: {
    /** 流式时将所有 SSE 事件拼接为完整文本 */
    raw_text: string;
    /** 单条事件内容（非流式时与 raw_text 相同） */
    events: string[];
    content_type: string;
    http_status: number | null;
    /** 若为 true，raw_text 为拼接后的流式事件文本 */
    is_stream_reassembled: boolean;
  };
  /** 调用耗时（毫秒） */
  duration_ms: number;
  /** 时间戳 */
  timestamp: string;
  /** 错误信息（如果有） */
  error: string | null;
  /** 调用上下文（由调用方传入） */
  context: Record<string, unknown>;
  /** token 用量（从 LLM 响应中提取） */
  usage?: Record<string, unknown> | null;
  /** 拼接后的完整工具调用（流式 SSE 分片合并） */
  assembled_tool_calls?: Array<{ name: string; parameters: Record<string, unknown>; id: string }>;
}

/** LLM 层日志记录器回调（兼容旧接口） */
export type LLMLogger = (entry: LLMCallLogEntry) => void;

/** LLM POST 标准化日志记录器回调 */
export type LLMPostLogger = (record: import("./post-logger.js").LLMPostLogRecord) => void;

// extractUsageFromEvent 已拆到 usage-extractor.ts（顶部 import）


export interface LLMClientOptions {
  /** 兼容旧回调：自动记录每次 LLM 调用的原始请求/响应 */
  logger?: LLMLogger;
  /** 新增：标准化 POST 日志回调 */
  postLogger?: LLMPostLogger;
  /** POST 日志归一化选项（body 截断长度 / 是否存全量 body），由调用方决定 */
  postLogOptions?: NormalizePostLogOptions;
  /**
   * 注入自定义 fetch 实现（默认用全局 fetch）。
   * 可用于：挂代理 dispatcher、浏览器/边缘环境的 fetch、测试打桩、加埋点等。
   */
  fetchImpl?: typeof fetch;
  /**
   * 发送前拦截：可读取/修改最终的 url / headers / body。
   * 返回对象里的字段会覆盖对应值（在签名前生效，因此对需签名的协议也安全）。
   */
  onPayload?: (ctx: PayloadHookContext) => void | PayloadHookOverride;
  /** 收到响应后拦截（只读，用于埋点/审计；不改响应体） */
  onResponse?: (ctx: ResponseHookContext) => void;
  /** 重试策略配置（覆盖默认指数退避）：次数/退避基数/上限/抖动/可重试状态码 */
  retry?: RetryPolicy;
  /**
   * 自定义错误处理钩子：每次出错调用，返回决策 retry/fail/{delayMs}。
   * 可降级错误、加熔断、上报、自定义重试节奏。
   */
  onError?: (ctx: ErrorHookContext) => "retry" | "fail" | { delayMs: number };
  /**
   * 流式响应 stall 超时（ms）：服务器中途停滞、长时间无新数据超过此值则中止读取并抛错（交由上层重试），
   * 避免请求无限挂起。默认 120000；设为 <=0 关闭。
   */
  streamStallMs?: number;
  /**
   * 连接/响应超时（ms）：fetch 连接阶段卡死（拿到响应头前长时间无响应）超过此值则中止本次尝试并重试。
   * 与 streamStallMs 互补（前者守连接，后者守流式 body）。默认 60000；设为 <=0 关闭。
   */
  connectTimeoutMs?: number;
}

/** 重试策略 */
export interface RetryPolicy {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: number;
  retryableStatuses?: number[];
}

/** onError 钩子上下文 */
export interface ErrorHookContext {
  attempt: number;
  error: Error | { status: number; body: string };
  category: "network" | "timeout" | "rate_limit" | "auth" | "bad_request" | "server_error" | "context_overflow" | "unknown";
  waitedMs: number;
  abortSignal?: AbortSignal;
}

/** onPayload 上下文 */
export interface PayloadHookContext {
  url: string;
  headers: Record<string, string>;
  body: string;
  preset: APIPreset;
  protocol: APIProtocol;
  stream: boolean;
}

/** onPayload 可返回的覆盖值 */
export interface PayloadHookOverride {
  url?: string;
  headers?: Record<string, string>;
  body?: string;
}

/** onResponse 上下文 */
export interface ResponseHookContext {
  url: string;
  status: number;
  headers: Record<string, string>;
  preset: APIPreset;
  protocol: APIProtocol;
  stream: boolean;
}

/**
 * LLM HTTP 客户端
 * 对应 Python: OpenAICompatibleClient
 */
export class LLMClient {
  private _gateway = new ProtocolGateway();
  private _logger: LLMLogger | null;
  private _postLogger: LLMPostLogger | null;
  private _postLogOptions: NormalizePostLogOptions;
  private _fetch: typeof fetch;
  private _onPayload: LLMClientOptions["onPayload"] | null;
  private _onResponse: LLMClientOptions["onResponse"] | null;
  private _retry: Required<RetryPolicy>;
  private _onError: LLMClientOptions["onError"] | null;
  private _streamStallMs: number;
  private _connectTimeoutMs: number;

  constructor(options?: LLMClientOptions) {
    this._logger = options?.logger ?? null;
    this._postLogger = options?.postLogger ?? null;
    this._postLogOptions = options?.postLogOptions ?? {};
    this._fetch = options?.fetchImpl ?? fetch;
    this._onPayload = options?.onPayload ?? null;
    this._onResponse = options?.onResponse ?? null;
    this._retry = {
      maxRetries: options?.retry?.maxRetries ?? MAX_RETRIES,
      baseDelayMs: options?.retry?.baseDelayMs ?? BASE_RETRY_DELAY,
      maxDelayMs: options?.retry?.maxDelayMs ?? 30_000,
      jitter: options?.retry?.jitter ?? 0.2,
      retryableStatuses: options?.retry?.retryableStatuses ?? [429, 500, 502, 503, 504],
    };
    this._onError = options?.onError ?? null;
    this._streamStallMs = options?.streamStallMs ?? 30_000;
    this._connectTimeoutMs = options?.connectTimeoutMs ?? 60_000;
  }

  // _readChunk 已随 sse-reader.ts 拆出（parseSSEStream 内部的 readChunk，带 stall 超时）。

  /** 运行时注入日志记录器（用于延迟初始化） */
  setLogger(logger: LLMLogger): void {
    this._logger = logger;
  }

  /** 运行时注入标准化 POST 日志记录器 */
  setPostLogger(logger: LLMPostLogger): void {
    this._postLogger = logger;
  }

  /** 运行时配置 POST 日志归一化选项（body 截断长度 / 是否存全量 body） */
  setPostLogOptions(options: NormalizePostLogOptions): void {
    this._postLogOptions = options;
  }

  private _protocol(preset: APIPreset): APIProtocol {
    return normalizeApiProtocol(preset.protocol);
  }

  private _adapterFor(preset: APIPreset): ProtocolAdapter {
    return this._gateway.resolve(this._protocol(preset));
  }

  /**
   * 构建请求
   * 对于需要签名的协议（如 Bedrock），会异步调用 adapter.signRequest
   */
  private async _buildRequest(params: {
    preset: APIPreset;
    messages: Record<string, unknown>[];
    stream: boolean;
    jsonSettings?: Record<string, unknown> | null;
    toolSchemas?: Record<string, unknown>[] | null;
    nativeToolCalling?: boolean;
  }): Promise<{ url: string; headers: Record<string, string>; body: string; rawPayload: Record<string, unknown> }> {
    const { preset, messages, stream, jsonSettings, toolSchemas, nativeToolCalling } = params;
    const protocol = this._protocol(preset);
    const adapter = this._adapterFor(preset);

    // 构建请求 URL
    // 不同协议的 URL 规则不同：
    //   bedrock     → converse / converse-stream 端点（含 modelId）
    //   azure       → {endpoint}/openai/deployments/{deployment}/chat/completions?api-version=...
    //   cloudflare  → 先替换 {CLOUDFLARE_ACCOUNT_ID} 占位符，再补全 OpenAI 兼容路径
    //   其余        → completeApiUrl 按协议补全
    let url: string;
    if (protocol === "bedrock") {
      url = buildBedrockUrl(preset, stream);
    } else if (protocol === "azure") {
      url = buildAzureUrl(preset);
    } else if (protocol === "google-vertex") {
      url = buildVertexUrl(preset, stream);
    } else if (protocol === "cloudflare") {
      url = completeApiUrl(resolveCloudflareUrl(preset.url ?? "", preset), protocol);
    } else {
      url = completeApiUrl(preset.url ?? "", protocol);
    }

    let headers = adapter.buildRequestHeaders(preset);

    // OAuth / 自定义头覆盖（订阅登录场景：按厂商调整认证头）
    headers = applyAuthOverrides(headers, preset, protocol);

    const payload = adapter.buildRequestPayload({
      preset,
      messages,
      stream,
      toolSchemas: toolSchemas ?? null,
      jsonSettings: jsonSettings ?? null,
      nativeToolCalling: nativeToolCalling ?? false,
    });

    // 合并 extraBody（用于厂商特有参数，如小米的 thinking: { type: "disabled" }）
    // extraBody 优先级高于 reasoning_params，直接覆盖同名字段
    if (preset.extraBody && typeof preset.extraBody === "object") {
      for (const [key, value] of Object.entries(preset.extraBody)) {
        payload[key] = value;
      }
    }

    let body = JSON.stringify(payload);

    // onPayload 拦截：允许调用方在签名前改写 url / headers / body
    if (this._onPayload) {
      const override = this._onPayload({ url, headers, body, preset, protocol, stream });
      if (override) {
        if (typeof override.url === "string") url = override.url;
        if (override.headers) headers = override.headers;
        if (typeof override.body === "string") body = override.body;
      }
    }

    // 如果适配器实现了 signRequest（如 Bedrock 的 SigV4 签名），则对请求进行签名
    if (adapter.signRequest) {
      headers = await adapter.signRequest(url, headers, body, preset);
    }

    const rawPayload = {
      ...payload,
      _url: url,
      _headers: Object.fromEntries(
        Object.entries(headers).filter(([k]) => !isSensitiveHeader(k)),
      ),
    };

    return { url, headers, body, rawPayload };
  }

  // _buildBedrockUrl / _buildAzureUrl / _buildVertexUrl 已拆到 url-builder.ts
  // （buildBedrockUrl / buildAzureUrl / buildVertexUrl），_buildRequest 里按 protocol 分发调用。


  /**
   * 把 faux（mock）响应组装成标准 ModelResponse，并触发日志。
   * 供 chat / chatStream 在 protocol === "faux" 时短路使用，不发起真实 HTTP。
   */
  private _fauxModelResponse(
    faux: import("./faux.js").FauxResponse,
    rawPayload: Record<string, unknown>,
    url: string,
    headers: Record<string, string>,
    startedAt: number,
    logContext?: Record<string, unknown>,
  ): ModelResponse {
    const content = faux.content ?? "";
    const reasoningContent = faux.reasoningContent;
    const toolCalls = faux.toolCalls ?? [];
    const usage = faux.usage ?? null;
    const finishReason = faux.finishReason ?? (toolCalls.length ? "tool_calls" : "stop");

    if (this._logger || this._postLogger) {
      this._emitLog(
        url, headers, rawPayload, [JSON.stringify(faux)],
        content, "application/json", 200, startedAt, null, logContext, toolCalls, usage,
      );
    }

    const totalMs = Math.max(0, Date.now() - startedAt);
    return {
      content,
      reasoningContent: reasoningContent || undefined,
      rawEvents: [JSON.stringify(faux)],
      contentType: "application/json",
      finishReason,
      httpStatus: 200,
      rawEventCount: 1,
      reasoningFallbackUsed: !!reasoningContent,
      firstOutputSeconds: 0,
      firstOutputMs: 0,
      requestId: null,
      protocol: "faux",
      toolCalls,
      usage,
      rawPayload,
      timing: { firstByteMs: 0, generationMs: totalMs, totalMs },
    };
  }

  /** 触发 onResponse 钩子（只读，失败不影响主流程） */
  private _emitResponseHook(
    url: string,
    response: Response,
    preset: APIPreset,
    protocol: APIProtocol,
    stream: boolean,
  ): void {
    if (!this._onResponse) return;
    try {
      this._onResponse({
        url,
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        preset,
        protocol,
        stream,
      });
    } catch {
      /* 钩子异常不影响主流程 */
    }
  }

  /**
   * 流式调用 —— POST 请求，返回异步迭代器产出 ModelDelta
   * 对应 Python: chat_stream
   *
   * 每次调用自动触发 logger（如果已配置），包括错误情况。
   */
  async *chatStream(params: {
    preset: APIPreset;
    messages: Record<string, unknown>[];
    jsonSettings?: Record<string, unknown> | null;
    toolSchemas?: Record<string, unknown>[] | null;
    nativeToolCalling?: boolean;
    /** 日志上下文（sessionId, round 等），透传到 logger */
    _logContext?: Record<string, unknown>;
    /** 中断信号 —— 收到时中止底层 fetch 和流读取 */
    abortSignal?: AbortSignal;
  }): AsyncGenerator<ModelDelta, ModelResponse> {
    const { preset, messages, jsonSettings, toolSchemas, nativeToolCalling, _logContext, abortSignal } = params;
    const protocol = this._protocol(preset);
    const adapter = this._adapterFor(preset);
    const { url, headers, body, rawPayload } = await this._buildRequest({
      preset,
      messages,
      stream: true,
      jsonSettings,
      toolSchemas,
      nativeToolCalling,
    });

    const startedAt = Date.now();

    // faux（mock）短路：不发起真实 HTTP，按 chunk 吐出预设响应
    if (protocol === "faux") {
      const faux = takeFauxResponse(preset, messages);
      if (faux) {
        if (faux.reasoningContent) {
          yield { delta: "", thinking: faux.reasoningContent, rawEvent: null, finishReason: null };
        }
        const text = faux.content ?? "";
        // 按词切片模拟流式
        const chunks = text.length > 0 ? text.match(/\s*\S+|\s+/g) ?? [text] : [];
        const emitted: string[] = [];
        for (const chunk of chunks) {
          if (abortSignal?.aborted) {
            // abort 时返回部分内容（与真实流式分支语义一致）
            const partial = emitted.join("");
            const totalMs = Math.max(0, Date.now() - startedAt);
            const usage = faux.usage ?? null;
            const finishReason = "aborted";
            if (this._logger || this._postLogger) {
              this._emitLog(url, headers, rawPayload, [JSON.stringify(faux)], partial, "application/json", 200, startedAt, `aborted (partial ${partial.length} chars)`, _logContext, [], usage);
            }
            return {
              content: partial,
              rawEvents: [JSON.stringify(faux)],
              contentType: "application/json",
              finishReason,
              httpStatus: 200,
              rawEventCount: 1,
              reasoningFallbackUsed: !!faux.reasoningContent,
              firstOutputSeconds: 0,
              firstOutputMs: 0,
              requestId: null,
              protocol: "faux",
              toolCalls: [],
              usage,
              rawPayload,
              timing: { firstByteMs: 0, generationMs: totalMs, totalMs },
              partial,
              aborted: true,
            };
          }
          emitted.push(chunk);
          yield { delta: chunk, rawEvent: null, finishReason: null };
        }
        return this._fauxModelResponse(faux, rawPayload, url, headers, startedAt, _logContext);
      }
    }

    let response: Response;
    try {
      response = await this._fetchWithRetry(url, headers, body, MAX_RETRIES, abortSignal);
    } catch (err) {
      // 请求失败（网络错误/429 耗尽重试/abort）— 仍然记录
      if (this._logger || this._postLogger) {
        this._emitLog(url, headers, rawPayload, [], "", null, null, startedAt, String(err), _logContext);
      }
      throw err;
    }

    const contentType = response.headers.get("content-type") ?? "";
    const httpStatus = response.status;
    const requestId = response.headers.get("x-request-id") ?? response.headers.get("request-id");
    this._emitResponseHook(url, response, preset, protocol, true);
    let responseBody = "";
    let reasoningContent = "";
    const rawEvents: string[] = [];
    let finishReason: string | null = null;
    let toolCalls: LLMToolCall[] = [];
    const toolChunks = new Map<number, { id: string; name: string; arguments: string }>();
    let reasoningFallbackUsed = false;
    let firstOutputSeconds: number | null = null;
    let firstOutputMs: number | null = null;
    let accumulatedUsage: LLMUsage | null = null;

    if (contentType.includes("text/event-stream") && response.body) {
      try {
        // SSE 解析已拆到 sse-reader.ts（parseSSEStream）。
        // parseSSEStream 只解析+yield 事件+释放 reader；累积状态由本方法维护，
        // 这样 abort 异常时本 catch 能拿到已累积的部分结果（组装 partial ModelResponse）。
        const sseGen = parseSSEStream({
          reader: response.body.getReader(),
          adapter,
          preset,
          protocol,
          stallMs: this._streamStallMs,
          toolChunks,
        });
        for await (const ev of sseGen) {
          rawEvents.push(ev.rawEvent);
          if (ev.done) {
            if (!finishReason) finishReason = "stop";
            continue;
          }
          if (ev.delta) responseBody += ev.delta;
          if (ev.thinking) reasoningContent += ev.thinking;
          if (ev.finishReason) finishReason = ev.finishReason;
          // usedReasoning 由 adapter.parseStreamEvent 内部决定，parseSSEStream 未透传；
          // 通过 finishReason/thinking 间接判断不够准确——但原实现 usedReasoning 仅用于日志字段，
          // 这里若 adapter 标了 usedReasoning，event 会有 thinking，故用 thinking 非空近似。
          if (ev.thinking) reasoningFallbackUsed = true;
          if ((ev.delta || ev.thinking) && firstOutputMs === null) {
            firstOutputMs = Date.now() - startedAt;
            firstOutputSeconds = Math.round(firstOutputMs / 1000);
          }
          if (ev.delta || ev.thinking || ev.finishReason) {
            yield {
              delta: ev.delta,
              thinking: ev.thinking,
              rawEvent: ev.rawEvent,
              finishReason: ev.finishReason,
            };
          }
          if (ev.usage) {
            if (!accumulatedUsage) accumulatedUsage = {};
            Object.assign(accumulatedUsage, ev.usage);
          }
        }
      } catch (streamErr) {
        // 流读取异常（abort / 网络中断）—— 若已累积部分内容，补记一条日志
        const isAbort = abortSignal?.aborted || (streamErr instanceof DOMException && streamErr.name === "AbortError");
        if (this._logger || this._postLogger) {
          this._emitLog(
            url, headers, rawPayload, rawEvents,
            responseBody, contentType, httpStatus,
            startedAt,
            isAbort ? `aborted (partial ${responseBody.length} chars)` : String(streamErr),
            _logContext, toolCalls, accumulatedUsage,
          );
        }
        // abort 时不再 throw：返回带 partial 的 ModelResponse，让上层保留已生成内容
        if (isAbort) {
          if (toolCalls.length === 0 && toolChunks.size > 0) {
            try { toolCalls = adapter.collectToolCalls(toolChunks); } catch { /* 部分工具调用可能不完整 */ }
          }
          const finishedAt = Date.now();
          const totalMs = finishedAt - startedAt;
          const firstByteMs = firstOutputMs !== null ? firstOutputMs : totalMs;
          const generationMs = totalMs - firstByteMs;
          return {
            content: responseBody,
            reasoningContent: reasoningContent || undefined,
            rawEvents,
            contentType,
            finishReason: "aborted",
            httpStatus,
            rawEventCount: rawEvents.length,
            reasoningFallbackUsed,
            firstOutputSeconds,
            firstOutputMs,
            requestId,
            protocol,
            toolCalls,
            usage: accumulatedUsage,
            rawPayload,
            timing: { firstByteMs, generationMs, totalMs },
            partial: responseBody,
            aborted: true,
          };
        }
        throw streamErr;
      }
      // reader 释放由 parseSSEStream 内部 finally 负责，这里不再需要 finally
    } else if (contentType.includes(BEDROCK_EVENTSTREAM_CONTENT_TYPE) && response.body) {
      // Bedrock 二进制事件流解析
      try {
        for await (const { data: bedrockData, rawText } of readBedrockEventStream(response.body)) {
          rawEvents.push(rawText);
          const event = adapter.parseStreamEvent(bedrockData, toolChunks);
          if ((event.delta || event.thinking) && firstOutputMs === null) {
            firstOutputMs = Date.now() - startedAt;
            firstOutputSeconds = Math.round(firstOutputMs / 1000);
          }
          responseBody += event.delta;
          if (event.thinking) reasoningContent += event.thinking;
          if (event.finishReason) finishReason = event.finishReason;
          if (event.usedReasoning) reasoningFallbackUsed = true;

          if (event.delta || event.thinking || event.finishReason) {
            yield {
              delta: event.delta,
              thinking: event.thinking,
              rawEvent: rawText,
              finishReason: event.finishReason,
            };
          }

          const usage = extractUsageFromEvent(bedrockData, protocol);
          if (usage) {
            if (!accumulatedUsage) accumulatedUsage = {};
            Object.assign(accumulatedUsage, usage);
          }
        }
      } catch (streamErr) {
        const isAbort = abortSignal?.aborted || (streamErr instanceof DOMException && streamErr.name === "AbortError");
        if (this._logger || this._postLogger) {
          this._emitLog(
            url, headers, rawPayload, rawEvents,
            responseBody, contentType, httpStatus,
            startedAt,
            isAbort ? `aborted (partial ${responseBody.length} chars)` : String(streamErr),
            _logContext, toolCalls, accumulatedUsage,
          );
        }
        // abort 时不再 throw：返回带 partial 的 ModelResponse（与 SSE 分支一致）
        if (isAbort) {
          const finishedAt = Date.now();
          const totalMs = finishedAt - startedAt;
          const firstByteMs = firstOutputMs !== null ? firstOutputMs : totalMs;
          const generationMs = totalMs - firstByteMs;
          return {
            content: responseBody,
            reasoningContent: reasoningContent || undefined,
            rawEvents,
            contentType,
            finishReason: "aborted",
            httpStatus,
            rawEventCount: rawEvents.length,
            reasoningFallbackUsed,
            firstOutputSeconds,
            firstOutputMs,
            requestId,
            protocol,
            toolCalls,
            usage: accumulatedUsage,
            rawPayload,
            timing: { firstByteMs, generationMs, totalMs },
            partial: responseBody,
            aborted: true,
          };
        }
        throw streamErr;
      }
    } else {
      const text = await response.text();
      rawEvents.push(text);
      const data = JSON.parse(text);
      const parsed = adapter.parseNonstreamResponse(data, preset);
      responseBody = parsed.content;
      reasoningContent = parsed.reasoningContent ?? "";
      toolCalls = parsed.toolCalls;
      finishReason = parsed.finishReason;
      reasoningFallbackUsed = parsed.usedReasoning;
      if (responseBody || toolCalls.length > 0) {
        firstOutputMs = Date.now() - startedAt;
        firstOutputSeconds = Math.round(firstOutputMs / 1000);
      }
      accumulatedUsage = data.usage as LLMUsage | null;
      yield {
        delta: responseBody,
        thinking: reasoningContent || undefined,
        rawEvent: text,
        finishReason,
      };
    }

    if (toolCalls.length === 0 && toolChunks.size > 0) {
      toolCalls = adapter.collectToolCalls(toolChunks);
    }

    // 流式调用完成 — 记录原始数据（将所有 SSE 事件拼接为完整文本）
    if (this._logger || this._postLogger) {
      this._emitLog(url, headers, rawPayload, rawEvents, responseBody, contentType, httpStatus, startedAt, null, _logContext, toolCalls, accumulatedUsage);
    }

    const finishedAt = Date.now();
    const totalMs = finishedAt - startedAt;
    const firstByteMs = firstOutputMs !== null ? firstOutputMs : totalMs;
    const generationMs = totalMs - firstByteMs;

    return {
      content: responseBody,
      reasoningContent: reasoningContent || undefined,
      rawEvents,
      contentType,
      finishReason,
      httpStatus,
      rawEventCount: rawEvents.length,
      reasoningFallbackUsed,
      firstOutputSeconds,
      firstOutputMs,
      requestId,
      protocol,
      toolCalls,
      usage: accumulatedUsage,
      rawPayload,
      timing: {
        firstByteMs,
        generationMs,
        totalMs,
      },
    };
  }

  /**
   * 非流式调用 —— POST 请求，返回完整响应
   * 对应 Python: chat
   *
   * 每次调用自动触发 logger（如果已配置），包括错误情况。
   */
  async chat(params: {
    preset: APIPreset;
    messages: Record<string, unknown>[];
    jsonSettings?: Record<string, unknown> | null;
    toolSchemas?: Record<string, unknown>[] | null;
    nativeToolCalling?: boolean;
    /** 日志上下文（sessionId, round 等），透传到 logger */
    _logContext?: Record<string, unknown>;
    /** 中断信号 —— 收到时中止底层 fetch */
    abortSignal?: AbortSignal;
  }): Promise<ModelResponse> {
    const { preset, messages, jsonSettings, toolSchemas, nativeToolCalling, _logContext, abortSignal } = params;
    const protocol = this._protocol(preset);
    const adapter = this._adapterFor(preset);
    const { url, headers, body, rawPayload } = await this._buildRequest({
      preset,
      messages,
      stream: false,
      jsonSettings,
      toolSchemas,
      nativeToolCalling,
    });

    const startedAt = Date.now();

    // faux（mock）短路：直接返回预设响应，不发起真实 HTTP
    if (protocol === "faux") {
      const faux = takeFauxResponse(preset, messages);
      if (faux) {
        return this._fauxModelResponse(faux, rawPayload, url, headers, startedAt, _logContext);
      }
    }

    let response: Response;
    try {
      response = await this._fetchWithRetry(url, headers, body, MAX_RETRIES, abortSignal);
    } catch (err) {
      if (this._logger || this._postLogger) {
        this._emitLog(url, headers, rawPayload, [], "", null, null, startedAt, String(err), _logContext);
      }
      throw err;
    }

    const contentType = response.headers.get("content-type") ?? "";
    const httpStatus = response.status;
    const requestId = response.headers.get("x-request-id") ?? response.headers.get("request-id");
    this._emitResponseHook(url, response, preset, protocol, false);
    const rawEvents: string[] = [];
    let responseBody = "";
    let reasoningContent = "";
    let finishReason: string | null = null;
    let toolCalls: LLMToolCall[] = [];
    let reasoningFallbackUsed = false;
    let firstOutputSeconds: number | null = null;
    let firstOutputMs: number | null = null;
    let accumulatedUsage: LLMUsage | null = null;

    if (contentType.includes("text/event-stream") && response.body) {
      const toolChunks = new Map<number, { id: string; name: string; arguments: string }>();
      // SSE 解析已拆到 sse-reader.ts（parseSSEStream）。chat 不 yield，只累积。
      // parseSSEStream 内部 finally 释放 reader，故无需本方法的 finally。
      const sseGen = parseSSEStream({
        reader: response.body.getReader(),
        adapter,
        preset,
        protocol,
        stallMs: this._streamStallMs,
        toolChunks,
      });
      for await (const ev of sseGen) {
        rawEvents.push(ev.rawEvent);
        if (ev.done) {
          if (!finishReason) finishReason = "stop";
          continue;
        }
        if (ev.delta) responseBody += ev.delta;
        if (ev.thinking) reasoningContent += ev.thinking;
        if (ev.finishReason) finishReason = ev.finishReason;
        if (ev.thinking) reasoningFallbackUsed = true;
        if ((ev.delta || ev.thinking) && firstOutputMs === null) {
          firstOutputMs = Date.now() - startedAt;
          firstOutputSeconds = Math.round(firstOutputMs / 1000);
        }
        if (ev.usage) {
          if (!accumulatedUsage) accumulatedUsage = {};
          Object.assign(accumulatedUsage, ev.usage);
        }
      }

      if (toolCalls.length === 0 && toolChunks.size > 0) {
        toolCalls = adapter.collectToolCalls(toolChunks);
      }
    } else if (contentType.includes(BEDROCK_EVENTSTREAM_CONTENT_TYPE) && response.body) {
      // Bedrock 二进制事件流解析（非流式调用 chat() 也可能收到事件流响应）
      const toolChunks = new Map<number, { id: string; name: string; arguments: string }>();
      try {
        for await (const { data: bedrockData, rawText } of readBedrockEventStream(response.body)) {
          rawEvents.push(rawText);
          const event = adapter.parseStreamEvent(bedrockData, toolChunks);
          if ((event.delta || event.thinking) && firstOutputMs === null) {
            firstOutputMs = Date.now() - startedAt;
            firstOutputSeconds = Math.round(firstOutputMs / 1000);
          }
          responseBody += event.delta;
          if (event.thinking) reasoningContent += event.thinking;
          if (event.finishReason) finishReason = event.finishReason;
          if (event.usedReasoning) reasoningFallbackUsed = true;

          const usage = extractUsageFromEvent(bedrockData, protocol);
          if (usage) {
            if (!accumulatedUsage) accumulatedUsage = {};
            Object.assign(accumulatedUsage, usage);
          }
        }
      } finally {
        // _readBedrockEventStream 内部已处理 reader 释放
      }

      if (toolCalls.length === 0 && toolChunks.size > 0) {
        toolCalls = adapter.collectToolCalls(toolChunks);
      }
    } else {
      const text = await response.text();
      rawEvents.push(text);
      const data = JSON.parse(text);
      const parsed = adapter.parseNonstreamResponse(data, preset);
      responseBody = parsed.content;
      reasoningContent = parsed.reasoningContent ?? "";
      toolCalls = parsed.toolCalls;
      finishReason = parsed.finishReason;
      reasoningFallbackUsed = parsed.usedReasoning;
      if (responseBody || toolCalls.length > 0) {
        firstOutputMs = Date.now() - startedAt;
        firstOutputSeconds = Math.round(firstOutputMs / 1000);
      }
      accumulatedUsage = (data.usage as LLMUsage) ?? null;
    }

    // 非流式调用完成 — 记录原始数据
    if (this._logger || this._postLogger) {
      this._emitLog(url, headers, rawPayload, rawEvents, responseBody, contentType, httpStatus, startedAt, null, _logContext, toolCalls, accumulatedUsage);
    }

    const finishedAt = Date.now();
    const totalMs = finishedAt - startedAt;
    const firstByteMs = firstOutputMs !== null ? firstOutputMs : totalMs;
    const generationMs = totalMs - firstByteMs;

    return {
      content: responseBody,
      reasoningContent: reasoningContent || undefined,
      rawEvents,
      contentType,
      finishReason,
      httpStatus,
      rawEventCount: rawEvents.length,
      reasoningFallbackUsed,
      firstOutputSeconds,
      firstOutputMs,
      requestId,
      protocol,
      toolCalls,
      usage: accumulatedUsage,
      rawPayload,
      timing: {
        firstByteMs,
        generationMs,
        totalMs,
      },
    };
  }

  /**
   * 构建日志条目并触发 logger 回调
   */
  private _emitLog(
    url: string,
    headers: Record<string, string>,
    rawPayload: Record<string, unknown>,
    rawEvents: string[],
    responseBody: string,
    contentType: string | null,
    httpStatus: number | null,
    startedAt: number,
    error: string | null,
    logContext?: Record<string, unknown>,
    assembledToolCalls?: LLMToolCall[],
    usage?: Record<string, unknown> | null,
  ): void {
    try {
      const safeHeaders = sanitizeHeaders(headers);

      const entry: LLMCallLogEntry = {
        request: {
          url,
          method: "POST",
          headers: safeHeaders,
          body: rawPayload,
        },
        response: {
          raw_text: responseBody,
          events: rawEvents,
          content_type: contentType ?? "",
          http_status: httpStatus,
          // 流式响应（content-type: text/event-stream）的 raw_text 是从多个 SSE delta 拼接而来；
          // 非流式响应则直接是响应 body。用 content-type 判定比单纯数 events 数量更可靠。
          is_stream_reassembled: !!contentType && contentType.includes("text/event-stream") && rawEvents.length > 1,
        },
        duration_ms: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
        error,
        context: logContext ?? {},
        usage: usage ?? null,
      };

      if (assembledToolCalls && assembledToolCalls.length > 0) {
        entry.assembled_tool_calls = assembledToolCalls.map(tc => ({
          name: tc.name,
          parameters: tc.parameters,
          id: tc.id,
        }));
      }

      if (this._logger) this._logger(entry);

      if (this._postLogger) {
        const normalized = normalizePostLogRecord(entry, logContext, this._postLogOptions);
        this._postLogger(normalized);
      }
    } catch {
      // logger 失败不应影响主流程
    }
  }

  // _readBedrockEventStream 已拆到 bedrock-stream.ts（readBedrockEventStream）。
  // chatStream/chat 的 Bedrock 分支直接调模块函数。

  /**
   * 计算第 attempt 次重试的等待 ms（指数退避 + 上限 + 抖动）。
   */
  private _computeBackoff(attempt: number): number {
    const { baseDelayMs, maxDelayMs, jitter } = this._retry;
    const exp = baseDelayMs * Math.pow(2, attempt);
    const capped = Math.min(exp, maxDelayMs);
    const j = jitter > 0 ? capped * jitter * (Math.random() * 2 - 1) : 0;
    return Math.max(0, Math.round(capped + j));
  }

  // _waitForNetwork 已拆到 network-probe.ts（waitForNetwork，接 fetchImpl 参数）。


  /** 判断某状态码/错误是否可重试（先按策略，再让 onError 覆盖） */
  private _decideRetry(ctx: ErrorHookContext): "retry" | "fail" | { delayMs: number } {
    if (this._onError) return this._onError(ctx);
    // 默认：retryableStatuses 命中或网络错误 → retry；其余 fail
    const e = ctx.error;
    if ("status" in e) {
      return this._retry.retryableStatuses.includes(e.status) ? "retry" : "fail";
    }
    return ctx.category === "network" || ctx.category === "timeout" ? "retry" : "fail";
  }

  /** 错误 → 分类（复用 post-logger 的分类逻辑） */
  private _categorize(err: Error | { status: number; body: string }): ErrorHookContext["category"] {
    if ("status" in err) {
      const s = err.status;
      if (s === 429) return "rate_limit";
      if (s === 401 || s === 403) return "auth";
      if (s === 413) return "context_overflow";
      if (s === 400 || s === 422) {
        return detectContextOverflow(err.body, s) ? "context_overflow" : "bad_request";
      }
      if (s >= 500) return "server_error";
      return "unknown";
    }
    const msg = err.message.toLowerCase();
    if (msg.includes("timeout") || msg.includes("timed out")) return "timeout";
    if (msg.includes("econnrefused") || msg.includes("enotfound") || msg.includes("fetch failed") || msg.includes("network")) return "network";
    return "unknown";
  }

  /**
   * 带指数退避和 429 限流处理的 fetch。
   * abortSignal 收到时立即抛出 AbortError，不重试。
   */
  private async _fetchWithRetry(
    url: string,
    headers: Record<string, string>,
    body: string,
    maxRetries = this._retry.maxRetries,
    abortSignal?: AbortSignal,
  ): Promise<Response> {
    let lastError: Error | null = null;
    const retryHistory: string[] = [];
    let waitedMs = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // 进入每次尝试前先检查中断信号
      if (abortSignal?.aborted) {
        throw new DOMException("The user aborted a request.", "AbortError");
      }

      try {
        // 连接/响应超时：fetch 连接阶段卡死（拿到响应头前长时间无响应）时主动中止本次尝试。
        // 与调用方 abortSignal 合并到 attemptCtrl；拿到 headers 后清除连接计时器——
        // 流式 body 的停滞由 _readChunk 的 stall 超时单独守护。
        const attemptCtrl = new AbortController();
        const onCallerAbort = () => attemptCtrl.abort();
        if (abortSignal) {
          if (abortSignal.aborted) attemptCtrl.abort();
          else abortSignal.addEventListener("abort", onCallerAbort, { once: true });
        }
        const connectTimer = this._connectTimeoutMs > 0
          ? setTimeout(
              () => attemptCtrl.abort(new Error(`连接/响应超时 ${this._connectTimeoutMs}ms（未收到响应头）`)),
              this._connectTimeoutMs,
            )
          : undefined;
        let response: Response;
        try {
          response = await this._fetch(url, {
            method: "POST",
            headers,
            body,
            signal: attemptCtrl.signal,
          });
        } finally {
          if (connectTimer) clearTimeout(connectTimer);
        }

        if (response.status === 429) {
          const retryAfter = response.headers.get("retry-after");
          const detail429 = await response.text().catch(() => "");
          // 统一走 _decideRetry（尊重 onError 钩子 + retryableStatuses）
          const decision = this._decideRetry({
            attempt, error: { status: 429, body: detail429 },
            category: "rate_limit", waitedMs, abortSignal,
          });
          retryHistory.push(`attempt ${attempt + 1}: 429 (decision ${decision}) ${detail429.slice(0, 200)}`);
          const waitMs = decision === "fail"
            ? 0
            : retryAfter && decision === "retry"
              ? parseInt(retryAfter, 10) * 1000
              : typeof decision === "object" ? decision.delayMs : this._computeBackoff(attempt);
          if (decision !== "fail" && attempt < maxRetries) {
            waitedMs += waitMs;
            await sleep(waitMs);
            continue;
          }
          throw new Error(`API Error 429: ${detail429}`);
        }

        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          const category = this._categorize({ status: response.status, body: detail });
          // 统一走 _decideRetry
          const decision = this._decideRetry({
            attempt, error: { status: response.status, body: detail },
            category, waitedMs, abortSignal,
          });
          retryHistory.push(`attempt ${attempt + 1}: HTTP ${response.status} [${category}] (decision ${decision}) ${detail.slice(0, 120)}`);
          if (decision !== "fail" && attempt < maxRetries) {
            const waitMs = typeof decision === "object" ? decision.delayMs : this._computeBackoff(attempt);
            waitedMs += waitMs;
            await sleep(waitMs);
            continue;
          }
          throw new Error(`API Error ${response.status}: ${detail}`);
        }

        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // abort 中断：立即抛出，不重试
        if (abortSignal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
          throw lastError;
        }

        // 如果是 HTTP 错误（已从 response text 解析），直接抛出
        if (lastError.message.startsWith("API Error")) {
          throw lastError;
        }

        // 网络错误，记录本次重试信息
        retryHistory.push(`attempt ${attempt + 1}: ${lastError.message.slice(0, 200)}`);

        // 网络错误，重试（设计要求：网络问题先 ping 网络恢复，而非盲目重试 LLM）
        if (attempt < maxRetries) {
          // 前 2 次可能是瞬时抖动，快速退避重试；持续失败（attempt>=2）才进入网络探测模式，
          // 避免网络实际畅通时浪费 3-5s 探测。
          if (attempt >= 2) {
            const recovered = await waitForNetwork(this._fetch);
            if (!recovered) {
              // 网络探测超时（>120s 仍不通）：放弃，抛出网络错误
              throw new Error(`网络持续不可达 ${NETWORK_PROBE_TIMEOUT_VALUE}ms，放弃重试: ${lastError.message}`);
            }
          }
          const waitMs = this._computeBackoff(attempt);
          await sleep(waitMs);
          continue;
        }
      }
    }

    // 所有重试耗尽 —— 把重试历史附加到错误信息，方便上层/日志回溯
    const retrySummary = retryHistory.length > 0 ? ` [retry history: ${retryHistory.join(" | ")}]` : "";
    const finalError = lastError ?? new Error("请求失败：已耗尽所有重试次数");
    if (retrySummary && !finalError.message.includes("retry history")) {
      finalError.message = finalError.message + retrySummary;
    }
    throw finalError;
  }
}

/** 等待指定毫秒 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// SENSITIVE_HEADERS / isSensitiveHeader / sanitizeHeaders / applyAuthOverrides
// 已拆到 auth-overrides.ts，顶部 import 引入。

