/**
 * Google Gemini 适配器
 *
 * 实现 ProtocolAdapter 接口，将统一消息格式转换为 Google Gemini API 格式。
 * Gemini API 使用 generateContent / streamGenerateContent 端点，
 * 消息格式与 OpenAI / Anthropic 均不同。
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
import { parseToolArguments, normalizeToolParametersSchema, MAX_TOKENS_CAP } from "./shared.js";

export class GoogleGeminiAdapter implements ProtocolAdapter {
  readonly protocolName = "google";

  buildRequestHeaders(preset: APIPreset): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "x-goog-api-key": String(preset.key ?? ""),
    };
  }

  private _buildTools(toolSchemas: Record<string, unknown>[] | null | undefined): Record<string, unknown>[] {
    const tools: Record<string, unknown>[] = [];
    const functionDeclarations: Record<string, unknown>[] = [];
    for (const schema of toolSchemas ?? []) {
      const name = String((schema as Record<string, unknown>).name ?? "").trim();
      if (!name) continue;
      functionDeclarations.push({
        name,
        description: String((schema as Record<string, unknown>).description ?? name),
        parameters: normalizeToolParametersSchema((schema as Record<string, unknown>).parameters),
      });
    }
    if (functionDeclarations.length > 0) {
      tools.push({ functionDeclarations });
    }
    return tools;
  }

  /**
   * 将 OpenAI 风格的消息数组转换为 Gemini contents 格式
   * Gemini 使用 "user" / "model" 两种角色（assistant → model）
   */
  normalizeMessages(messages: Record<string, unknown>[]): Record<string, unknown>[] {
    const contents: Record<string, unknown>[] = [];
    let systemInstruction = "";

    for (const message of messages) {
      const role = String(message.role ?? "");
      const rawContent = message.content;

      if (role === "system") {
        const content = typeof rawContent === "string" ? rawContent : "";
        if (content.trim()) systemInstruction += (systemInstruction ? "\n\n" : "") + content;
        continue;
      }
      if (role === "tool") {
        // 工具结果作为 user 消息注入
        const toolCallId = message.tool_call_id;
        const content = typeof rawContent === "string" ? rawContent : String(rawContent ?? "");
        contents.push({
          role: "user",
          parts: [{ text: `[工具结果 ${toolCallId ?? ""}]: ${content}` }],
        });
        continue;
      }

      const geminiRole = role === "assistant" ? "model" : "user";

      // 处理多模态内容
      if (Array.isArray(rawContent)) {
        const parts = this._convertMultimodalContent(rawContent);
        contents.push({ role: geminiRole, parts });
        continue;
      }

      // 处理 assistant 消息中的 tool_calls
      const toolCalls = (message as Record<string, unknown>).tool_calls as Record<string, unknown>[] | undefined;
      if (toolCalls && toolCalls.length > 0) {
        const parts: Record<string, unknown>[] = [];
        // 如果有文本内容，先加文本
        if (typeof rawContent === "string" && rawContent.trim()) {
          parts.push({ text: rawContent });
        }
        for (const tc of toolCalls) {
          const fn = (tc.function as Record<string, unknown>) ?? tc;
          parts.push({
            functionCall: {
              name: String(fn.name ?? ""),
              args: fn.arguments && typeof fn.arguments === "string"
                ? this.parseToolArguments(fn.arguments)
                : (fn.arguments as Record<string, unknown> ?? {}),
            },
          });
        }
        contents.push({ role: geminiRole, parts });
        continue;
      }

      contents.push({
        role: geminiRole,
        parts: [{ text: typeof rawContent === "string" ? rawContent : String(rawContent ?? "") }],
      });
    }

    // 将 systemInstruction 存储在第一个消息的 _systemInstruction 字段中
    // buildRequestPayload 会提取它
    if (systemInstruction && contents.length > 0) {
      (contents[0] as Record<string, unknown>)._systemInstruction = systemInstruction;
    }

    return contents;
  }

  /** 将 OpenAI 格式的多模态内容转换为 Gemini 格式 */
  private _convertMultimodalContent(parts: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    const result: Array<Record<string, unknown>> = [];
    for (const part of parts) {
      if (part.type === "image_url") {
        const imageUrl = (part.image_url as Record<string, unknown>)?.url as string ?? "";
        const dataUriMatch = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (dataUriMatch) {
          result.push({
            inlineData: {
              mimeType: dataUriMatch[1],
              data: dataUriMatch[2],
            },
          });
        }
      } else if (part.type === "text") {
        result.push({ text: String(part.text ?? "") });
      }
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
    const contents = this.normalizeMessages(messages);

    // 提取 systemInstruction
    let systemInstruction: string | undefined;
    if (contents.length > 0) {
      const first = contents[0] as Record<string, unknown>;
      if (first._systemInstruction) {
        systemInstruction = String(first._systemInstruction);
        delete first._systemInstruction;
      }
    }

    const payload: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: Math.min(Number(preset.maxTokens ?? 65536) || 65536, MAX_TOKENS_CAP),
      },
    };

    if (systemInstruction) {
      payload.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    if (nativeToolCalling) {
      const tools = this._buildTools(toolSchemas);
      if (tools.length) {
        payload.tools = tools;
        payload.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
      }
    }

    // jsonSettings → 注入 responseMimeType 强制 JSON 输出
    if (jsonSettings) {
      payload.generationConfig = {
        ...(payload.generationConfig as Record<string, unknown>),
        responseMimeType: "application/json",
      };
      const schemaStr = jsonSettings.schema_template ?? jsonSettings.schema;
      if (schemaStr) {
        let schemaObj: unknown;
        try {
          schemaObj = typeof schemaStr === "string" ? JSON.parse(schemaStr) : schemaStr;
        } catch { /* 解析失败 */ }
        if (schemaObj && typeof schemaObj === "object") {
          payload.generationConfig = {
            ...(payload.generationConfig as Record<string, unknown>),
            responseSchema: schemaObj,
          };
        }
      }
    }

    // 注入 reasoning_params —— Gemini 用 thinkingConfig 控制思考
    const reasoningParams = preset.reasoning_params;
    if (reasoningParams && typeof reasoningParams === "object") {
      const rp = reasoningParams as Record<string, unknown>;
      if (rp.thinking && typeof rp.thinking === "object") {
        const thinking = rp.thinking as Record<string, unknown>;
        if (thinking.type === "enabled") {
          const budget = Number(thinking.budget_tokens ?? 0);
          (payload.generationConfig as Record<string, unknown>).thinkingConfig = {
            thinkingBudget: Math.min(budget, 32768),
          };
        } else if (thinking.type === "disabled") {
          (payload.generationConfig as Record<string, unknown>).thinkingConfig = {
            thinkingBudget: 0,
          };
        }
      } else if (rp.reasoning_effort) {
        const effort = String(rp.reasoning_effort);
        const budget = effort === "low" ? 1024 : effort === "medium" ? 8192 : 32768;
        (payload.generationConfig as Record<string, unknown>).thinkingConfig = {
          thinkingBudget: budget,
        };
      }
    }

    return payload;
  }

  parseNonstreamResponse(data: Record<string, unknown>): ParsedLLMResponse {
    const candidates = (data.candidates as Record<string, unknown>[]) ?? [];
    const candidate = candidates[0] ?? {};
    const content = (candidate.content as Record<string, unknown>) ?? {};
    const parts = (content.parts as Record<string, unknown>[]) ?? [];

    let body = "";
    let reasoningContent = "";
    const toolCalls: LLMToolCall[] = [];

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part || typeof part !== "object") continue;

      const isThoughtFlag = part.thought === true;
      const thoughtStr = typeof part.thought === "string" ? part.thought : "";

      // 思考内容：thought 字符串 或 thought=true 标记的 text
      if (thoughtStr) {
        reasoningContent += thoughtStr;
      }
      if (isThoughtFlag && typeof part.text === "string") {
        reasoningContent += part.text;
      }

      // 正文：仅当 text 不是思考内容时才加入 body
      if (typeof part.text === "string" && !isThoughtFlag) {
        body += part.text;
      }

      if (part.functionCall && typeof part.functionCall === "object") {
        const fc = part.functionCall as Record<string, unknown>;
        const name = String(fc.name ?? "").trim();
        if (name) {
          toolCalls.push({
            id: `gemini_call_${i}`,
            name,
            parameters: fc.args && typeof fc.args === "object"
              ? fc.args as Record<string, unknown>
              : this.parseToolArguments(fc.args),
            provider: "google",
            type: "functionCall",
          });
        }
      }
    }

    const finishReasonRaw = candidate.finishReason;
    const finishReason =
      typeof finishReasonRaw === "string" && finishReasonRaw ? finishReasonRaw : null;

    return {
      content: body,
      toolCalls,
      finishReason,
      usedReasoning: !!reasoningContent,
      reasoningContent: reasoningContent || undefined,
    };
  }

  parseStreamEvent(
    data: Record<string, unknown>,
    toolChunks: Map<number, { id: string; name: string; arguments: string }>,
  ): StreamEvent {
    // Gemini 流式错误检测
    if (data.error) {
      const errMsg = typeof data.error === "object"
        ? String((data.error as Record<string, unknown>).message ?? JSON.stringify(data.error))
        : String(data.error);
      throw new Error(`LLM stream error: ${errMsg}`);
    }

    const candidates = (data.candidates as Record<string, unknown>[]) ?? [];
    const candidate = candidates[0] ?? {};
    const content = (candidate.content as Record<string, unknown>) ?? {};
    const parts = (content.parts as Record<string, unknown>[]) ?? [];

    let delta = "";
    let thinking = "";

    for (const part of parts) {
      if (!part || typeof part !== "object") continue;

      if (typeof part.text === "string") {
        if (part.thought === true) {
          thinking += part.text;
        } else {
          delta += part.text;
        }
      }
      if (typeof part.thought === "string") {
        thinking += part.thought;
      }
      if (part.functionCall && typeof part.functionCall === "object") {
        const fc = part.functionCall as Record<string, unknown>;
        const name = String(fc.name ?? "").trim();
        if (name) {
          const callIndex = toolChunks.size;
          toolChunks.set(callIndex, {
            id: `gemini_call_${callIndex}`,
            name,
            arguments: fc.args ? JSON.stringify(fc.args) : "",
          });
        }
      }
    }

    const finishReasonRaw = candidate.finishReason;
    const finishReason =
      typeof finishReasonRaw === "string" && finishReasonRaw ? finishReasonRaw : null;

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
        id: chunk.id || `gemini_call_${index}`,
        name,
        parameters: this.parseToolArguments(chunk.arguments),
        provider: "google",
        type: "functionCall",
      });
    }
    return toolCalls;
  }

  parseToolArguments = parseToolArguments;
}
