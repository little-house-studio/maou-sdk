/**
 * Cloudflare Workers AI 适配器
 *
 * Cloudflare Workers AI 提供 OpenAI 兼容端点，请求/响应格式与 OpenAI Chat
 * Completions 完全一致，认证方式也是 `Authorization: Bearer {key}`。
 * 唯一差异在于 URL 中包含 `{CLOUDFLARE_ACCOUNT_ID}` 占位符，需要在发请求前
 * 替换为实际账号 ID（来自 preset.account_id 或环境变量 CLOUDFLARE_ACCOUNT_ID）。
 *
 * 由于 ProtocolAdapter 接口当前没有 buildRequestUrl 方法，占位符替换逻辑
 * 以导出纯函数 resolveCloudflareUrl 的形式提供，供 client 在发请求前调用，
 * 同时也便于单元测试。
 *
 * 由于 OpenAIChatAdapter 的 protocolName 被推断为字面量类型 "openai"，无法通过继承
 * 覆盖为 "cloudflare"，因此采用组合方式：内部委托一个 OpenAIChatAdapter 实例处理
 * 所有通用逻辑，仅自行实现 protocolName 与请求头构建。
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

/**
 * 解析 Cloudflare 请求 URL：把 {CLOUDFLARE_ACCOUNT_ID} 占位符替换为实际账号 ID。
 * 账号 ID 优先取 preset.account_id，其次回退到环境变量 CLOUDFLARE_ACCOUNT_ID。
 */
export function resolveCloudflareUrl(url: string, preset: APIPreset): string {
  if (!url) return url;
  const presetAccountId =
    typeof preset.account_id === "string" ? preset.account_id.trim() : "";
  const accountId = presetAccountId || process.env.CLOUDFLARE_ACCOUNT_ID || "";
  return url.replace(/\{CLOUDFLARE_ACCOUNT_ID\}/g, accountId);
}

export class CloudflareAdapter implements ProtocolAdapter {
  readonly protocolName = "cloudflare";

  /** 内部委托的 OpenAI Chat 适配器，复用全部通用逻辑 */
  private readonly _openai = new OpenAIChatAdapter();

  /** Cloudflare 使用标准 Bearer 认证 */
  buildRequestHeaders(preset: APIPreset): Record<string, string> {
    return {
      Authorization: `Bearer ${preset.key ?? ""}`,
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

  /** 占位符替换辅助函数（内部保留，便于测试与 client 调用） */
  resolveRequestUrl(url: string, preset: APIPreset): string {
    return resolveCloudflareUrl(url, preset);
  }

  parseToolArguments = parseToolArguments;
}
