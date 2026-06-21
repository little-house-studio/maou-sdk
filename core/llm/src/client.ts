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
import { resolveAzureDeployment, resolveAzureApiVersion } from "./adapters/azure-openai.js";
import { resolveCloudflareUrl } from "./adapters/cloudflare.js";
import { takeFauxResponse } from "./faux.js";
import { normalizePostLogRecord, type NormalizePostLogOptions } from "./post-logger.js";
// 注意：@smithy/core/event-streams 仅 Bedrock 二进制流需要，改为动态 import（见 _readBedrockEventStream），
// 避免把它带进浏览器静态依赖图。
export { ProtocolGateway };
const MAX_RETRIES = 8;
/** 基础重试延迟 (ms) */
const BASE_RETRY_DELAY = 1000;

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

/** 从事件数据中提取 usage */
function extractUsageFromEvent(
  data: Record<string, unknown>,
  protocol: string,
): LLMUsage | null {
  if (data.usage && typeof data.usage === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data.usage as Record<string, unknown>)) {
      if (typeof v === "number") {
        result[k] = Math.floor(v);
      } else if (typeof v === "object" && v !== null) {
        result[k] = v;
      }
    }
    // OpenAI: 从 prompt_tokens_details.cached_tokens 提取缓存命中数到顶层
    const promptDetails = (data.usage as Record<string, unknown>).prompt_tokens_details;
    if (promptDetails && typeof promptDetails === "object") {
      const cached = (promptDetails as Record<string, unknown>).cached_tokens;
      if (typeof cached === "number") {
        result.cached_tokens = Math.floor(cached);
      }
    }
    return Object.keys(result).length > 0 ? result as LLMUsage : null;
  }

  if (protocol === "anthropic") {
    if (
      data.type === "message_start" &&
      typeof data.message === "object" &&
      data.message !== null
    ) {
      const usage = (data.message as Record<string, unknown>).usage;
      if (usage && typeof usage === "object") {
        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(usage as Record<string, unknown>)) {
          if (typeof v === "number") result[k] = Math.floor(v);
          else if (typeof v === "object" && v !== null) result[k] = v;
        }
        return Object.keys(result).length > 0 ? result as LLMUsage : null;
      }
    }
    if (data.type === "message_delta" && typeof data.usage === "object" && data.usage !== null) {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(data.usage as Record<string, unknown>)) {
        if (typeof v === "number") result[k] = Math.floor(v);
        else if (typeof v === "object" && v !== null) result[k] = v;
      }
      return Object.keys(result).length > 0 ? result as LLMUsage : null;
    }
  }

  return null;
}

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

  constructor(options?: LLMClientOptions) {
    this._logger = options?.logger ?? null;
    this._postLogger = options?.postLogger ?? null;
    this._postLogOptions = options?.postLogOptions ?? {};
    this._fetch = options?.fetchImpl ?? fetch;
    this._onPayload = options?.onPayload ?? null;
    this._onResponse = options?.onResponse ?? null;
  }

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
    messages: Record<string, string>[];
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
      url = this._buildBedrockUrl(preset, stream);
    } else if (protocol === "azure") {
      url = this._buildAzureUrl(preset);
    } else if (protocol === "google-vertex") {
      url = this._buildVertexUrl(preset, stream);
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

  /**
   * 构建 Bedrock 请求 URL
   * Bedrock 端点格式：
   *   非流式：{base}/model/{modelId}/converse
   *   流式：  {base}/model/{modelId}/converse-stream
   */
  private _buildBedrockUrl(preset: APIPreset, stream: boolean): string {
    const baseUrl = String(preset.url ?? "").trim().replace(/\/+$/, "");
    if (!baseUrl) return "";

    const modelId = String(preset.model ?? "").trim();
    const endpoint = stream ? "converse-stream" : "converse";

    // 检查 URL 是否已包含完整路径
    try {
      const parsed = new URL(baseUrl);
      const path = parsed.pathname;
      // 如果 URL 已包含 /converse 或 /converse-stream，替换端点
      if (path.includes("/converse-stream")) {
        return stream ? baseUrl : baseUrl.replace("/converse-stream", "/converse");
      }
      if (path.includes("/converse")) {
        return stream ? baseUrl.replace("/converse", "/converse-stream") : baseUrl;
      }
      // 如果 URL 已包含 /model/{modelId}，只追加端点
      if (path.includes("/model/")) {
        return baseUrl + "/" + endpoint;
      }
    } catch {
      // URL 解析失败，按字符串拼接
    }

    // 默认拼接：{base}/model/{modelId}/{endpoint}
    if (modelId) {
      return `${baseUrl}/model/${encodeURIComponent(modelId)}/${endpoint}`;
    }
    return `${baseUrl}/${endpoint}`;
  }

  /**
   * 构建 Azure OpenAI 请求 URL
   * Azure 端点格式：
   *   {endpoint}/openai/deployments/{deployment}/chat/completions?api-version={apiVersion}
   * deployment 取 preset.deployment（默认回退 preset.model），api-version 取 preset.api_version。
   */
  private _buildAzureUrl(preset: APIPreset): string {
    const raw = String(preset.url ?? "").trim().replace(/\/+$/, "");
    if (!raw) return "";

    // 已是完整 URL（含 /deployments/ 且带 chat/completions）则原样返回（补全 api-version）
    const apiVersion = resolveAzureApiVersion(preset);
    if (raw.includes("/deployments/") && raw.includes("/chat/completions")) {
      return raw.includes("api-version=")
        ? raw
        : `${raw}${raw.includes("?") ? "&" : "?"}api-version=${apiVersion}`;
    }

    // 从 base endpoint 拼接完整路径
    let base = raw;
    try {
      const parsed = new URL(raw);
      base = `${parsed.protocol}//${parsed.host}`;
    } catch {
      // 解析失败按字符串处理
    }
    const deployment = encodeURIComponent(resolveAzureDeployment(preset));
    return `${base}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
  }

  /**
   * 构建 Google Vertex AI 请求 URL
   * Vertex 端点格式：
   *   https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}
   *     /publishers/google/models/{model}:{generateContent|streamGenerateContent}
   * project 取 preset.project，location 取 preset.location（默认 us-central1）。
   * 若 preset.url 已是完整端点（含 publishers/google/models 或 :generateContent），则按 stream 切换方法后返回。
   */
  private _buildVertexUrl(preset: APIPreset, stream: boolean): string {
    const method = stream ? "streamGenerateContent" : "generateContent";
    const raw = String(preset.url ?? "").trim().replace(/\/+$/, "");

    // 已是完整端点：切换 generate/stream 方法（保留可能的 ?alt=sse）
    if (raw && (raw.includes(":generateContent") || raw.includes(":streamGenerateContent"))) {
      return raw.replace(/:(?:stream)?generateContent/i, `:${method}`);
    }
    if (raw && raw.includes("/publishers/google/models/")) {
      return `${raw}:${method}`;
    }

    const project = String(preset.project ?? preset.gcp_project ?? "").trim();
    const location = String(preset.location ?? preset.region ?? "us-central1").trim();
    const model = String(preset.model ?? "").trim();
    if (!project || !model) {
      // 信息不足，回退到原始 url（让厂商报清晰错误）
      return raw;
    }
    const host = `https://${location}-aiplatform.googleapis.com`;
    const path = `/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:${method}`;
    return `${host}${path}`;
  }

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
    messages: Record<string, string>[];
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
        for (const chunk of chunks) {
          if (abortSignal?.aborted) throw new DOMException("The user aborted a request.", "AbortError");
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
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            // 流结束：flush decoder 残留字节 + 处理 buffer 最后一行
            const tail = decoder.decode();
            if (tail) buffer += tail;
            if (buffer.trim()) {
              // 处理最后一行（可能没有结尾 \n）
              const decoded = buffer.trim();
              if (decoded) rawEvents.push(decoded);
              if (decoded.startsWith("data: ")) {
                const eventJson = decoded.slice(6);
                if (eventJson !== "[DONE]") {
                  try {
                    const tailData = JSON.parse(eventJson);
                    const tailEvent = adapter.parseStreamEvent(tailData, toolChunks);
                    if (tailEvent.delta) responseBody += tailEvent.delta;
                    if (tailEvent.thinking) reasoningContent += tailEvent.thinking;
                    if (tailEvent.finishReason) finishReason = tailEvent.finishReason;
                    if (tailEvent.usedReasoning) reasoningFallbackUsed = true;
                    if (tailEvent.delta || tailEvent.thinking || tailEvent.finishReason) {
                      yield {
                        delta: tailEvent.delta,
                        thinking: tailEvent.thinking,
                        rawEvent: decoded,
                        finishReason: tailEvent.finishReason,
                      };
                    }
                    const tailUsage = extractUsageFromEvent(tailData, protocol);
                    if (tailUsage) {
                      if (!accumulatedUsage) accumulatedUsage = {};
                      Object.assign(accumulatedUsage, tailUsage);
                    }
                  } catch {
                    console.warn(`[LLMClient] SSE tail JSON.parse failed: ${eventJson.slice(0, 200)}`);
                  }
                }
              }
            }
            buffer = "";
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const decoded = line.trim();
            if (decoded) rawEvents.push(decoded);
            if (!decoded.startsWith("data: ")) continue;

            const eventJson = decoded.slice(6);
            if (eventJson === "[DONE]") {
              if (!finishReason) finishReason = "stop";
              continue;
            }

            let data: Record<string, unknown>;
            try {
              data = JSON.parse(eventJson);
            } catch {
              // JSON 解析失败可能是 chunk 边界切割或厂商返回非 JSON 错误。记日志方便排查。
              console.warn(`[LLMClient] SSE data JSON.parse failed: ${eventJson.slice(0, 200)}`);
              continue;
            }

            const event = adapter.parseStreamEvent(data, toolChunks);
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
                rawEvent: decoded,
                finishReason: event.finishReason,
              };
            }

            const usage = extractUsageFromEvent(data, protocol);
            if (usage) {
              if (!accumulatedUsage) accumulatedUsage = {};
              Object.assign(accumulatedUsage, usage);
            }
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
        throw streamErr;
      } finally {
        // 安全释放 reader：先 cancel 关闭底层流，再 releaseLock。
        // try/catch 防止 abort/异常态下 releaseLock 抛二次错误覆盖原始异常。
        try { await reader.cancel(); } catch { /* 已关闭或 abort 态 */ }
        try { reader.releaseLock(); } catch { /* 锁已释放 */ }
      }
    } else if (contentType.includes(BEDROCK_EVENTSTREAM_CONTENT_TYPE) && response.body) {
      // Bedrock 二进制事件流解析
      try {
        for await (const { data: bedrockData, rawText } of this._readBedrockEventStream(response.body)) {
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
        throw streamErr;
      }
    } else {
      const text = await response.text();
      rawEvents.push(text);
      const data = JSON.parse(text);
      const parsed = adapter.parseNonstreamResponse(data);
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
    messages: Record<string, string>[];
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
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const toolChunks = new Map<number, { id: string; name: string; arguments: string }>();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            // 流结束：flush decoder 残留字节 + 处理 buffer 最后一行
            const tail = decoder.decode();
            if (tail) buffer += tail;
            if (buffer.trim()) {
              const decoded = buffer.trim();
              if (decoded) rawEvents.push(decoded);
              if (decoded.startsWith("data: ")) {
                const eventJson = decoded.slice(6);
                if (eventJson !== "[DONE]") {
                  try {
                    const tailData = JSON.parse(eventJson);
                    const tailEvent = adapter.parseStreamEvent(tailData, toolChunks);
                    if (tailEvent.delta) responseBody += tailEvent.delta;
                    if (tailEvent.thinking) reasoningContent += tailEvent.thinking;
                    if (tailEvent.finishReason) finishReason = tailEvent.finishReason;
                    if (tailEvent.usedReasoning) reasoningFallbackUsed = true;
                    const tailUsage = extractUsageFromEvent(tailData, protocol);
                    if (tailUsage) {
                      if (!accumulatedUsage) accumulatedUsage = {};
                      Object.assign(accumulatedUsage, tailUsage);
                    }
                  } catch {
                    console.warn(`[LLMClient] SSE tail JSON.parse failed: ${eventJson.slice(0, 200)}`);
                  }
                }
              }
            }
            buffer = "";
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const decoded = line.trim();
            if (decoded) rawEvents.push(decoded);
            if (!decoded.startsWith("data: ")) continue;

            const eventJson = decoded.slice(6);
            if (eventJson === "[DONE]") {
              if (!finishReason) finishReason = "stop";
              continue;
            }

            let data: Record<string, unknown>;
            try {
              data = JSON.parse(eventJson);
            } catch {
              // JSON 解析失败可能是 chunk 边界切割或厂商返回非 JSON 错误。记日志方便排查。
              console.warn(`[LLMClient] SSE data JSON.parse failed: ${eventJson.slice(0, 200)}`);
              continue;
            }

            const event = adapter.parseStreamEvent(data, toolChunks);
            if ((event.delta || event.thinking) && firstOutputMs === null) {
              firstOutputMs = Date.now() - startedAt;
              firstOutputSeconds = Math.round(firstOutputMs / 1000);
            }
            responseBody += event.delta;
            if (event.thinking) reasoningContent += event.thinking;
            if (event.finishReason) finishReason = event.finishReason;
            if (event.usedReasoning) reasoningFallbackUsed = true;

            const usage = extractUsageFromEvent(data, protocol);
            if (usage) {
              if (!accumulatedUsage) accumulatedUsage = {};
              Object.assign(accumulatedUsage, usage);
            }
          }
        }
      } finally {
        // 安全释放 reader：先 cancel 关闭底层流，再 releaseLock。
        // try/catch 防止 abort/异常态下 releaseLock 抛二次错误覆盖原始异常。
        try { await reader.cancel(); } catch { /* 已关闭或 abort 态 */ }
        try { reader.releaseLock(); } catch { /* 锁已释放 */ }
      }

      if (toolCalls.length === 0 && toolChunks.size > 0) {
        toolCalls = adapter.collectToolCalls(toolChunks);
      }
    } else if (contentType.includes(BEDROCK_EVENTSTREAM_CONTENT_TYPE) && response.body) {
      // Bedrock 二进制事件流解析（非流式调用 chat() 也可能收到事件流响应）
      const toolChunks = new Map<number, { id: string; name: string; arguments: string }>();
      try {
        for await (const { data: bedrockData, rawText } of this._readBedrockEventStream(response.body)) {
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
      const parsed = adapter.parseNonstreamResponse(data);
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

  /**
   * 读取 Bedrock 二进制事件流并解码为 JSON 事件
   *
   * Bedrock Converse Stream API 返回 application/vnd.amazon.eventstream 格式的二进制流，
   * 每个消息包含 headers（含 :event-type）和 body（JSON payload）。
   * 使用 @smithy/core 的 EventStreamCodec 解码二进制消息。
   *
   * @yields 解码后的 { data: Record<string, unknown>, rawText: string } 事件
   */
  private async *_readBedrockEventStream(
    body: ReadableStream<Uint8Array>,
  ): AsyncGenerator<{ data: Record<string, unknown>; rawText: string }> {
    // 动态加载 smithy 解码器（仅 Bedrock 需要；保持核心对浏览器友好）
    const { EventStreamCodec } = await import("@smithy/core/event-streams");
    const codec = new EventStreamCodec(
      (input: Uint8Array) => new TextDecoder("utf-8").decode(input),
      (input: string) => new TextEncoder().encode(input),
    );

    const reader = body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          codec.endOfStream();
          break;
        }
        if (value && value.byteLength > 0) {
          codec.feed(value);
          // 取出所有已解码的消息
          let messages = codec.getAvailableMessages();
          let decodedMessages = messages.getMessages();
          while (decodedMessages.length > 0) {
            for (const message of decodedMessages) {
              const bodyText = new TextDecoder("utf-8").decode(message.body);
              if (!bodyText.trim()) continue;
              try {
                const data = JSON.parse(bodyText) as Record<string, unknown>;
                // 将 event-type 注入到数据中，方便 adapter.parseStreamEvent 使用
                const eventType = message.headers[":event-type"];
                if (eventType && typeof eventType.value === "string") {
                  data._eventType = eventType.value;
                }
                const messageType = message.headers[":message-type"];
                if (messageType && typeof messageType.value === "string") {
                  data._messageType = messageType.value;
                }
                yield { data, rawText: bodyText };
              } catch {
                // JSON 解析失败，跳过
                console.warn(`[LLMClient] Bedrock eventstream JSON.parse failed: ${bodyText.slice(0, 200)}`);
              }
            }
            messages = codec.getAvailableMessages();
            decodedMessages = messages.getMessages();
          }
        }
      }
    } finally {
      try { await reader.cancel(); } catch { /* 已关闭 */ }
      try { reader.releaseLock(); } catch { /* 锁已释放 */ }
    }
  }

  /**
   * 带指数退避和 429 限流处理的 fetch。
   * abortSignal 收到时立即抛出 AbortError，不重试。
   */
  private async _fetchWithRetry(
    url: string,
    headers: Record<string, string>,
    body: string,
    maxRetries = MAX_RETRIES,
    abortSignal?: AbortSignal,
  ): Promise<Response> {
    let lastError: Error | null = null;
    const retryHistory: string[] = [];

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // 进入每次尝试前先检查中断信号
      if (abortSignal?.aborted) {
        throw new DOMException("The user aborted a request.", "AbortError");
      }

      try {
        const response = await this._fetch(url, {
          method: "POST",
          headers,
          body,
          signal: abortSignal,
        });

        if (response.status === 429) {
          const retryAfter = response.headers.get("retry-after");
          const waitMs = retryAfter
            ? parseInt(retryAfter, 10) * 1000
            : BASE_RETRY_DELAY * Math.pow(2, attempt);

          // 记录本次 429 重试信息
          const detail429 = await response.text().catch(() => "");
          retryHistory.push(`attempt ${attempt + 1}: 429 (wait ${waitMs}ms) ${detail429.slice(0, 200)}`);

          if (attempt < maxRetries) {
            await sleep(waitMs);
            continue;
          }
          throw new Error(`API Error 429: ${detail429}`);
        }

        if (!response.ok) {
          const detail = await response.text().catch(() => "");

          // 网关瞬时错误（502/503/504）：短重试最多 3 次，指数退避
          const isGatewayTransient =
            response.status === 502 ||
            response.status === 503 ||
            response.status === 504;
          const maxGatewayRetries = 3;
          if (isGatewayTransient && attempt < maxGatewayRetries) {
            const waitMs = BASE_RETRY_DELAY * Math.pow(2, attempt); // 1s, 2s, 4s
            retryHistory.push(
              `attempt ${attempt + 1}: HTTP ${response.status} (retry in ${waitMs}ms) ${detail.slice(0, 120)}`,
            );
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

        // 网络错误，重试
        if (attempt < maxRetries) {
          const waitMs = BASE_RETRY_DELAY * Math.pow(2, attempt);
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

/**
 * 敏感 header 脱敏白名单（小写匹配）。
 * 覆盖各厂商传 key 的 header：
 * - Authorization：OpenAI 系 / 通用 Bearer
 * - x-api-key：Anthropic
 * - api-key：Azure OpenAI
 * - x-goog-api-key：Gemini
 * - proxy-authorization：代理层
 */
const SENSITIVE_HEADERS = new Set([
  "authorization",
  "x-api-key",
  "api-key",
  "x-goog-api-key",
  "proxy-authorization",
]);

/** 判断 header 名是否敏感（需要脱敏） */
function isSensitiveHeader(name: string): boolean {
  return SENSITIVE_HEADERS.has(name.toLowerCase());
}

/** 返回脱敏后的 headers 副本（原对象不变） */
function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    safe[k] = isSensitiveHeader(k) ? "***" : v;
  }
  return safe;
}

/**
 * 应用 OAuth / 自定义请求头覆盖。
 *
 * - preset.oauth=true 时按厂商调整认证方式：
 *   - anthropic：去掉 x-api-key，改用 Authorization: Bearer + anthropic-beta: oauth-2025-04-20
 *     （OpenAI 系 / Codex / Copilot 本就用 Bearer，无需特殊处理）
 * - preset.extraHeaders：在最后合并（可覆盖任意头）
 */
function applyAuthOverrides(
  headers: Record<string, string>,
  preset: APIPreset,
  protocol: APIProtocol,
): Record<string, string> {
  const out: Record<string, string> = { ...headers };

  if (preset.oauth) {
    if (protocol === "anthropic") {
      delete out["x-api-key"];
      out["Authorization"] = `Bearer ${preset.key ?? ""}`;
      const OAUTH_BETA = "oauth-2025-04-20";
      const existing = out["anthropic-beta"];
      out["anthropic-beta"] = existing
        ? existing.includes(OAUTH_BETA)
          ? existing
          : `${existing},${OAUTH_BETA}`
        : OAUTH_BETA;
    }
  }

  const extra = preset.extraHeaders;
  if (extra && typeof extra === "object") {
    for (const [k, v] of Object.entries(extra)) {
      if (typeof v === "string") out[k] = v;
    }
  }

  return out;
}
