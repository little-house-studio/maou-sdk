/**
 * OpenAI Chat 适配器
 * 对应 Python: core/llm/adapters/openai_chat_adapter.py
 *
 * 使用 openai SDK 的类型定义增强类型安全性，
 * 使用 partial-json 库解析流式工具调用参数。
 */

import type {
  ProtocolAdapter,
  APIPreset,
  ParsedLLMResponse,
  LLMToolCall,
  StreamEvent,
} from "./types.js";
import { parseToolArguments, normalizeToolParametersSchema, MAX_TOKENS_CAP, coerceText } from "./shared.js";
import { resolveCompat } from "./compat.js";

/** 从文本中提取 JSON 候选（从 reasoning_content 中） */
function extractJsonCandidateFromReasoning(
  text: string,
  hasAccumulatedBody: boolean,
): string {
  const raw = coerceText(text);
  if (!raw) return "";
  if (hasAccumulatedBody) return raw;
  const fenceIndex = raw.indexOf("```json");
  if (fenceIndex >= 0) return raw.slice(fenceIndex);
  const braceIndex = raw.indexOf("{");
  if (braceIndex >= 0) return raw.slice(braceIndex);
  return "";
}

export class OpenAIChatAdapter implements ProtocolAdapter {
  readonly protocolName = "openai";

  buildRequestHeaders(preset: APIPreset): Record<string, string> {
    return {
      Authorization: `Bearer ${preset.key ?? ""}`,
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0",
    };
  }

  private _buildTools(toolSchemas: Record<string, unknown>[] | null | undefined): Record<string, unknown>[] {
    const tools: Record<string, unknown>[] = [];
    for (const schema of toolSchemas ?? []) {
      const name = String((schema as Record<string, unknown>).name ?? "").trim();
      if (!name) continue;
      tools.push({
        type: "function",
        function: {
          name,
          description: String((schema as Record<string, unknown>).description ?? name),
          parameters: normalizeToolParametersSchema((schema as Record<string, unknown>).parameters),
        },
      });
    }
    return tools;
  }

  /**
   * 规范化 reasoning_params 适配 OpenAI 协议。
   * - Anthropic 风格 thinking: {type:'enabled', budget_tokens} → OpenAI reasoning_effort
   *   budget_tokens ≤ 2048 → low, ≤ 8192 → medium, > 8192 → high
   * - thinking: {type:'disabled'} → 不注入（移除 reasoning）
   * - 已是 reasoning_effort 字符串 → 原样保留
  /**
   * 规范化 reasoning_params，按 compat.thinkingFormat 映射到各厂商字段。
   * 规范形：thinking = { type: 'enabled'|'disabled', budget_tokens }
   * 各 format 的输出（对标 pi 的 10 种 thinkingFormat）：
   *   openai          → reasoning_effort: minimal/low/medium/high
   *   openrouter      → reasoning: { effort }
   *   deepseek/together→ 走 reasoning_content（请求侧无需字段，模型自带；这里不注入）
   *   zai             → thinking: { type:'enabled' }
   *   qwen            → enable_thinking: true
   *   chat-template   → chat_template_kwargs: { thinking: { enabled } }
   *   qwen-chat-template → chat_template_kwargs: { enable_thinking: true }
   *   string-thinking → 不注入（靠 <think> 标签）
   *   ant-ling        → 厂商自定义，透传 thinking
   */
  private _normalizeReasoningParamsForOpenAI(
    params: Record<string, unknown>,
    format: import("./compat.js").ThinkingFormat = "openai",
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(params)) {
      if (k === "thinking" && v && typeof v === "object") {
        const thinking = v as Record<string, unknown>;
        if (thinking.type === "disabled") continue; // 关闭，不注入
        if (thinking.type === "enabled") {
          const budget = Number(thinking.budget_tokens ?? 0);
          const effort = budget <= 1024 ? "minimal" : budget <= 2048 ? "low" : budget <= 8192 ? "medium" : "high";
          this._injectByFormat(result, format, effort, thinking);
          continue;
        }
      }
      // reasoning_effort 等已符合规范的字段原样保留
      result[k] = v;
    }
    return result;
  }

  /** 按 format 把 effort 注入到 result 的对应字段 */
  private _injectByFormat(
    result: Record<string, unknown>,
    format: import("./compat.js").ThinkingFormat,
    effort: string,
    thinking: Record<string, unknown>,
  ): void {
    switch (format) {
      case "openai":
        result.reasoning_effort = effort;
        break;
      case "openrouter":
        result.reasoning = { effort };
        break;
      case "zai":
      case "ant-ling":
        result.thinking = { type: "enabled" };
        break;
      case "qwen":
        result.enable_thinking = true;
        break;
      case "qwen-chat-template":
        result.chat_template_kwargs = { enable_thinking: true };
        break;
      case "chat-template":
        result.chat_template_kwargs = { thinking: { enabled: true } };
        break;
      case "deepseek":
      case "together":
      case "string-thinking":
        // 模型自带 reasoning_content（输出侧解析），请求侧无需字段
        break;
      default:
        result.reasoning_effort = effort;
    }
  }

  buildRequestPayload(params: {
    preset: APIPreset;
    messages: Record<string, unknown>[];
    stream: boolean;
    toolSchemas?: Record<string, unknown>[] | null;
    jsonSettings?: Record<string, unknown> | null;
    nativeToolCalling?: boolean;
    structuredOutputSchema?: Record<string, unknown> | null;
  }): Record<string, unknown> {
    const { preset, messages, stream, toolSchemas, nativeToolCalling, jsonSettings } = params;
    const compat = resolveCompat(preset);
    const maxTokensField = compat.maxTokensField ?? "max_tokens";
    const payload: Record<string, unknown> = {
      model: preset.model,
      [maxTokensField]: Math.min(Number(preset.maxTokens ?? 65536) || 65536, MAX_TOKENS_CAP),
      messages,
      stream,
    };
    // supportsDeveloperRole：把 system 角色改成 developer（OpenAI 较新）；默认不改
    if (compat.supportsDeveloperRole) {
      for (const m of messages) {
        if ((m as Record<string, unknown>).role === "system") (m as Record<string, unknown>).role = "developer";
      }
    }
    if (stream) {
      payload.stream_options = { include_usage: true };
    }
    const hasTools = Boolean(nativeToolCalling && toolSchemas?.length);
    if (nativeToolCalling) {
      const tools = this._buildTools(toolSchemas);
      if (tools.length) {
        payload.tools = tools;
        payload.tool_choice = "auto";
      }
    }
    // jsonSettings → 注入 response_format 强制 JSON 输出
    if (jsonSettings && !hasTools) {
      const schemaStr = jsonSettings.schema_template ?? jsonSettings.schema;
      if (schemaStr) {
        let schemaObj: unknown;
        try {
          schemaObj = typeof schemaStr === "string" ? JSON.parse(schemaStr) : schemaStr;
        } catch { /* 解析失败 */ }
        if (schemaObj && typeof schemaObj === "object") {
          payload.response_format = {
            type: "json_schema",
            json_schema: {
              name: "output",
              strict: true,
              schema: schemaObj,
            },
          };
        } else {
          payload.response_format = { type: "json_object" };
        }
      } else {
        payload.response_format = { type: "json_object" };
      }
    }
    // 注入 reasoning_params：按 compat.thinkingFormat 映射到各厂商字段
    const reasoningParams = preset.reasoning_params;
    if (reasoningParams && typeof reasoningParams === "object") {
      const normalized = this._normalizeReasoningParamsForOpenAI(reasoningParams, compat.thinkingFormat);
      for (const [k, v] of Object.entries(normalized)) {
        if (!(k in payload)) {
          payload[k] = v;
        }
      }
    }
    // OpenRouter 路由偏好：compat.openRouterRouting → 注入 provider/models/route/transforms
    const routing = compat.openRouterRouting ?? preset.openrouterRouting;
    if (routing && typeof routing === "object") {
      const r = routing as Record<string, unknown>;
      for (const field of ["provider", "models", "route", "transforms"]) {
        if (r[field] !== undefined && !(field in payload)) payload[field] = r[field];
      }
    }
    return payload;
  }

  normalizeMessages(messages: Record<string, unknown>[]): Record<string, unknown>[] {
    return messages;
  }

  parseNonstreamResponse(data: Record<string, unknown>): ParsedLLMResponse {
    const choices = (data.choices as Record<string, unknown>[]) ?? [{}];
    const choice = choices[0] ?? {};
    const delta = (choice.delta as Record<string, unknown>) ?? {};
    const message = (choice.message as Record<string, unknown>) ?? {};

    let body = "";
    let usedReasoning = false;
    let reasoningContent = "";

    // 提取思考/推理内容（reasoning_content / thinking / reasoning / reasoning_details 字段）——独立保留，不混入 body
    // 覆盖多厂商措辞：deepseek/qwen/zai 用 reasoning_content；openrouter 用 reasoning / reasoning_details
    const collectReasoning = (src: Record<string, unknown>): string => {
      const r = coerceText(src.reasoning_content)
        || coerceText(src.thinking)
        || coerceText(src.thinking_content)
        || coerceText(src.reasoning)
        || coerceText(src.reasoning_details);
      return r;
    };

    const deltaReasoningRaw = collectReasoning(delta);
    const messageReasoningRaw = collectReasoning(message);
    const choiceReasoningRaw = collectReasoning(choice);
    reasoningContent = deltaReasoningRaw || messageReasoningRaw || choiceReasoningRaw;
    if (reasoningContent) usedReasoning = true;

    // 提取正文 content
    const deltaContent = coerceText(delta.content);
    if (deltaContent) {
      body = deltaContent;
    } else {
      const messageContent = coerceText(message.content);
      if (messageContent) {
        body = messageContent;
      } else {
        const choiceText = coerceText(choice.text);
        if (choiceText) {
          body = choiceText;
        } else if (reasoningContent) {
          // 正文为空但有思考内容：尝试从思考中提取结构化输出（兼容旧逻辑）
          const extracted = extractJsonCandidateFromReasoning(reasoningContent, false);
          body = extracted || "";
        }
      }
    }

    // 解析 tool_calls
    const rawCalls = (message.tool_calls as Record<string, unknown>[]) ?? [];
    const toolCalls: LLMToolCall[] = [];
    for (let i = 0; i < rawCalls.length; i++) {
      const rawCall = rawCalls[i];
      if (!rawCall || typeof rawCall !== "object") continue;
      const fnPayload = (rawCall.function as Record<string, unknown>) ?? rawCall;
      const name = String(fnPayload.name ?? "").trim();
      if (!name) continue;
      toolCalls.push({
        id: String(rawCall.id ?? `tool_call_${i}`),
        name,
        parameters: this.parseToolArguments(fnPayload.arguments),
        provider: "openai",
        type: String(rawCall.type ?? "function"),
      });
    }

    const finishReasonRaw = choice.finish_reason;
    const finishReason =
      typeof finishReasonRaw === "string" && finishReasonRaw ? finishReasonRaw : null;

    return { content: body, toolCalls, finishReason, usedReasoning, reasoningContent: reasoningContent || undefined };
  }

  parseStreamEvent(
    data: Record<string, unknown>,
    toolChunks: Map<number, { id: string; name: string; arguments: string }>,
  ): StreamEvent {
    // 流内错误检测：OpenAI 流式错误格式 data: {"error": {...}}
    if (data.error) {
      const errMsg = typeof data.error === "object"
        ? String((data.error as Record<string, unknown>).message ?? JSON.stringify(data.error))
        : String(data.error);
      throw new Error(`LLM stream error: ${errMsg}`);
    }

    const choices = (data.choices as Record<string, unknown>[]) ?? [{}];
    const choice = choices[0] ?? {};
    const deltaPayload = (choice.delta as Record<string, unknown>) ?? {};
    const rawToolCalls = deltaPayload.tool_calls as Record<string, unknown>[] | undefined;

    // 处理 tool_calls 流式增量
    if (Array.isArray(rawToolCalls) && rawToolCalls.length > 0) {
      for (const rawCall of rawToolCalls) {
        if (!rawCall || typeof rawCall !== "object") continue;
        const rawIndex = rawCall.index;
        const callIndex = typeof rawIndex === "number" ? rawIndex : toolChunks.size;
        let chunk = toolChunks.get(callIndex);
        if (!chunk) {
          chunk = {
            id: String(rawCall.id ?? `tool_call_${callIndex}`),
            name: "",
            arguments: "",
          };
          toolChunks.set(callIndex, chunk);
        }
        if (rawCall.id) chunk.id = String(rawCall.id);
        if (rawCall.type) { /* no-op, type tracked externally */ }
        const fnPayload = rawCall.function as Record<string, unknown> | undefined;
        if (fnPayload && typeof fnPayload === "object") {
          if (fnPayload.name) chunk.name = String(fnPayload.name);
          if (typeof fnPayload.arguments === "string") {
            chunk.arguments += fnPayload.arguments;
          }
        }
      }
      return { delta: "", finishReason: null, usedReasoning: false };
    }

    // 提取 content delta
    const delta = this._extractStreamContent(data, false);
    // 提取思考/推理内容增量（独立字段，不混入 delta）
    const thinking = this._extractStreamThinking(data);
    const finishReasonRaw = choice.finish_reason;
    const finishReason =
      typeof finishReasonRaw === "string" && finishReasonRaw ? finishReasonRaw : null;

    return { delta, finishReason, usedReasoning: !!thinking, thinking: thinking || undefined };
  }

  /** 提取流式思考/推理内容增量（reasoning_content / thinking / thinking_content） */
  private _extractStreamThinking(data: Record<string, unknown>): string {
    const choices = (data.choices as Record<string, unknown>[]) ?? [{}];
    const choice = choices[0] ?? {};
    const delta = (choice.delta as Record<string, unknown>) ?? {};
    const message = (choice.message as Record<string, unknown>) ?? {};

    return coerceText(delta.reasoning_content)
      || coerceText(delta.thinking)
      || coerceText(delta.thinking_content)
      || coerceText(delta.reasoning)
      || coerceText(delta.reasoning_details)
      || coerceText(message.reasoning_content)
      || coerceText(message.thinking)
      || coerceText(message.reasoning)
      || coerceText(choice.reasoning_content)
      || coerceText(choice.thinking)
      || coerceText(choice.reasoning)
      || "";
  }

  private _extractStreamContent(data: Record<string, unknown>, hasAccumulatedBody: boolean): string {
    const choices = (data.choices as Record<string, unknown>[]) ?? [{}];
    const choice = choices[0] ?? {};
    const delta = (choice.delta as Record<string, unknown>) ?? {};

    // 正文只从 delta.content 取，绝不从 reasoning_content 里凑。
    // reasoning_content 由 _extractStreamThinking 独立处理，避免思考内容污染正文。
    const deltaContent = coerceText(delta.content);
    if (deltaContent) return deltaContent;

    const message = (choice.message as Record<string, unknown>) ?? {};
    const messageContent = coerceText(message.content);
    if (messageContent) return hasAccumulatedBody ? "" : messageContent;

    const choiceText = coerceText(choice.text);
    if (choiceText) return hasAccumulatedBody ? "" : choiceText;

    return "";
  }

  collectToolCalls(
    toolChunks: Map<number, { id: string; name: string; arguments: string }>,
  ): LLMToolCall[] {
    const toolCalls: LLMToolCall[] = [];
    const sorted = [...toolChunks.entries()].sort((a, b) => a[0] - b[0]);
    for (const [index, chunk] of sorted) {
      const name = chunk.name.trim();
      if (!name) continue;
      toolCalls.push({
        id: chunk.id || `tool_call_${index}`,
        name,
        parameters: this.parseToolArguments(chunk.arguments),
        provider: "openai",
        type: "function",
      });
    }
    return toolCalls;
  }

  parseToolArguments = parseToolArguments;
}
