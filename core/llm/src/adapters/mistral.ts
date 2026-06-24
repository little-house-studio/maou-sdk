/**
 * Mistral 适配器
 *
 * 实现 ProtocolAdapter 接口，将统一消息格式转换为 Mistral API 格式。
 * Mistral API 与 OpenAI Chat Completions 高度兼容，但有自身特色字段：
 * - safe_prompt: 安全提示模式
 * - random_seed: 随机种子
 * - random_mode: 采样模式
 * - 工具调用格式与 OpenAI 一致（function calling）
 *
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

export class MistralAdapter implements ProtocolAdapter {
  readonly protocolName = "mistral";

  buildRequestHeaders(preset: APIPreset): Record<string, string> {
    return {
      Authorization: `Bearer ${preset.key ?? ""}`,
      "Content-Type": "application/json",
      Accept: "application/json",
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
   * 规范化 reasoning_params 适配 Mistral 协议。
   * Mistral 不支持原生 reasoning_effort，但部分模型（如 magistral）支持 thinking 字段。
   * 这里保留 reasoning_params 透传，让 Mistral 自行处理。
   */
  private _normalizeReasoningParamsForMistral(params: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(params)) {
      if (k === "thinking" && v && typeof v === "object") {
        const thinking = v as Record<string, unknown>;
        if (thinking.type === "disabled") {
          continue;
        }
        // Mistral magistral 模型支持 thinking 字段
        result.thinking = thinking;
        continue;
      }
      result[k] = v;
    }
    return result;
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
    const payload: Record<string, unknown> = {
      model: preset.model,
      max_tokens: Math.min(Number(preset.maxTokens ?? 65536) || 65536, MAX_TOKENS_CAP),
      messages,
      stream,
    };
    if (stream) {
      payload.stream_options = { include_usage: true };
    }

    // Mistral 特色字段：safe_prompt / random_seed
    if (typeof preset.safe_prompt === "boolean") {
      payload.safe_prompt = preset.safe_prompt;
    }
    if (typeof preset.random_seed === "number") {
      payload.random_seed = preset.random_seed;
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
          // Mistral 支持 json_schema response_format（与 OpenAI 一致）
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

    // 注入 reasoning_params（Mistral magistral 模型支持 thinking 字段）
    const reasoningParams = preset.reasoning_params;
    if (reasoningParams && typeof reasoningParams === "object") {
      const normalized = this._normalizeReasoningParamsForMistral(reasoningParams);
      for (const [k, v] of Object.entries(normalized)) {
        if (!(k in payload)) {
          payload[k] = v;
        }
      }
    }

    return payload;
  }

  normalizeMessages(messages: Record<string, unknown>[]): Record<string, unknown>[] {
    return messages;
  }

  parseNonstreamResponse(data: Record<string, unknown>, preset?: APIPreset): ParsedLLMResponse {
    const choices = (data.choices as Record<string, unknown>[]) ?? [{}];
    const choice = choices[0] ?? {};
    const delta = (choice.delta as Record<string, unknown>) ?? {};
    const message = (choice.message as Record<string, unknown>) ?? {};

    let body = "";
    let usedReasoning = false;
    let reasoningContent = "";

    // 提取思考/推理内容（支持自定义字段映射）
    const reasoningFields = preset?.responseFields?.reasoning ?? [
      "reasoning_content",
      "thinking",
      "thinking_content",
    ];
    const collectReasoning = (src: Record<string, unknown>): string => {
      for (const field of reasoningFields) {
        const r = coerceText(src[field]);
        if (r) return r;
      }
      return "";
    };

    const deltaReasoningRaw = collectReasoning(delta);
    const messageReasoningRaw = collectReasoning(message);
    const choiceReasoningRaw = collectReasoning(choice);
    reasoningContent = deltaReasoningRaw || messageReasoningRaw || choiceReasoningRaw;
    if (reasoningContent) usedReasoning = true;

    // 提取正文 content（支持自定义字段映射）
    const contentFields = preset?.responseFields?.content ?? ["content", "text"];
    const extractContent = (src: Record<string, unknown>): string => {
      for (const field of contentFields) {
        const r = coerceText(src[field]);
        if (r) return r;
      }
      return "";
    };
    const deltaContent = extractContent(delta);
    if (deltaContent) {
      body = deltaContent;
    } else {
      const messageContent = extractContent(message);
      if (messageContent) {
        body = messageContent;
      } else {
        const choiceText = extractContent(choice);
        if (choiceText) {
          body = choiceText;
        }
      }
    }

    // 解析 tool_calls（支持自定义字段映射）
    const toolCallsField = preset?.responseFields?.toolCalls ?? "tool_calls";
    const rawCalls = (message[toolCallsField] as Record<string, unknown>[]) ?? [];
    const toolCalls: LLMToolCall[] = [];
    for (let i = 0; i < rawCalls.length; i++) {
      const rawCall = rawCalls[i];
      if (!rawCall || typeof rawCall !== "object") continue;
      
      const toolCallNamePath = preset?.responseFields?.toolCallName ?? "function.name";
      const toolCallArgsPath = preset?.responseFields?.toolCallArgs ?? "function.arguments";
      const toolCallIdField = preset?.responseFields?.toolCallId ?? "id";
      
      let name = "";
      let args: unknown;
      
      if (toolCallNamePath === "name") {
        name = String(rawCall.name ?? "").trim();
        args = rawCall.arguments;
      } else {
        const fnPayload = (rawCall.function as Record<string, unknown>) ?? rawCall;
        name = String(fnPayload.name ?? "").trim();
        args = fnPayload.arguments;
      }
      
      if (!name) continue;
      toolCalls.push({
        id: String(rawCall[toolCallIdField] ?? `tool_call_${i}`),
        name,
        parameters: this.parseToolArguments(args),
        provider: "mistral",
        type: String(rawCall.type ?? "function"),
      });
    }

    // 提取结束原因（支持自定义字段映射）
    const finishReasonFields = preset?.responseFields?.finishReason ?? ["finish_reason", "stop_reason"];
    let finishReason: string | null = null;
    for (const field of finishReasonFields) {
      const raw = choice[field];
      if (typeof raw === "string" && raw) {
        finishReason = raw;
        break;
      }
    }

    return { content: body, toolCalls, finishReason, usedReasoning, reasoningContent: reasoningContent || undefined };
  }

  parseStreamEvent(
    data: Record<string, unknown>,
    toolChunks: Map<number, { id: string; name: string; arguments: string }>,
    preset?: APIPreset,
  ): StreamEvent {
    // 流内错误检测
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

    // 处理 tool_calls 流式增量（与 OpenAI 格式一致）
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

    // 提取 content delta（支持自定义字段映射）
    const contentFields = preset?.responseFields?.content ?? ["content", "text"];
    let delta = "";
    for (const field of contentFields) {
      const r = coerceText(deltaPayload[field]);
      if (r) {
        delta = r;
        break;
      }
    }

    // 回退到 choice 顶层（vLLM 模式）
    if (!delta && preset?.streamOptions?.fallbackToChoiceTopLevel !== false) {
      for (const field of contentFields) {
        const r = coerceText(choice[field]);
        if (r) {
          delta = r;
          break;
        }
      }
    }

    // 提取思考/推理内容增量（支持自定义字段映射）
    const reasoningFields = preset?.responseFields?.reasoning ?? [
      "reasoning_content",
      "thinking",
      "thinking_content",
    ];
    let thinking = "";
    for (const field of reasoningFields) {
      const r = coerceText(deltaPayload[field]);
      if (r) {
        thinking = r;
        break;
      }
    }

    // 提取结束原因（支持自定义字段映射）
    const finishReasonFields = preset?.responseFields?.finishReason ?? ["finish_reason", "stop_reason"];
    let finishReason: string | null = null;
    for (const field of finishReasonFields) {
      const raw = choice[field];
      if (typeof raw === "string" && raw) {
        finishReason = raw;
        break;
      }
    }

    return { delta, finishReason, usedReasoning: !!thinking, thinking: thinking || undefined };
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
        provider: "mistral",
        type: "function",
      });
    }
    return toolCalls;
  }

  parseToolArguments = parseToolArguments;
}
