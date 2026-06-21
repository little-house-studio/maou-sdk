/**
 * @little-house-studio/llm/base —— 按需注册入口（tree-shake 友好）
 *
 * 对标 pi-ai 的 @earendil-works/pi-ai/base：
 * 主入口（index.ts）会在 import 时自动注册全部内置 adapter；
 * 而 base 入口只导出能力，不自动注册——调用方按需 import 各 provider 子入口
 * 并 register()，让 bundler 能 tree-shake 掉没用到的 adapter。
 *
 * @example
 * import { LLMClient, ProtocolGateway } from "@little-house-studio/llm/base";
 * import { register as registerAnthropic } from "@little-house-studio/llm/anthropic";
 * registerAnthropic();  // 只注册 Anthropic adapter，其余不进 bundle
 *
 * vs 主入口：
 * import { LLMClient } from "@little-house-studio/llm";  // 全量注册所有 adapter
 */

// 导出全部能力，但不做任何自动注册副作用
export { LLMClient } from "./client.js";
export { ProtocolGateway } from "./adapters/router.js";
export { ModelCaller } from "./caller.js";
export type { ModelCallResult, CallerStreamEvent } from "./caller.js";
export { stream, complete, StreamResult } from "./stream.js";
export type {
  Context,
  Message,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  TextContent,
  ImageContent,
  ThinkingContent,
  ToolCallBlock,
  Usage,
  StopReason,
  StreamModel,
  StreamOptions,
  StreamEvent,
} from "./stream.js";

// 适配器构造器（供 register() 用，见各 provider 子入口）
export { OpenAIChatAdapter } from "./adapters/openai.js";
export { AnthropicMessagesAdapter } from "./adapters/anthropic.js";
export { OpenAIResponsesAdapter } from "./adapters/openai-responses.js";
export { GoogleGeminiAdapter } from "./adapters/google.js";
export { GoogleVertexAdapter } from "./adapters/google-vertex.js";
export { MistralAdapter } from "./adapters/mistral.js";
export { BedrockAdapter } from "./adapters/bedrock.js";
export { AzureOpenAIAdapter } from "./adapters/azure-openai.js";
export { CloudflareAdapter } from "./adapters/cloudflare.js";
export { OpenAICodexAdapter } from "./adapters/openai-codex.js";
export { GitHubCopilotAdapter } from "./adapters/github-copilot.js";
export { registerAdapter, getAdapterRegistry } from "./adapter-registry.js";

// 类型 + 工具
export type { APIPreset, LLMUsage, LLMToolCall, APIProtocol } from "./adapters/types.js";
export { normalizeApiProtocol, completeApiUrl } from "./adapters/types.js";
export type { OpenAICompat, AnthropicCompat, ThinkingFormat, StructuredOutputCompat } from "./adapters/compat.js";
export { detectCompat, resolveCompat } from "./adapters/compat.js";

export {
  getEnvApiKey,
  findEnvKeys,
  hasEnvKey,
  PROVIDER_ENV_KEYS,
} from "./env.js";
export { readEnv, hasEnvAccess, isBrowserLike } from "./runtime-env.js";

export {
  getProviders,
  getProvider,
  getModels,
  getModel,
  registerProvider,
  registerModel,
  toAPIPreset as modelToAPIPreset,
} from "./registry/index.js";
export type { ModelSpec, ProviderSpec, ModelPricing, InputModality, OutputModality } from "./registry/index.js";

export { Type, defineTool, validateToolCall, StringEnum, toolSchemas } from "./tools/index.js";
export type { Static, TSchema, TObject, ToolSchema, DefinedTool, ValidateResult } from "./tools/index.js";
