/**
 * Azure OpenAI 适配器
 *
 * Azure OpenAI 使用与 OpenAI Chat Completions 完全兼容的请求/响应格式，
 * 仅在认证方式和 URL 结构上有差异：
 * - 认证使用 `api-key` header（而非 `Authorization: Bearer`）
 * - URL 形如：{endpoint}/openai/deployments/{deployment}/chat/completions?api-version={apiVersion}
 *
 * 由于 OpenAIChatAdapter 的 protocolName 被推断为字面量类型 "openai"，无法通过继承
 * 覆盖为 "azure"，因此采用组合方式：内部委托一个 OpenAIChatAdapter 实例处理所有
 * 通用逻辑（payload 构建、消息归一化、流式/非流式解析、工具调用收集），
 * 仅自行实现 protocolName 与请求头构建。
 */

import { OpenAIChatAdapter } from "./openai.js";
import { parseToolArguments } from "./shared.js";
import type {
  ProtocolAdapter,
  APIPreset,
  ParsedLLMResponse,
  LLMToolCall,
  StreamEvent,
} from "./types.js";

/** api-version 默认值 */
const DEFAULT_API_VERSION = "2024-10-21";

export class AzureOpenAIAdapter implements ProtocolAdapter {
  readonly protocolName = "azure";

  /** 内部委托的 OpenAI Chat 适配器，复用全部通用逻辑 */
  private readonly _openai = new OpenAIChatAdapter();

  /** Azure 使用 api-key header 认证 */
  buildRequestHeaders(preset: APIPreset): Record<string, string> {
    return {
      "api-key": preset.key ?? "",
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0",
    };
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
    return this._openai.buildRequestPayload(params);
  }

  normalizeMessages(messages: Record<string, unknown>[]): Record<string, unknown>[] {
    return this._openai.normalizeMessages(messages);
  }

  parseNonstreamResponse(data: Record<string, unknown>): ParsedLLMResponse {
    return this._openai.parseNonstreamResponse(data);
  }

  parseStreamEvent(
    data: Record<string, unknown>,
    toolChunks: Map<number, { id: string; name: string; arguments: string }>,
  ): StreamEvent {
    return this._openai.parseStreamEvent(data, toolChunks);
  }

  collectToolCalls(
    toolChunks: Map<number, { id: string; name: string; arguments: string }>,
  ): LLMToolCall[] {
    return this._openai.collectToolCalls(toolChunks);
  }

  parseToolArguments = parseToolArguments;
}

/**
 * 读取 Azure 部署名（deployment），默认回退到 preset.model。
 * 供 client 在拼接请求 URL 时使用。
 */
export function resolveAzureDeployment(preset: APIPreset): string {
  const deployment = preset.deployment;
  if (typeof deployment === "string" && deployment.trim()) {
    return deployment.trim();
  }
  return String(preset.model ?? "");
}

/**
 * 读取 Azure api-version，默认 "2024-10-21"。
 * 供 client 在拼接请求 URL 时使用。
 */
export function resolveAzureApiVersion(preset: APIPreset): string {
  const apiVersion = preset.api_version;
  if (typeof apiVersion === "string" && apiVersion.trim()) {
    return apiVersion.trim();
  }
  return DEFAULT_API_VERSION;
}
