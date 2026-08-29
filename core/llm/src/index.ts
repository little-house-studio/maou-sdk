/**
 * core/llm — LLM 层 SDK
 *
 * 提供 ChatSession（对话）、LLMConfig / api-presets（厂商目录 + 用户 API 名单）、
 * StreamJsonAccumulator（流式结构化输出提取）、
 * LLMClient + ModelCaller（底层 LLM 通信），
 * 以及多协议适配器（OpenAI / Anthropic / Responses / Google / Mistral / Bedrock /
 * Azure / Cloudflare / Vertex / Codex / Copilot）。
 *
 * 还提供：
 *   - 模型注册表（registry/）：内置目录 + 定价 + 能力 + 自动补全
 *   - 图片生成（image/）：generateImages / getImageModel
 *   - 类型安全工具（tools/）：TypeBox Type/Static + validateToolCall
 *   - 内置 agentLoop（agent-loop.ts）
 *   - 跨厂商交接（handoff.ts）
 *   - Faux/Mock provider（faux.ts）
 *   - 订阅 OAuth 登录（oauth/）：anthropic / openai-codex / github-copilot / google / xai
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
// ConnectionTestResult 与 connection-test 同源语义；chat-session 保留类型 re-export

// ─── stream / complete + Context（无状态核心 API）────────────────────────────
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
export type {
  CustomPreset,
  CustomProvider,
  CustomModel,
  LLMConfigFile,
  LLMConfigOptions,
} from './llm-config.js'

// ─── 用户 API 名单（config.json api.presets）────────────────────────────────
export {
  resolveMaouConfigPath,
  loadPresetsFromMaouConfig,
  loadRawPresetsFromMaouConfig,
  getApiPreset,
  getDefaultPresetFromMaouConfig,
  getRolePresetFromMaouConfig,
  getDefaultPresetFromConfigStore,
  isGlobalApiConfigured,
  saveGlobalApiConfig,
  upsertApiPreset,
  removeApiPreset,
  getGlobalMaouRoot,
} from './api-presets.js'
export type { GlobalApiWriteOptions } from './api-presets.js'

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

// ─── 统一错误分类（日志 / 重试 / Agent / UI 共用）────────────────────────────
export {
  classifyLlmError,
  classifyFromThrown,
  decideLlmRetry,
  formatLlmErrorForStream,
  parseLlmErrorFromMessage,
  isQuotaExhaustedText,
  isRetryableCategory,
  buildApiErrorThrowMessage,
  categoryToPostLogErrorType,
  LLM_ERROR_PREFIX,
} from './errors.js'
export type {
  LlmErrorCategory,
  ClassifiedLlmError,
  ClassifyLlmErrorInput,
} from './errors.js'

// ─── 辅助模型调用器（统一辅助调用管道：压缩/判定/路由等）────────────────────
export { AuxModelCaller, resolveHelperPreset } from './aux-caller.js'
export type {
  AuxCallParams,
  AuxCallResult,
  AuxJsonCallResult,
  AuxUsageStats,
} from './aux-caller.js'

// ─── 适配器底层类型（写自定义协议适配器或直接用 LLMClient 时需要）─────────
export type {
  ModelResponse,
  ModelDelta,
  ProtocolAdapter,
  ParsedLLMResponse,
} from './adapters/types.js'
export { registerAdapter, getAdapterRegistry } from './adapter-registry.js'

// ─── 发送前能力校验（guardrails）────────────────────────────────────────────
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

// ─── preset 规范化（pricing / extraBody / reasoning / maxConcurrent）────────
export {
  normalizeApiPreset,
  normalizeApiPresets,
  resolvePricingFromPreset,
  getPresetMaxConcurrent,
} from './preset-normalize.js'
export { normalizeCacheUsage, cacheHitPct } from './cache-usage.js'
export type { NormalizedCacheUsage } from './cache-usage.js'

// ─── 上下文窗口（压缩 / 计量 / UI 共用同一个数）───────────────────────────────
export {
  FALLBACK_CONTEXT_WINDOW,
  backfillContextWindow,
  contextWindowOf,
  describeContextWindowSource,
  resolveContextWindow,
} from './context-window.js'
export type { ContextWindowSource, ResolvedContextWindow } from './context-window.js'

// ─── 模型注册表（内置目录 + 定价 + 能力）────────────────────────────────────
export {
  getProviders,
  getProvider,
  getModels,
  getModel,
  findModel,
  getAllModels,
  registerProvider,
  unregisterProvider,
  registerModel,
  ensureBuiltinCatalog,
  builtinCatalog,
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

// ─── 图片生成 ──────────────────────────────────────────────────────────────
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

// ─── 类型安全工具定义（TypeBox）─────────────────────────────────────────────
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

// ─── 内置 agentLoop ────────────────────────────────────────────────────────
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

// ─── 跨厂商交接 ────────────────────────────────────────────────────────────
export {
  normalizeForHandoff,
  normalizeToolCallIds,
  migrateSession,
  assistantTurnToText,
  splitThinkingTags,
  wrapThinking,
} from './handoff.js'
export type { HandoffOptions, ThinkingMode } from './handoff.js'

// ─── 统一思考强度 ──────────────────────────────────────────────────────────
export {
  reasoningParamsFor,
  reasoningBudget,
  toOpenAIReasoningEffort,
  reasoningLevelFromBudget,
  REASONING_BUDGETS,
  EFFORT_ORDER,
  clampEffortLevel,
  mapEffortLevel,
  reasoningToEffort,
  effortToReasoning,
} from './reasoning.js'
export type { ReasoningLevel, EffortLevel } from './reasoning.js'

// ─── 环境变量 Key 检测（覆盖 30+ 厂商）──────────────────────────────────────
export { getEnvApiKey, findEnvKeys, hasEnvKey, PROVIDER_ENV_KEYS } from './env.js'

// ─── 上下文溢出检测（覆盖 20+ 厂商）─────────────────────────────────────────
export {
  detectContextOverflow,
  detectUnsupportedMediaContent,
  extractTokenCount,
} from './overflow.js'

// ─── 跨平台 stop_reason 统一映射 ────────────────────────────────────────────
export {
  normalizeStopReason,
  shouldContinueLoop,
  needsContinuation,
  isSafetyBlock,
  isToolUse,
} from './stop-reason.js'

export { estimateTokens, estimateContextTokens, checkContextFit } from './token-count.js'
export { ConcurrencyLimiter, RateLimiter, withLimiters } from './rate-limit.js'
// ─── 账户能力：余额查询 + 跨协议模型扫描（best-effort）────────────────────────
export { queryBalance, scanModels } from './account.js'
export type { BalanceResult, ScannedModel } from './account.js'

// ─── 连接测试（真实 chat 探测 + 延迟）──────────────────────────────────────
export { testConnection } from './connection-test.js'
export type {
  ConnectionTestResult as LlmConnectionTestResult,
  TestConnectionOptions,
} from './connection-test.js'

// ─── 模型 SVG 降智探针（无上下文画图 → 解析 SVG 图片）──────────────────────
export {
  runModelSvgProbe,
  extractSvgFromModelText,
  sanitizeSvg,
  svgToImageDataUrl,
  buildModelSvgProbePrompt,
  DEFAULT_SVG_PROBE_SUBJECT,
} from './model-svg-probe.js'
export type {
  ModelSvgProbeResult,
  ModelSvgProbeOptions,
} from './model-svg-probe.js'

// ─── WebSocket 传输（经 fetchImpl 注入）────────────────────────────────────
export { createWebSocketFetch } from './transport.js'
export type { WebSocketFetchOptions } from './transport.js'

// ─── Stealth 工具名别名 ────────────────────────────────────────────────────
export { createStealthMapper, CLAUDE_CODE_TOOL_MAP } from './stealth.js'
export type { StealthMapper } from './stealth.js'

// ─── compat 兼容标志矩阵（OpenAI 兼容厂商）──────────────────────────────────
export type { OpenAICompat, AnthropicCompat, ThinkingFormat, StructuredOutputCompat, EffortLevel as CompatEffortLevel } from './adapters/compat.js'
export { detectCompat, resolveCompat } from './adapters/compat.js'

// ─── 跨运行时环境（Node / Bun / 浏览器安全）──────────────────────────────────
export { readEnv, hasEnvAccess, isBrowserLike } from './runtime-env.js'
// 注意：HTTP 代理（core/llm/proxy）静态依赖 undici（node-only），仅经子路径导入，
// 不从此浏览器安全入口导出。

// ─── Faux / Mock Provider ──────────────────────────────────────────────────
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

// ─── 订阅 OAuth 登录 ───────────────────────────────────────────────────────
export * as oauth from './oauth/index.js'

// ─── 适配器类型 ─────────────────────────────────────────────────────────────
export type {
  APIPreset,
  LLMUsage,
  LLMToolCall,
} from './adapters/types.js'
export { normalizeApiProtocol, completeApiUrl } from './adapters/types.js'

export {
  mapPiApiToProtocol,
  registerExtensionProviderRuntime,
  unregisterExtensionProviderRuntime,
  extensionProviderToPresets,
  loadPersistedExtensionPresets,
  loadPersistedExtensionProviders,
  upsertPersistedExtensionProvider,
  removePersistedExtensionProvider,
  loginExtensionProvider,
  extensionProvidersPath,
} from './extension-providers.js'
export type {
  ExtensionProviderInput,
  ExtensionProviderModel,
  ExtensionOAuthConfig,
  ExtensionOAuthCredentials,
} from './extension-providers.js'

// ─── 粘贴识别（规则先抽 + 可选 LLM 补空）───────────────────────────────────
export {
  parseClipboard,
  ADDRESS_SCHEMA,
  LLM_PRESET_SCHEMA,
  normalizePasteSchema,
  normalizePasteText,
  peelRegion,
  extractApiKeys,
  looksLikeApiKey,
  API_KEY_MIN,
  extractRequestUrls,
  inferProtocolFromUrl,
  guessProtocolFromUrl,
  DEFAULT_PROTOCOL,
  extractModelGuesses,
  looksLikeModelName,
  fetchModelIds,
  fetchPublicCatalogIds,
  matchModelsInText,
  matchAllModelsInText,
  extractDeclaredModelIds,
  collectModelIds,
  pickPrimaryModel,
  MODEL_LIST_TIMEOUT_MS,
  MODELS_DEV_URL,
} from './paste-parse/index.js'
export {
  llmPresetFromFields,
  applyLlmPresetToConfig,
} from './paste-parse/apply-preset.js'
export type {
  ExtractorId,
  FieldSource,
  ParseClipboardOptions,
  ParseClipboardResult,
  ParseClipboardSchema,
  ParsedField,
  PasteFieldSpec,
  PasteLlmFill,
  PasteParseResult,
  PasteSchema,
  LlmPresetFormValues,
  LlmPresetApplyInput,
  LlmPresetBuildResult,
  LlmPresetApplyResult,
} from './paste-parse/index.js'
