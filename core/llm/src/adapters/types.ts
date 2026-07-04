/**
 * 协议适配器共享类型与接口
 * 对应 Python: core/llm/adapters/adapter.py
 */

/** LLM 使用量统计 */
export interface LLMUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  /** Anthropic: 从缓存读取的输入 token 数 */
  cache_read_input_tokens?: number;
  /** Anthropic: 创建缓存的输入 token 数（首次写入） */
  cache_creation_input_tokens?: number;
  /** OpenAI: prompt_tokens_details.cached_tokens 的提取值 */
  cached_tokens?: number;
  [key: string]: number | Record<string, unknown> | undefined;
}

/** 工具调用 */
export interface LLMToolCall {
  id: string;
  name: string;
  parameters: Record<string, unknown>;
  provider: string;
  type: string;
}

/** 流式事件 */
export interface StreamEvent {
  delta: string;
  finishReason: string | null;
  usedReasoning: boolean;
  /** 思考/推理内容增量（本次 chunk 新增的思考文本） */
  thinking?: string;
}

/** 完整的模型响应 */
export interface ParsedLLMResponse {
  content: string;
  toolCalls: LLMToolCall[];
  finishReason: string | null;
  usedReasoning: boolean;
  /** 完整思考/推理内容（流式拼接后的全文） */
  reasoningContent?: string;
}

/** 模型响应数据 */
export interface ModelResponse {
  content: string;
  /** 完整思考/推理内容（流式拼接后的全文，若模型支持） */
  reasoningContent?: string;
  rawEvents: string[];
  contentType: string;
  finishReason: string | null;
  httpStatus: number | null;
  rawEventCount: number;
  reasoningFallbackUsed: boolean;
  firstOutputSeconds: number | null;
  /** 收到首 token 距请求开始的毫秒数（精确值，firstOutputSeconds * 1000 会丢失精度） */
  firstOutputMs: number | null;
  requestId: string | null;
  protocol: string;
  toolCalls: LLMToolCall[];
  usage: LLMUsage | null;
  rawPayload: Record<string, unknown> | null;
  /** 计时数据（毫秒） */
  timing?: {
    /** 请求发出去到收到首字母的时间 */
    firstByteMs: number;
    /** 首字母到生成完毕的时间 */
    generationMs: number;
    /** 总耗时（发出去到最后一个字母） */
    totalMs: number;
  };
  /** 流式调用被 abort 时已累积的内容（供上层保留部分结果） */
  partial?: string;
  /** 本次响应是否因 abort 而提前结束（true 时上层不应重试） */
  aborted?: boolean;
}

/** 流式增量 */
export interface ModelDelta {
  delta: string;
  rawEvent: string | null;
  finishReason: string | null;
  /** 思考/推理内容增量（本次 chunk 新增的思考文本） */
  thinking?: string;
}

/** 响应字段映射配置（用于自定义奇葩厂商的响应格式） */
export interface ResponseFieldMapping {
  /** 正文字段（按优先级顺序尝试，默认 ["content", "text"]） */
  content?: string[];
  /** 思考/推理字段（按优先级顺序尝试，默认 ["reasoning_content", "thinking", "thinking_content", "reasoning", "reasoning_details"]） */
  reasoning?: string[];
  /** 工具调用数组字段名（默认 "tool_calls"，也支持单数 "tool_call" 或 "function_call"） */
  toolCalls?: string;
  /** 工具调用 ID 字段名（默认 "id"） */
  toolCallId?: string;
  /** 工具调用名称路径（默认 "function.name"，也支持 "name"） */
  toolCallName?: string;
  /** 工具调用参数路径（默认 "function.arguments"，也支持 "arguments"） */
  toolCallArgs?: string;
  /** 结束原因字段（按优先级顺序尝试，默认 ["finish_reason", "stop_reason"]） */
  finishReason?: string[];
  /** usage 字段映射 */
  usage?: {
    promptTokens?: string;
    completionTokens?: string;
    totalTokens?: string;
  };
}

/** 流式解析选项（用于处理非标准流式格式） */
export interface StreamParseOptions {
  /**
   * 流式终止信号模式（默认 "standard"）：
   * - "standard": 检测 data: [DONE]
   * - "empty_line": 空行结束
   * - "finish_reason": finish_reason 出现即结束
   * - "none": 不检测终止信号（连接关闭即结束）
   */
  terminationMode?: "standard" | "empty_line" | "finish_reason" | "none";
  /**
   * 当 delta 层为空时，是否从 choice 顶层回退提取内容（vLLM 模式）
   * 默认 true（自动回退）
   */
  fallbackToChoiceTopLevel?: boolean;
}

/** API 预设配置 */
export interface APIPreset {
  name?: string;
  model: string;
  url: string;
  key?: string;
  protocol?: string;
  /** 输出 token 上限（max_tokens / max_output_tokens） */
  maxTokens?: number;
  /** 输入上下文上限（prompt window size）。用于上游上下文压缩阈值计算，不发给厂商 */
  maxContext?: number;
  supportsVision?: boolean;
  anthropicVersion?: string;
  reasoning_params?: Record<string, unknown>;
  /** 使用 OAuth 订阅令牌认证：LLMClient 会按厂商调整认证头（如 Anthropic 改 Bearer + anthropic-beta） */
  oauth?: boolean;
  /** 追加/覆盖的请求头（在适配器构建的头之上合并） */
  extraHeaders?: Record<string, string>;
  /**
   * 追加到请求体的自定义字段（用于厂商特有参数）
   * 例如：小米模型需要 { thinking: { type: "disabled" } }
   */
  extraBody?: Record<string, unknown>;
  /**
   * 响应转换钩子（在适配器解析前执行）
   * 用于处理 truly weird 的厂商格式，允许完全自定义响应结构
   */
  transformResponse?: (raw: Record<string, unknown>) => Record<string, unknown>;
  /**
   * OpenAI 兼容厂商的兼容标志矩阵（见 adapters/compat.ts）。
   * 缺省时按 url 自动检测（detectCompat）。
   */
  compat?: import("./compat.js").OpenAICompat;
  /** 思考格式简写（compat.thinkingFormat 的便捷别名） */
  compatFormat?: import("./compat.js").ThinkingFormat;
  /** 缓存保留：none/short(默认)/long(Anthropic 1h TTL) */
  cacheRetention?: "none" | "short" | "long";
  /** 自定义响应字段映射（用于奇葩厂商的响应格式） */
  responseFields?: ResponseFieldMapping;
  /** 流式解析选项（用于处理非标准流式格式） */
  streamOptions?: StreamParseOptions;
  /**
   * 输出格式化模式：
   * - "auto"（默认）：有 jsonSettings 时自动启用结构化输出
   * - "json_schema"：强制使用 JSON Schema strict mode
   * - "json_object"：使用 JSON object mode（不强制 schema）
   * - "none"：禁用结构化输出
   */
  output_format?: "auto" | "json_schema" | "json_object" | "none";
  [key: string]: unknown;
}

/** 协议适配器接口 */
export interface ProtocolAdapter {
  readonly protocolName: string;

  /** 构建请求头 */
  buildRequestHeaders(preset: APIPreset): Record<string, string>;

  /** 构建请求 payload */
  buildRequestPayload(params: {
    preset: APIPreset;
    messages: Record<string, unknown>[];
    stream: boolean;
    toolSchemas?: Record<string, unknown>[] | null;
    jsonSettings?: Record<string, unknown> | null;
    nativeToolCalling?: boolean;
    structuredOutputSchema?: Record<string, unknown> | null;
  }): Record<string, unknown>;

  /** 标准化消息 */
  normalizeMessages(messages: Record<string, unknown>[]): Record<string, unknown>[];

  /** 解析非流式响应 */
  parseNonstreamResponse(data: Record<string, unknown>, preset?: APIPreset): ParsedLLMResponse;

  /** 解析流式事件 */
  parseStreamEvent(
    data: Record<string, unknown>,
    toolChunks: Map<number, { id: string; name: string; arguments: string }>,
    preset?: APIPreset,
  ): StreamEvent;

  /** 从累积的 tool chunks 收集完整的工具调用 */
  collectToolCalls(
    toolChunks: Map<number, { id: string; name: string; arguments: string }>,
  ): LLMToolCall[];

  /** 解析工具参数字符串为对象 */
  parseToolArguments(value: unknown): Record<string, unknown>;

  /**
   * 对请求进行签名（可选，用于需要特殊认证的协议如 AWS Bedrock SigV4）
   * 如果适配器实现了此方法，LLMClient 会在发送请求前调用它来获取签名后的 headers
   */
  signRequest?(
    url: string,
    headers: Record<string, string>,
    body: string,
    preset: APIPreset,
  ): Promise<Record<string, string>>;
}

/** API 协议类型 */
export type APIProtocol =
  | "openai"
  | "anthropic"
  | "responses"
  | "google"
  | "mistral"
  | "bedrock"
  | "azure"
  | "cloudflare"
  | "google-vertex"
  | "openai-codex"
  | "github-copilot"
  | "faux";

/**
 * 标准化 API 协议名称
 * 对应 Python: core/llm/adapters/adapter.py normalize_api_protocol
 */
export function normalizeApiProtocol(value: unknown): APIProtocol {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["claude", "anthropic", "anthropic-messages"].includes(normalized)) {
    return "anthropic";
  }
  // openai-codex 必须在 responses 之前判断（codex 复用 Responses 协议但认证不同）
  if (["openai-codex", "codex", "openai_codex"].includes(normalized)) {
    return "openai-codex";
  }
  if (["responses", "openai-responses", "openai_responses"].includes(normalized)) {
    return "responses";
  }
  // google-vertex 必须在 google 之前判断（vertex 复用 Gemini 协议但认证/端点不同）
  if (["google-vertex", "vertex", "vertex-ai", "vertex_ai", "google_vertex"].includes(normalized)) {
    return "google-vertex";
  }
  if (["google", "gemini", "google-gemini", "google_gemini"].includes(normalized)) {
    return "google";
  }
  if (["mistral", "mistral-ai", "mistral_ai"].includes(normalized)) {
    return "mistral";
  }
  if (["bedrock", "aws-bedrock", "aws_bedrock", "amazon-bedrock"].includes(normalized)) {
    return "bedrock";
  }
  if (["azure", "azure-openai", "azure_openai", "azureopenai"].includes(normalized)) {
    return "azure";
  }
  if (["cloudflare", "cloudflare-workers-ai", "workers-ai", "cf"].includes(normalized)) {
    return "cloudflare";
  }
  if (["github-copilot", "copilot", "github_copilot", "githubcopilot"].includes(normalized)) {
    return "github-copilot";
  }
  if (["faux", "mock", "fake"].includes(normalized)) {
    return "faux";
  }
  return "openai";
}

/**
 * 补全 API URL 路径
 * 对应 Python: core/llm/adapters/adapter.py complete_api_url
 */
export function completeApiUrl(url: string, protocol: APIProtocol = "openai"): string {
  let base = url.trim();
  if (!base) return "";

  base = base.replace(/\/+$/, "");
  let path = "";
  try {
    path = new URL(base).pathname;
  } catch {
    path = "";
  }

  // 把"复用型"协议映射到其底层协议的 URL 规则：
  // - openai-codex 复用 Responses API 路径
  // - google-vertex 复用 Gemini 路径（原样返回，端点由调用方拼接）
  // - azure：完整 URL（deployments + api-version）由 client 单独构建，这里原样返回
  // - cloudflare / github-copilot：OpenAI 兼容路径（cloudflare 的占位符由 client 替换）
  const rawProtocol = normalizeApiProtocol(protocol);
  if (rawProtocol === "azure") return base;
  const protocolUrlAlias: Partial<Record<APIProtocol, APIProtocol>> = {
    "openai-codex": "responses",
    "google-vertex": "google",
    cloudflare: "openai",
    "github-copilot": "openai",
    faux: "openai",
  };
  const np = protocolUrlAlias[rawProtocol] ?? rawProtocol;

  if (np === "anthropic") {
    if (path.endsWith("/v1/messages")) return base;
    if (/\/v1$/.test(path)) return base + "/messages";
    if (!path.includes("/v1")) return base + "/v1/messages";
    return base;
  }

  if (np === "responses") {
    if (path.endsWith("/v1/responses")) return base;
    if (/\/v1$/.test(path)) return base + "/responses";
    if (!path.includes("/v1")) return base + "/v1/responses";
    return base;
  }

  if (np === "google") {
    // Google Gemini: https://generativelanguage.googleapis.com/v1beta/models/{model}:{method}
    // 如果 URL 已经包含 /models/ 或 :generateContent，则原样返回
    if (path.includes("/models/") || path.includes(":generateContent") || path.includes(":streamGenerateContent")) {
      return base;
    }
    // 否则原样返回（model 和 method 由调用方在 URL 中指定）
    return base;
  }

  if (np === "mistral") {
    // Mistral: https://api.mistral.ai/v1/chat/completions
    if (path.includes("/chat")) return base;
    if (/\/v1$/.test(path)) return base + "/chat/completions";
    if (!path.includes("/v1")) return base + "/v1/chat/completions";
    return base;
  }

  if (np === "bedrock") {
    // AWS Bedrock: https://bedrock-runtime.{region}.amazonaws.com/model/{modelId}/converse
    // URL 格式由 preset.url + preset.model 组合，这里只做路径补全
    if (path.includes("/converse") || path.includes("/converse-stream")) return base;
    if (path.includes("/model/")) {
      // 已包含 modelId，补全 converse 或 converse-stream
      // 注意：stream 参数由 LLMClient 在 body 中传递，Bedrock 通过端点区分
      // 这里默认补全 converse（非流式），流式由调用方在 URL 中指定 converse-stream
      return base + "/converse";
    }
    // 如果 URL 不包含 /model/，则原样返回（modelId 由 preset.model 提供，需要在 URL 中拼接）
    return base;
  }

  // openai
  if (path.includes("/chat")) return base;
  if (/\/v1$/.test(path)) return base + "/chat/completions";
  if (!path.includes("/v1")) return base + "/v1/chat/completions";
  return base;
}
