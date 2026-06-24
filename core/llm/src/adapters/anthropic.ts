/**
 * Anthropic Messages 适配器
 * 对应 Python: core/llm/adapters/anthropic_messages_adapter.py
 *
 * 使用 @anthropic-ai/sdk 的类型定义增强类型安全性，
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

export class AnthropicMessagesAdapter implements ProtocolAdapter {
  readonly protocolName = "anthropic";

  buildRequestHeaders(preset: APIPreset): Record<string, string> {
    const headers: Record<string, string> = {
      "x-api-key": String(preset.key ?? ""),
      "anthropic-version": String(preset.anthropicVersion ?? "2024-10-22"),
      "Content-Type": "application/json",
    };
    // 1h TTL 长缓存需要 beta 头
    const retention = String(preset.cacheRetention ?? "").toLowerCase();
    if (retention === "long" || retention === "1h" || retention === "60m") {
      headers["anthropic-beta"] = "extended-cache-ttl-2025-04-11";
    }
    // 结构化输出需要 beta 头（2025-11-13 公开 beta，2026 GA）
    const outputFormat = String(preset.output_format ?? "auto");
    if (outputFormat === "json_schema" || outputFormat === "auto") {
      const beta = headers["anthropic-beta"];
      headers["anthropic-beta"] = beta
        ? `${beta},structured-outputs-2025-11-13`
        : "structured-outputs-2025-11-13";
    }
    return headers;
  }

  /**
   * 计算 cache_control 标记（按 preset.cacheRetention）：
   *   none/off          → null（不缓存）
   *   long/1h/60m       → { type:"ephemeral", ttl:"1h" }（1 小时长缓存）
   *   其余(short/5m/默认) → { type:"ephemeral" }（默认 5 分钟）
   */
  private _cacheControl(preset: APIPreset): Record<string, unknown> | null {
    const r = String(preset.cacheRetention ?? "short").toLowerCase();
    if (r === "none" || r === "off") return null;
    if (r === "long" || r === "1h" || r === "60m") return { type: "ephemeral", ttl: "1h" };
    return { type: "ephemeral" };
  }

  private _buildTools(toolSchemas: Record<string, unknown>[] | null | undefined): Record<string, unknown>[] {
    const tools: Record<string, unknown>[] = [];
    for (const schema of toolSchemas ?? []) {
      const name = String((schema as Record<string, unknown>).name ?? "").trim();
      if (!name) continue;
      tools.push({
        name,
        description: String((schema as Record<string, unknown>).description ?? name),
        input_schema: normalizeToolParametersSchema((schema as Record<string, unknown>).parameters),
      });
    }
    return tools;
  }

  normalizeMessages(messages: Record<string, unknown>[]): Record<string, unknown>[] {
    const systemParts: string[] = [];
    const normalized: Record<string, unknown>[] = [];

    for (const message of messages) {
      const role = String(message.role ?? "");
      const rawContent = message.content;

      if (role === "system") {
        const content = typeof rawContent === "string" ? rawContent : "";
        if (content.trim()) systemParts.push(content);
        continue;
      }
      if (role === "tool") {
        const toolCallId = message.tool_call_id;
        if (toolCallId) {
          const content = typeof rawContent === "string" ? rawContent : String(rawContent ?? "");
          normalized.push({
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: toolCallId,
                content,
              },
            ],
          });
          continue;
        }
        const content = typeof rawContent === "string" ? rawContent : String(rawContent ?? "");
        normalized.push({
          role: "user",
          content: `[工具结果]: "${content}"`,
        });
        continue;
      }
      if (role !== "user" && role !== "assistant") continue;

      // 处理多模态 user 消息（content 为数组）
      if (role === "user" && Array.isArray(rawContent)) {
        const anthropicParts = this._convertMultimodalContent(rawContent);
        normalized.push({ role: "user", content: anthropicParts });
        continue;
      }

      normalized.push({ role, content: typeof rawContent === "string" ? rawContent : String(rawContent ?? "") });
    }

    // 合并连续 user 消息（Anthropic 要求 user/assistant 交替）
    return this._mergeConsecutiveUserMessages(normalized);
  }

  /** 将 OpenAI 格式的多模态内容转换为 Anthropic 格式 */
  private _convertMultimodalContent(parts: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    const result: Array<Record<string, unknown>> = [];
    for (const part of parts) {
      if (part.type === "image_url") {
        // 若有 _document 字段（ChatSession 为 document 附件附加的 Anthropic 原生格式），优先用
        if (part._document) {
          result.push(part._document as Record<string, unknown>);
          continue;
        }
        const imageUrl = (part.image_url as Record<string, unknown>)?.url as string ?? "";
        const dataUriMatch = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (dataUriMatch) {
          result.push({
            type: "image",
            source: {
              type: "base64",
              media_type: dataUriMatch[1],
              data: dataUriMatch[2],
            },
          });
        }
      } else if (part.type === "input_audio") {
        // OpenAI 风格音频 → Anthropic 暂不直接支持音频输入，转文本描述
        const audio = part.input_audio as Record<string, unknown> | undefined;
        const fmt = audio?.format ?? "mp3";
        result.push({ type: "text", text: `[音频附件 (${fmt})，Anthropic 暂不支持音频输入]` });
      } else if (part.type === "text") {
        result.push({ type: "text", text: String(part.text ?? "") });
      }
    }
    return result;
  }

  /** 合并连续 user 消息 */
  private _mergeConsecutiveUserMessages(messages: Record<string, unknown>[]): Record<string, unknown>[] {
    const merged: Record<string, unknown>[] = [];
    for (const msg of messages) {
      const last = merged[merged.length - 1];
      if (last && last.role === "user" && msg.role === "user") {
        // 合并内容
        const lastContent = last.content;
        const curContent = msg.content;
        if (Array.isArray(lastContent) && Array.isArray(curContent)) {
          (lastContent as unknown[]).push(...curContent);
        } else if (Array.isArray(lastContent)) {
          (lastContent as unknown[]).push({ type: "text", text: typeof curContent === "string" ? curContent : String(curContent ?? "") });
        } else if (Array.isArray(curContent)) {
          const newContent: unknown[] = [
            { type: "text", text: typeof lastContent === "string" ? lastContent : String(lastContent ?? "") },
            ...curContent,
          ];
          last.content = newContent;
        } else {
          last.content = String(lastContent ?? "") + "\n" + String(curContent ?? "");
        }
      } else {
        merged.push(msg);
      }
    }
    return merged;
  }

  private _extractSystemMessage(messages: Record<string, unknown>[]): string {
    const parts: string[] = [];
    for (const message of messages) {
      if (String(message.role ?? "") === "system") {
        const content = String(message.content ?? "");
        if (content.trim()) parts.push(content);
      }
    }
    return parts.join("\n\n");
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
    const anthropicMessages = this.normalizeMessages(messages);
    const systemPrompt = this._extractSystemMessage(messages);

    const payload: Record<string, unknown> = {
      model: preset.model,
      max_tokens: Math.min(Number(preset.maxTokens ?? 65536) || 65536, MAX_TOKENS_CAP),
      messages: anthropicMessages,
      stream,
    };

    // system prompt：使用数组格式，支持 cache_control 标记
    // Anthropic Prompt Caching：system/tools/messages 中标记 cache_control 的内容会被缓存
    // 缓存命中部分 90% 折扣（只收 10%），最低 1024 tokens 触发。TTL 由 cacheRetention 决定。
    const cacheControl = this._cacheControl(preset);
    if (systemPrompt.trim()) {
      const sysBlock: Record<string, unknown> = { type: "text", text: systemPrompt };
      if (cacheControl) sysBlock.cache_control = cacheControl;
      payload.system = [sysBlock];
    }

    if (nativeToolCalling) {
      const tools = this._buildTools(toolSchemas);
      if (tools.length) {
        // 给最后一个工具添加 cache_control 标记（缓存整个工具列表）
        if (cacheControl) {
          const lastTool = tools[tools.length - 1] as Record<string, unknown>;
          lastTool.cache_control = cacheControl;
        }
        payload.tools = tools;
        payload.tool_choice = { type: "auto" };
      }
    }

    // 结构化输出：Anthropic output_format（2025-11-13 beta / 2026 GA）
    // 仅当无工具调用时注入（避免与 tool_choice 冲突）
    const outputFormat = String(preset.output_format ?? "auto");
    if (outputFormat !== "none" && !nativeToolCalling && jsonSettings) {
      const schemaStr = (jsonSettings as Record<string, unknown>).schema_template as string | undefined;
      if (schemaStr && (outputFormat === "json_schema" || outputFormat === "auto")) {
        try {
          const schemaObj = JSON.parse(schemaStr);
          if (schemaObj && typeof schemaObj === "object") {
            payload.output_format = {
              type: "json_schema",
              schema: schemaObj,
            };
          }
        } catch {
          // schema 解析失败，回退到 prompt 强化（已通过 {{OUTPUT.jsonc}} 嵌入）
        }
      }
    }

    // 给最后一条 user 消息添加 cache_control 标记（缓存历史对话上下文）
    if (cacheControl) this._markLastUserMessageCache(anthropicMessages, cacheControl);

    // 注入 reasoning_params —— Anthropic 用 thinking 字段控制扩展思考
    // 格式：thinking: { type: "enabled" | "disabled", budget_tokens: number }
    const reasoningParams = preset.reasoning_params;
    if (reasoningParams && typeof reasoningParams === "object") {
      const rp = reasoningParams as Record<string, unknown>;
      // thinking 字段直接透传（Anthropic 原生格式）
      if (rp.thinking && typeof rp.thinking === "object") {
        payload.thinking = rp.thinking;
      } else if (rp.reasoning_effort) {
        // 兼容 OpenAI 风格 reasoning_effort → 转 Anthropic thinking
        const effort = String(rp.reasoning_effort);
        const budget = effort === "low" ? 1024 : effort === "medium" ? 4096 : effort === "high" ? 16384 : 4096;
        payload.thinking = { type: "enabled", budget_tokens: budget };
      }
    }
    return payload;
  }

  /**
   * 给最后一条 user 消息添加 cache_control 标记
   * Anthropic 缓存策略：标记了 cache_control 的内容块会被缓存
   * 这样整个对话历史（到最后一条 user 消息为止）都会被缓存
   */
  private _markLastUserMessageCache(messages: Record<string, unknown>[], cacheControl: Record<string, unknown>): void {
    // 从后往前找最后一条 user 消息
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (String(msg.role ?? "") !== "user") continue;

      const content = msg.content;
      if (typeof content === "string") {
        // 纯文本 → 转为数组格式，添加 cache_control
        msg.content = [{
          type: "text",
          text: content,
          cache_control: cacheControl,
        }];
      } else if (Array.isArray(content) && content.length > 0) {
        // 数组格式 → 给最后一个元素添加 cache_control
        const lastBlock = content[content.length - 1] as Record<string, unknown>;
        if (lastBlock && typeof lastBlock === "object") {
          lastBlock.cache_control = cacheControl;
        }
      }
      return;
    }
  }

  private _extractTextFromBlocks(blocks: unknown[]): string {
    const parts: string[] = [];
    for (const block of blocks) {
      if (block && typeof block === "object") {
        const b = block as Record<string, unknown>;
        if (b.type === "text" && typeof b.text === "string") {
          parts.push(b.text);
        }
      }
    }
    return parts.join("");
  }

  /** 从 content blocks 提取思考/推理内容（type === "thinking"） */
  private _extractThinkingFromBlocks(blocks: unknown[]): string {
    const parts: string[] = [];
    for (const block of blocks) {
      if (block && typeof block === "object") {
        const b = block as Record<string, unknown>;
        if (b.type === "thinking" && typeof b.thinking === "string") {
          parts.push(b.thinking);
        }
      }
    }
    return parts.join("");
  }

  private _extractToolCallsFromBlocks(blocks: unknown[]): LLMToolCall[] {
    const calls: LLMToolCall[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (!block || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;
      if (b.type !== "tool_use") continue;
      const name = String(b.name ?? "").trim();
      if (!name) continue;
      const inputPayload = b.input;
      calls.push({
        id: String(b.id ?? `toolu_${i}`),
        name,
        parameters: inputPayload && typeof inputPayload === "object" && !Array.isArray(inputPayload)
          ? inputPayload as Record<string, unknown>
          : {},
        provider: "anthropic",
        type: "tool_use",
      });
    }
    return calls;
  }

  parseNonstreamResponse(data: Record<string, unknown>): ParsedLLMResponse {
    const error = data.error as Record<string, unknown> | undefined;
    if (error?.type) {
      throw new Error(`Anthropic API error ${error.type}: ${error.message}`);
    }

    const contentBlocks = (data.content as unknown[]) ?? [];
    const body = this._extractTextFromBlocks(contentBlocks);
    const reasoningContent = this._extractThinkingFromBlocks(contentBlocks);
    const toolCalls = this._extractToolCallsFromBlocks(contentBlocks);
    const stopReasonRaw = data.stop_reason;
    const finishReason =
      typeof stopReasonRaw === "string" && stopReasonRaw ? stopReasonRaw : null;

    return { content: body, toolCalls, finishReason, usedReasoning: !!reasoningContent, reasoningContent: reasoningContent || undefined };
  }

  parseStreamEvent(
    data: Record<string, unknown>,
    toolChunks: Map<number, { id: string; name: string; arguments: string }>,
  ): StreamEvent {
    // 流内错误检测：Anthropic 错误事件 type:"error"，data.error:{type,message}
    const eventType = String(data.type ?? "");
    if (eventType === "error" || data.error) {
      const errObj = (data.error as Record<string, unknown>) ?? data;
      const errMsg = String(errObj.message ?? errObj.type ?? JSON.stringify(data));
      throw new Error(`LLM stream error: ${errMsg}`);
    }

    const blockIndex = data.index;
    const blockIndexInt = typeof blockIndex === "number" ? blockIndex : 0;

    // content_block_start with tool_use
    if (eventType === "content_block_start") {
      const contentBlock = data.content_block as Record<string, unknown> | undefined;
      if (contentBlock?.type === "tool_use") {
        toolChunks.set(blockIndexInt, {
          id: String(contentBlock.id ?? `toolu_${blockIndexInt}`),
          name: String(contentBlock.name ?? ""),
          arguments: "",
        });
      }
    }

    // content_block_delta with partial_json for tool arguments
    const eventDelta = data.delta as Record<string, unknown> | undefined;
    if (
      eventType === "content_block_delta" &&
      toolChunks.has(blockIndexInt) &&
      eventDelta &&
      typeof eventDelta.partial_json === "string"
    ) {
      const chunk = toolChunks.get(blockIndexInt)!;
      chunk.arguments += eventDelta.partial_json;
      return { delta: "", finishReason: null, usedReasoning: false };
    }

    // 提取正文 delta 和思考 delta（独立字段）
    const delta = this._extractDelta(data);
    const thinking = this._extractThinkingDelta(data);
    const finishReason = this._extractFinishReason(data);

    return { delta, finishReason, usedReasoning: !!thinking, thinking: thinking || undefined };
  }

  /** 提取流式思考内容增量（thinking_delta 事件） */
  private _extractThinkingDelta(data: Record<string, unknown>): string {
    const eventType = String(data.type ?? "");
    if (eventType !== "content_block_delta") return "";
    const delta = (data.delta as Record<string, unknown>) ?? {};
    const deltaType = String(delta.type ?? "");
    // Anthropic 扩展思考的 delta 类型是 thinking_delta，内容在 thinking 字段
    if (deltaType === "thinking_delta" && typeof delta.thinking === "string") {
      return delta.thinking;
    }
    // 兼容 signature_delta（思考签名，可忽略但避免误判为正文）
    if (deltaType === "signature_delta") return "";
    return "";
  }

  private _extractDelta(data: Record<string, unknown>): string {
    const eventType = String(data.type ?? "");
    if (eventType !== "content_block_delta") return "";
    const delta = (data.delta as Record<string, unknown>) ?? {};
    const deltaType = String(delta.type ?? "");
    // 跳过 thinking_delta / signature_delta，它们由 _extractThinkingDelta 处理
    if (deltaType === "thinking_delta" || deltaType === "signature_delta") return "";
    if (deltaType === "text_delta") return String(delta.text ?? "");
    if (typeof delta.partial_json === "string") return delta.partial_json;
    if (typeof delta.text === "string") return delta.text;
    return "";
  }

  private _extractFinishReason(data: Record<string, unknown>): string | null {
    const eventType = String(data.type ?? "");
    if (eventType === "message_delta") {
      const delta = (data.delta as Record<string, unknown>) ?? {};
      const stopReason = delta.stop_reason;
      if (typeof stopReason === "string" && stopReason) return stopReason;
    }
    const stopReason = data.stop_reason;
    if (typeof stopReason === "string" && stopReason) return stopReason;
    return null;
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
        id: chunk.id || `toolu_${index}`,
        name,
        parameters: this.parseToolArguments(chunk.arguments),
        provider: "anthropic",
        type: "tool_use",
      });
    }
    return toolCalls;
  }

  parseToolArguments = parseToolArguments;
}
