/**
 * 协议适配器路由 — ProtocolGateway
 * 对齐 Python: core/llm/adapters/router.py
 *
 * 根据协议名称返回对应的适配器实例。
 * 路由:
 *   "openai" → OpenAIChatAdapter
 *   "anthropic" → AnthropicMessagesAdapter
 *   "responses" → OpenAIResponsesAdapter
 *   "google" → GoogleGeminiAdapter
 *   "mistral" → MistralAdapter
 *   "bedrock" → BedrockAdapter
 *   "azure" → AzureOpenAIAdapter
 *   "cloudflare" → CloudflareAdapter
 *   "google-vertex" → GoogleVertexAdapter
 *   "openai-codex" → OpenAICodexAdapter
 *   "github-copilot" → GitHubCopilotAdapter
 */

import type { ProtocolAdapter } from "./types.js";
import { OpenAIChatAdapter } from "./openai.js";
import { AnthropicMessagesAdapter } from "./anthropic.js";
import { OpenAIResponsesAdapter } from "./openai-responses.js";
import { GoogleGeminiAdapter } from "./google.js";
import { MistralAdapter } from "./mistral.js";
import { BedrockAdapter } from "./bedrock.js";
import { AzureOpenAIAdapter } from "./azure-openai.js";
import { CloudflareAdapter } from "./cloudflare.js";
import { GoogleVertexAdapter } from "./google-vertex.js";
import { OpenAICodexAdapter } from "./openai-codex.js";
import { GitHubCopilotAdapter } from "./github-copilot.js";
import { getAdapterRegistry } from "../adapter-registry.js";

/** 协议名称 → 适配器构造器映射 */
const ADAPTER_MAP: Record<string, () => ProtocolAdapter> = {
  openai: () => new OpenAIChatAdapter(),
  anthropic: () => new AnthropicMessagesAdapter(),
  responses: () => new OpenAIResponsesAdapter(),
  google: () => new GoogleGeminiAdapter(),
  mistral: () => new MistralAdapter(),
  bedrock: () => new BedrockAdapter(),
  azure: () => new AzureOpenAIAdapter(),
  cloudflare: () => new CloudflareAdapter(),
  "google-vertex": () => new GoogleVertexAdapter(),
  "openai-codex": () => new OpenAICodexAdapter(),
  "github-copilot": () => new GitHubCopilotAdapter(),
};

/**
 * 获取协议适配器
 *
 * @param protocol - 协议名称（如 "openai", "anthropic", "responses"）
 * @returns 对应的适配器实例；未匹配时回退到 OpenAI 适配器
 */
export function getAdapter(protocol: string): ProtocolAdapter {
  const normalized = protocol.trim().toLowerCase();
  // 1. 优先查全局注册表（adapter-registry.ts，支持运行时注册）
  const globalAdapter = getAdapterRegistry().get(normalized);
  if (globalAdapter) return globalAdapter;
  // 2. 再查内置 ADAPTER_MAP
  const factory = ADAPTER_MAP[normalized];
  if (factory) return factory();
  // 3. 回退到 openai
  return ADAPTER_MAP["openai"]();
}

/**
 * 协议网关 — 管理和路由协议适配器
 *
 * 对应 Python: core/llm/adapters/router.py ProtocolGateway
 *
 * 用法:
 * ```ts
 * const gateway = new ProtocolGateway();
 * const adapter = gateway.resolve("anthropic");
 * ```
 */
export class ProtocolGateway {
  private _adapters = new Map<string, ProtocolAdapter>();

  /**
   * 解析协议名称，返回对应适配器（懒加载：首次解析某协议才构造，之后缓存复用）。
   *
   * @param protocol - 协议名称
   * @returns 适配器实例；未匹配时回退到 openai
   */
  resolve(protocol: string): ProtocolAdapter {
    const normalized = protocol.trim().toLowerCase();
    const cached = this._adapters.get(normalized);
    if (cached) return cached;

    // 优先查全局注册表，再查内置 ADAPTER_MAP
    const globalAdapter = getAdapterRegistry().get(normalized);
    const factory = globalAdapter
      ? () => globalAdapter
      : (ADAPTER_MAP[normalized] ?? ADAPTER_MAP["openai"]);
    const adapter = factory();
    // 用真实协议名做键缓存（未匹配时回退到 openai 实例，也按 openai 缓存）
    this._adapters.set(adapter.protocolName, adapter);
    if (!this._adapters.has(normalized)) this._adapters.set(normalized, adapter);
    return adapter;
  }

  /**
   * 注册自定义协议适配器
   *
   * @param protocol - 协议名称
   * @param adapter - 适配器实例
   */
  register(protocol: string, adapter: ProtocolAdapter): void {
    this._adapters.set(protocol.trim().toLowerCase(), adapter);
  }
}
