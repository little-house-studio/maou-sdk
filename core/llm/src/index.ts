/**
 * core/llm — LLM 层 SDK
 *
 * 提供 ChatSession（对话）、PresetManager（API 预设管理）、
 * StreamJsonAccumulator（流式结构化输出提取）、
 * LLMClient + ModelCaller（底层 LLM 通信），
 * 以及多协议适配器（OpenAI / Anthropic / Responses / Google / Mistral / Bedrock /
 * Azure / Cloudflare / Vertex / Codex / Copilot）。
 *
 * 对标 pi-ai 的能力补齐：
 *   - 模型注册表（registry/）：内置目录 + 定价 + 能力 + 自动补全
 *   - 图片生成（image/）：generateImages / getImageModel
 *   - 类型安全工具（tools/）：TypeBox Type/Static + validateToolCall
 *   - 内置 agentLoop（agent-loop.ts）
 *   - 跨厂商交接（handoff.ts）
 *   - Faux/Mock provider（faux.ts）
 *   - 订阅 OAuth 登录（oauth/）：Claude Pro/Max、ChatGPT、Copilot、Gemini CLI
 *
 * 本层零内部依赖（仅 node 内置 + 少量小工具库），可独立搭建 ChatGPT 应用。
 */

// ─── ChatSession（LLM SDK 入口）────────────────────────────────────────────
export { ChatSession } from './chat-session.js'
export type {
  ChatMessage,
  ChatResponse,
  ChatDelta,
  Attachment,
  ConnectionTestResult,
  ModelInfo,
  LLMEventType,
} from './chat-session.js'

// ─── stream / complete + Context（无状态核心 API，对标 pi-ai）─────────────────
export { stream, complete, StreamResult } from './stream.js'
// ─── SSE 桥接（LLM 流 → 浏览器，Server-Sent Events）──────────────────────────
export { streamToSSE, encodeSSEFrame, collectSSE, SSE_HEADERS } from './sse.js'
export type { SSEOptions } from './sse.js'
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
} from './stream.js'

// ─── LLMConfig（统一 LLM 配置管理：内置目录 + 自定义 + 配置文件）─────────────
export { LLMConfig, DEFAULT_CONFIG_PATH } from './llm-config.js'
export type { CustomPreset, LLMConfigFile, LLMConfigOptions } from './llm-config.js'

// ─── StreamJsonAccumulator（流式 JSON 提取）─────────────────────────────────
export { StreamJsonAccumulator } from './stream-parser.js'
export type { StructuredField, ToolCallProgress, CompletedField, StreamingField } from './stream-parser.js'

// ─── 流式 JSON 工具函数 ─────────────────────────────────────────────────────
export {
  iterTopLevelJsonFields,
  inferSingleMissingCloser,
} from './protocol/json-scan.js'

// ─── 结构化输出协议（JSON Schema 派生/归一）──────────────────────────────────
export {
  normalizeJsonSettings,
  deriveJsonSettings,
} from './protocol/json-schema.js'
export type { JsonSettings } from './protocol/json-schema.js'

// ─── LLM 底层 ───────────────────────────────────────────────────────────────
export { LLMClient, ProtocolGateway } from './client.js'
export type {
  LLMClientOptions,
  PayloadHookContext,
  PayloadHookOverride,
  ResponseHookContext,
  LLMLogger,
  LLMPostLogger,
  LLMCallLogEntry,
} from './client.js'
export { ModelCaller } from './caller.js'
export type { ModelCallResult, CallerStreamEvent } from './caller.js'

// ─── 适配器底层类型（写自定义协议适配器或直接用 LLMClient 时需要）─────────
export type {
  ModelResponse,
  ModelDelta,
  ProtocolAdapter,
  ParsedLLMResponse,
} from './adapters/types.js'

// ─── 防傻瓜能力校验（guardrails）────────────────────────────────────────────
export { validateRequest } from './guardrails.js'
export type { GuardrailResult } from './guardrails.js'

// ─── POST 日志标准化（纯 SDK，零上层依赖）──────────────────────────────────
export {
  normalizePostLogRecord,
  truncateBodyForSummary,
  classifyError,
} from './post-logger.js'
export type {
  LLMPostLogRecord,
  LLMPostLogContext,
  NormalizePostLogOptions,
} from './post-logger.js'

// ─── 原始 body 编解码（gzip+base64，无状态，每条独立）────────────────────
export {
  encodeRawBody,
  decodeRawBody,
  decodeRawBodyAsObject,
  transparentDecodeField,
  decodePostLogEntry,
  reconstructPost,
  replayPost,
  RAW_CODEC_ALGO,
  RAW_CODEC_MIN_BYTES,
} from './raw-codec.js'
export type { CompressedBody, ReconstructedPost } from './raw-codec.js'

// ─── 成本计算 ───────────────────────────────────────────────────────────────
export { computeCost, formatCost } from './compute-cost.js'
export type { Pricing, CostBreakdown } from './compute-cost.js'

// ─── 模型注册表（内置目录 + 定价 + 能力，对标 pi-ai getModel/getModels）──────
export {
  getProviders,
  getProvider,
  getModels,
  getModel,
  findModel,
  getAllModels,
  registerProvider,
  registerModel,
  toAPIPreset as modelToAPIPreset,
} from './registry/index.js'
export type {
  ModelSpec,
  ProviderSpec,
  ModelPricing,
  InputModality,
  OutputModality,
  Model,
} from './registry/index.js'

// ─── 图片生成（对标 pi-ai generateImages / getImageModel）───────────────────
export {
  generateImages,
  getImageProviders,
  getImageModels,
  getImageModel,
  registerImageProvider,
} from './image/index.js'
export type {
  ImageModelSpec,
  ImageProviderSpec,
  GenerateImagesParams,
  GeneratedImage,
  GenerateImagesResult,
} from './image/index.js'

// ─── 类型安全工具定义（TypeBox，对标 pi-ai Type/Static/validateToolCall）─────
export {
  Type,
  defineTool,
  validateToolCall,
  StringEnum,
  toolSchemas,
} from './tools/index.js'
export type {
  Static,
  TSchema,
  TObject,
  ToolSchema,
  DefinedTool,
  ValidateResult,
} from './tools/index.js'

// ─── 内置 agentLoop（对标 pi-ai agentLoop）──────────────────────────────────
export { agentLoop } from './agent-loop.js'
export type {
  AgentLoopTool,
  AgentLoopAnyTool,
  AgentLoopParams,
  AgentLoopEvent,
  AgentLoopResult,
  AgentLoopStopReason,
  AgentLoopHooks,
  AgentLoopContext,
  AgentLoopStepResult,
} from './agent-loop.js'

// ─── 跨厂商交接（对标 pi-ai cross-provider handoff）─────────────────────────
export {
  normalizeForHandoff,
  normalizeToolCallIds,
  migrateSession,
  assistantTurnToText,
  splitThinkingTags,
  wrapThinking,
} from './handoff.js'
export type { HandoffOptions, ThinkingMode } from './handoff.js'

// ─── 统一思考强度（对标 pi-ai 5 级 reasoning）──────────────────────────────
export {
  reasoningParamsFor,
  reasoningBudget,
  toOpenAIReasoningEffort,
  reasoningLevelFromBudget,
  REASONING_BUDGETS,
} from './reasoning.js'
export type { ReasoningLevel } from './reasoning.js'

// ─── 环境变量 Key 检测（对标 pi-ai getEnvApiKey/findEnvKeys，覆盖 30+ 厂商）──
export { getEnvApiKey, findEnvKeys, hasEnvKey, PROVIDER_ENV_KEYS } from './env.js'

// ─── 上下文溢出检测（对标 pi-ai overflow detection，覆盖 20+ 厂商）───────────
export { detectContextOverflow, extractTokenCount } from './overflow.js'

export { estimateTokens, estimateContextTokens, checkContextFit } from './token-count.js'
export { ConcurrencyLimiter, RateLimiter, withLimiters } from './rate-limit.js'
// ─── 账户能力：余额查询 + 跨协议模型扫描（best-effort）────────────────────────
export { queryBalance, scanModels } from './account.js'
export type { BalanceResult, ScannedModel } from './account.js'

// ─── WebSocket 传输（对标 pi-ai websocket/websocket-cached；经 fetchImpl 注入）──
export { createWebSocketFetch } from './transport.js'
export type { WebSocketFetchOptions } from './transport.js'

// ─── Stealth 工具名伪装（对标 pi-ai stealth mode）──────────────────────────
export { createStealthMapper, CLAUDE_CODE_TOOL_MAP } from './stealth.js'
export type { StealthMapper } from './stealth.js'

// ─── compat 兼容标志矩阵（OpenAI 兼容厂商；对标 pi-ai OpenAICompat）──────────
export type { OpenAICompat, AnthropicCompat, ThinkingFormat, StructuredOutputCompat } from './adapters/compat.js'
export { detectCompat, resolveCompat } from './adapters/compat.js'

// ─── 跨运行时环境（Node / Bun / 浏览器安全）──────────────────────────────────
export { readEnv, hasEnvAccess, isBrowserLike } from './runtime-env.js'
// 注意：HTTP 代理（core/llm/proxy）静态依赖 undici（node-only），仅经子路径导入，
// 不从此浏览器安全入口导出。

// ─── Faux / Mock Provider（对标 pi-ai registerFauxProvider）─────────────────
export {
  registerFauxProvider,
  unregisterFauxProvider,
  clearFauxProviders,
  takeFauxResponse,
  fauxAssistantMessage,
  fauxText,
  fauxThinking,
  fauxToolCall,
} from './faux.js'
export type { FauxResponse, FauxPart, FauxResponder } from './faux.js'

// ─── 订阅 OAuth 登录（对标 pi-ai login*；命名空间避免污染顶层）──────────────
export * as oauth from './oauth/index.js'

// ─── 适配器类型 ─────────────────────────────────────────────────────────────
export type {
  APIPreset,
  LLMUsage,
  LLMToolCall,
} from './adapters/types.js'
export { normalizeApiProtocol, completeApiUrl } from './adapters/types.js'
