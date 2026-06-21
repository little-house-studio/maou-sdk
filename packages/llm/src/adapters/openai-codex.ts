/**
 * OpenAI Codex 适配器
 *
 * 实现 ProtocolAdapter 接口，使用 OpenAI Responses API 格式（与 openai-responses.ts
 * 几乎完全一致），区别主要在于认证与额外的 Codex 专属请求头：
 *   1. 认证使用 `Authorization: Bearer {key}`（key 为 OAuth token）。
 *   2. 额外携带 `OpenAI-Beta: responses=v1` 与 `originator: codex_cli_rs`，
 *      用于标识 codex CLI。
 *
 * 因此本适配器复用 Responses API 的全部逻辑，仅覆盖 buildRequestHeaders 与 protocolName。
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

export class OpenAICodexAdapter implements ProtocolAdapter {
  /** item_id 字符串 → 数字索引映射（Responses API 的 item_id 是字符串如 "fc_abc"） */
  private _itemIdIndexMap = new Map<string, number>();
  private _nextToolIndex = 0;

  private _resolveItemIdIndex(itemId: unknown): number {
    const idStr = String(itemId ?? "");
    if (!idStr) return 0;
    let idx = this._itemIdIndexMap.get(idStr);
    if (idx === undefined) {
      idx = this._nextToolIndex++;
      this._itemIdIndexMap.set(idStr, idx);
    }
    return idx;
  }

  /** 重置工具索引映射（每次新调用前应调用） */
  resetToolTracking(): void {
    this._itemIdIndexMap.clear();
    this._nextToolIndex = 0;
  }
  readonly protocolName = "openai-codex";

  buildRequestHeaders(preset: APIPreset): Record<string, string> {
    // Codex 使用 OAuth token，并携带 codex CLI 专属请求头
    return {
      Authorization: `Bearer ${preset.key ?? ""}`,
      "Content-Type": "application/json",
      "OpenAI-Beta": "responses=v1",
      originator: "codex_cli_rs",
    };
  }

  private _buildTools(toolSchemas: Record<string, unknown>[] | null | undefined): Record<string, unknown>[] {
    const tools: Record<string, unknown>[] = [];
    for (const schema of toolSchemas ?? []) {
      const name = String((schema as Record<string, unknown>).name ?? "").trim();
      if (!name) continue;
      tools.push({
        type: "function",
        name,
        description: String((schema as Record<string, unknown>).description ?? name),
        parameters: normalizeToolParametersSchema((schema as Record<string, unknown>).parameters),
      });
    }
    return tools;
  }

  normalizeMessages(messages: Record<string, unknown>[]): Record<string, unknown>[] {
    const normalized: Record<string, unknown>[] = [];
    for (const message of messages) {
      const role = String(message.role ?? "");
      const content = String(message.content ?? "");
      if (role === "system") {
        normalized.push({ role: "system", content });
      } else if (role === "user") {
        normalized.push({ role: "user", content });
      } else if (role === "assistant") {
        normalized.push({ role: "assistant", content });
      } else if (role === "tool") {
        const toolCallId = message.tool_call_id;
        if (toolCallId) {
          normalized.push({
            type: "function_call_output",
            call_id: toolCallId,
            output: content,
          });
        } else {
          normalized.push({ role: "user", content });
        }
      }
    }
    return normalized;
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
    const { preset, messages, stream, toolSchemas, nativeToolCalling } = params;
    const payload: Record<string, unknown> = {
      model: preset.model,
      input: this.normalizeMessages(messages),
      stream,
      max_output_tokens: Math.min(Number(preset.maxTokens ?? 65536) || 65536, MAX_TOKENS_CAP),
    };
    if (nativeToolCalling) {
      const tools = this._buildTools(toolSchemas);
      if (tools.length) {
        payload.tools = tools;
        payload.tool_choice = "auto";
      }
    }
    // 注入 reasoning_params —— Responses API 用 reasoning 参数控制思考
    // 格式：reasoning: { effort: "low" | "medium" | "high", summary: "auto" | "concise" | "detailed" }
    const reasoningParams = preset.reasoning_params;
    if (reasoningParams && typeof reasoningParams === "object") {
      const rp = reasoningParams as Record<string, unknown>;
      if (rp.thinking && typeof rp.thinking === "object") {
        // Anthropic 风格 thinking → Responses 风格 reasoning.effort
        const thinking = rp.thinking as Record<string, unknown>;
        if (thinking.type === "enabled") {
          const budget = Number(thinking.budget_tokens ?? 0);
          payload.reasoning = {
            effort: budget <= 2048 ? "low" : budget <= 8192 ? "medium" : "high",
            summary: "auto",
          };
        }
      } else if (rp.reasoning_effort) {
        // OpenAI 风格 reasoning_effort → Responses reasoning.effort
        payload.reasoning = { effort: String(rp.reasoning_effort), summary: "auto" };
      } else if (rp.reasoning) {
        // 已是 Responses 格式
        payload.reasoning = rp.reasoning;
      }
    }
    return payload;
  }

  parseNonstreamResponse(data: Record<string, unknown>): ParsedLLMResponse {
    const outputItems = (data.output as Record<string, unknown>[]) ?? [];
    let body = "";
    let reasoningContent = "";
    const toolCalls: LLMToolCall[] = [];

    for (const item of outputItems) {
      if (!item || typeof item !== "object") continue;
      const itemType = item.type;
      if (itemType === "message") {
        const contentBlocks = (item.content as Record<string, unknown>[]) ?? [];
        for (const block of contentBlocks) {
          if (block && typeof block === "object") {
            if (block.type === "output_text") {
              body += String(block.text ?? "");
            } else if (block.type === "refusal") {
              body += String(block.refusal ?? "");
            }
          }
        }
      } else if (itemType === "reasoning") {
        // Responses API 的推理内容在 reasoning item 的 summary/content 里
        const summary = (item.summary as Record<string, unknown>[]) ?? [];
        const content = (item.content as Record<string, unknown>[]) ?? [];
        for (const block of [...summary, ...content]) {
          if (block && typeof block === "object") {
            if (block.type === "summary_text" && typeof block.text === "string") {
              reasoningContent += block.text;
            } else if (block.type === "reasoning_text" && typeof block.text === "string") {
              reasoningContent += block.text;
            } else if (typeof block.text === "string") {
              reasoningContent += block.text;
            }
          }
        }
      } else if (itemType === "function_call") {
        const name = String(item.name ?? "").trim();
        if (name) {
          toolCalls.push({
            id: String(item.id ?? ""),
            name,
            parameters: this.parseToolArguments(item.arguments),
            provider: "openai-codex",
            type: "function_call",
          });
        }
      }
    }

    const finishReason = typeof data.status === "string" && data.status ? data.status : null;
    return { content: body, toolCalls, finishReason, usedReasoning: !!reasoningContent, reasoningContent: reasoningContent || undefined };
  }

  parseStreamEvent(
    data: Record<string, unknown>,
    toolChunks: Map<number, { id: string; name: string; arguments: string }>,
  ): StreamEvent {
    const eventType = String(data.type ?? "");
    // 流内错误检测：Responses API 错误 response.error 或 data.error
    if (eventType === "response.error" || eventType === "error" || data.error) {
      const errObj = (data.error as Record<string, unknown>) ?? data;
      const errMsg = String(errObj.message ?? errObj.code ?? JSON.stringify(data));
      throw new Error(`LLM stream error: ${errMsg}`);
    }
    let delta = "";
    let thinking = "";

    if (eventType === "response.output_text.delta") {
      delta = String(data.delta ?? "");
    } else if (eventType === "response.reasoning_summary_text.delta" || eventType === "response.reasoning_text.delta" || eventType === "response.reasoning_summary_text.done") {
      // Responses API 流式推理内容增量
      thinking = String(data.delta ?? "");
    } else if (eventType === "response.function_call_arguments.delta") {
      const idx = this._resolveItemIdIndex(data.item_id);
      let chunk = toolChunks.get(idx);
      if (!chunk) {
        chunk = { id: String(data.item_id ?? ""), name: "", arguments: "" };
        toolChunks.set(idx, chunk);
      }
      chunk.arguments += String(data.delta ?? "");
    } else if (eventType === "response.function_call_arguments.done") {
      const idx = this._resolveItemIdIndex(data.item_id);
      let chunk = toolChunks.get(idx);
      if (!chunk) {
        chunk = { id: String(data.item_id ?? ""), name: "", arguments: "" };
        toolChunks.set(idx, chunk);
      }
      chunk.id = String(data.item_id ?? chunk.id);
      const nameData = data.name;
      if (nameData) {
        chunk.name = String(nameData);
      }
    }

    const finishReasonRaw = data.finish_reason ?? data.status;
    const finishReason =
      typeof finishReasonRaw === "string" && finishReasonRaw ? finishReasonRaw : null;

    return { delta, finishReason, usedReasoning: !!thinking, thinking: thinking || undefined };
  }

  collectToolCalls(
    toolChunks: Map<number, { id: string; name: string; arguments: string }>,
  ): LLMToolCall[] {
    const toolCalls: LLMToolCall[] = [];
    const sorted = [...toolChunks.entries()].sort((a, b) => a[0] - b[0]);
    for (const [, chunk] of sorted) {
      const name = chunk.name.trim();
      if (!name) continue;
      toolCalls.push({
        id: chunk.id || "",
        name,
        parameters: this.parseToolArguments(chunk.arguments),
        provider: "openai-codex",
        type: "function_call",
      });
    }
    return toolCalls;
  }

  parseToolArguments = parseToolArguments;
}
