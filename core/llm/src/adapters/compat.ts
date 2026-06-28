/**
 * OpenAI 兼容厂商的 compat 标志矩阵
 *
 * 对标 pi-ai 的 OpenAICompletionsCompat —— 把各家 OpenAI 兼容厂商的差异
 * （字段名/角色/思考格式/路由/缓存）抽成声明式标志，避免在每个 adapter 里硬编码 if/else。
 *
 * 用法：在 preset 上设 preset.compat = { ... }（或 preset.compatFormat = "deepseek"），
 * OpenAI adapter 据此调整 payload。也可由 baseUrl 自动检测（detectCompat）。
 *
 * 比 pi-ai 更完善：新增 structuredOutputCompat（我们的结构化输出层在各家的兼容差异）。
 */

/** 思考格式（对标 pi 的 10 种 thinkingFormat） */
export type ThinkingFormat =
  | "openai" // reasoning_effort（标准 OpenAI/o-系列）
  | "openrouter" // reasoning: { effort }
  | "deepseek" // reasoning_content（DeepSeek-R1）
  | "together" // Together 的 reasoning 字段
  | "zai" // z.ai 的 thinking
  | "qwen" // enable_thinking（Qwen3）
  | "chat-template" // chat_template_kwargs.thinking（vLLM 模板）
  | "qwen-chat-template" // chat_template_kwargs.enable_thinking
  | "string-thinking" // 旧式 <think> 标签
  | "ant-ling"; // 蚂蚁 Ling 的格式

/** 思考级别（对标 OMP 的 effort 级别） */
export type EffortLevel = "none" | "low" | "medium" | "high" | "xhigh";

/** 结构化输出兼容（我们的扩展：pi 没有这个维度） */
export type StructuredOutputCompat =
  | "json_schema" // 标准 OpenAI response_format json_schema
  | "json_object" // 只支持 json_object
  | "qwen-response-format" // Qwen 的 response_format 变体
  | "none"; // 不支持，降级为提示词内嵌

/**
 * OpenAI 兼容厂商的兼容标志全集。
 * 每个标志缺省=false（走标准 OpenAI 行为）；设了就启用对应适配。
 */
export interface OpenAICompat {
  /** 支持 `store` 字段（部分代理不支持） */
  supportsStore?: boolean;
  /** 支持 `developer` 角色（OpenAI 较新）；false 时降级为 system */
  supportsDeveloperRole?: boolean;
  /** 支持 `reasoning_effort` 字段（o-系列）；false 走 thinkingFormat */
  supportsReasoningEffort?: boolean;
  /** 支持 `tool_choice` 参数；false 时不发送 tool_choice（DeepSeek V4 思考模式拒绝此参数） */
  supportsToolChoice?: boolean;
  /** 流式响应含 usage（部分厂商流式不发 usage） */
  supportsUsageInStreaming?: boolean;
  /** 支持 strict 模式（json_schema strict） */
  supportsStrictMode?: boolean;
  /** 用哪个字段传 token 上限：max_tokens(默认) / max_completion_tokens */
  maxTokensField?: "max_tokens" | "max_completion_tokens";
  /** 工具结果消息是否必须带 tool name（部分代理要求） */
  requiresToolResultName?: boolean;
  /** 工具结果后必须紧跟 assistant 消息（不能连续 tool） */
  requiresAssistantAfterToolResult?: boolean;
  /** 工具调用轮次历史消息中必须保留 reasoning_content（DeepSeek V4 不保留会 400） */
  requiresReasoningContentForToolCalls?: boolean;
  /** 工具调用消息的 content 不能为 null（DeepSeek V4 要求非空，否则 400） */
  requiresAssistantContentForToolCalls?: boolean;
  /** 思考内容必须作为文本输出（无独立 reasoning 字段） */
  requiresThinkingAsText?: boolean;
  /** 思考格式（10 选 1，见 ThinkingFormat） */
  thinkingFormat?: ThinkingFormat;
  /** chat_template_kwargs 占位（vLLM 模板，如 { $var: "thinking.enabled" }） */
  chatTemplateKwargs?: { $var: string; omitWhenOff?: boolean };
  /** OpenRouter 路由偏好（透传 provider/models/route 等） */
  openRouterRouting?: Record<string, unknown>;
  /** 缓存控制格式：anthropic(镜像 Anthropic cache_control) / 无 */
  cacheControlFormat?: "anthropic";
  /** 发送 session 亲和头（x-session-affinity 等） */
  sendSessionAffinityHeaders?: boolean;
  /** 支持长缓存保留（1h TTL） */
  supportsLongCacheRetention?: boolean;
  /** z.ai 工具流式特性 */
  zaiToolStream?: boolean;
  /** 结构化输出兼容（我们的扩展） */
  structuredOutput?: StructuredOutputCompat;
  /**
   * Effort 级别映射（对标 OMP 的 reasoningEffortMap）
   * 将我们的标准级别映射到厂商实际接受的值。
   * 例如 DeepSeek V4：{ high: "high", xhigh: "max" }
   * 例如 OpenAI：{ low: "low", medium: "medium", high: "high" }（默认）
   * 未列出的级别使用原值。
   */
  reasoningEffortMap?: Partial<Record<EffortLevel, string>>;
  /** 思考级别可选范围下限（默认 "none"） */
  thinkingMinLevel?: EffortLevel;
  /** 思考级别可选范围上限（默认 "xhigh"） */
  thinkingMaxLevel?: EffortLevel;
}

/** Anthropic 兼容标志（对标 pi 的 AnthropicMessagesCompat） */
export interface AnthropicCompat {
  /** 支持工具输入的即时流式（部分代理不支持） */
  supportsEagerToolInputStreaming?: boolean;
  /** 支持 1h 长缓存 */
  supportsLongCacheRetention?: boolean;
  /** 发送 session 亲和头 */
  sendSessionAffinityHeaders?: boolean;
  /** 工具定义上支持 cache_control */
  supportsCacheControlOnTools?: boolean;
  /** 支持 temperature（Opus 4.7+ 拒绝非默认 temperature） */
  supportsTemperature?: boolean;
  /** 强制 adaptive thinking（非 budget 模型） */
  forceAdaptiveThinking?: boolean;
  /** 允许空签名（部分代理要求 tool 必须有 signature） */
  allowEmptySignature?: boolean;
  /** 思考级别可选范围下限（默认 "none"） */
  thinkingMinLevel?: EffortLevel;
  /** 思考级别可选范围上限（默认 "xhigh"） */
  thinkingMaxLevel?: EffortLevel;
}

// ─── 按 baseUrl 自动检测默认 compat（对标 pi 的回退检测）─────────────────────

/** 已知的 OpenAI 兼容厂商默认 compat（按 baseUrl 关键词匹配） */
const VENDOR_DEFAULTS: Array<{ match: RegExp; compat: OpenAICompat }> = [
  { match: /deepseek/i, compat: {
    thinkingFormat: "deepseek",
    supportsReasoningEffort: false,
    supportsToolChoice: false,
    requiresReasoningContentForToolCalls: true,
    requiresAssistantContentForToolCalls: true,
    reasoningEffortMap: { high: "high", xhigh: "max" },
    thinkingMinLevel: "low",
  } },
  { match: /qwen|dashscope/i, compat: { thinkingFormat: "qwen", structuredOutput: "qwen-response-format" } },
  { match: /zai|z\.ai/i, compat: { thinkingFormat: "zai", zaiToolStream: true } },
  { match: /together/i, compat: { thinkingFormat: "together" } },
  { match: /openrouter/i, compat: { thinkingFormat: "openrouter" } },
  { match: /cerebras/i, compat: { supportsStore: false, supportsReasoningEffort: false, thinkingMaxLevel: "none" } },
  { match: /api\.x\.ai|xai/i, compat: {} }, // xAI 较标准
  { match: /groq/i, compat: { supportsStore: false, thinkingMaxLevel: "none" } },
  { match: /fireworks/i, compat: { thinkingFormat: "deepseek" } },
  { match: /cloudflare|workers\.ai/i, compat: { supportsStore: false, supportsStrictMode: false, thinkingMaxLevel: "none" } },
  { match: /nvidia|nim/i, compat: { supportsStore: false, thinkingMaxLevel: "none" } },
  { match: /ant[-.]?ling|antling/i, compat: { thinkingFormat: "ant-ling" } },
  // Mimo (小米 MiMo) — token-plan / mimo API
  // 关键：Mimo 的 thinking:{type:"disabled"} 在流式模式下会导致首字延迟 9s+（API 端 bug），
  // 必须用 enable_thinking: false（qwen 格式）来关闭思考，首字正常 ~2.7s。
  { match: /xiaomimimo|mimo/i, compat: { thinkingFormat: "qwen", supportsToolChoice: true } },
];

/**
 * 按 baseUrl 自动检测 compat（preset.compat 未显式设时调用）。
 * 返回 null 表示走标准 OpenAI 默认（无特殊适配）。
 */
export function detectCompat(baseUrl: string): OpenAICompat | null {
  for (const { match, compat } of VENDOR_DEFAULTS) {
    if (match.test(baseUrl)) return compat;
  }
  return null;
}

/**
 * 解析最终生效的 compat：preset 显式设置优先，否则按 baseUrl 检测。
 */
export function resolveCompat(preset: { compat?: OpenAICompat; compatFormat?: ThinkingFormat; url?: string }): OpenAICompat {
  const explicit = preset.compat ?? {};
  const detected = preset.url ? detectCompat(preset.url) ?? {} : {};
  // compatFormat（简写）优先于 detected.thinkingFormat
  const thinkingFormat = explicit.thinkingFormat ?? preset.compatFormat ?? detected.thinkingFormat;
  return { ...detected, ...explicit, thinkingFormat };
}
