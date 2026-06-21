/**
 * @little-house-studio/core — 核心类型定义
 *
 * 工具基础类型、会话/消息领域类型、流式事件类型已下沉到
 * @little-house-studio/types（最底层、零依赖），此处从 types 转手导出以保持
 * core 对外 API 不变。core 自身只保留应用配置（AppConfig/ApiConfig）与少量
 * LLM 配置类型（@deprecated，权威定义在 @little-house-studio/llm）。
 */

// ─── 跨层共享类型（权威源在 @little-house-studio/types）──────────────────────
// import type 引入本地作用域（ParsedResponse.toolCalls / EventHandler 用到），
// 同时 re-export 保持 core 对外 API 不变。
import type {
  Session,
  Message,
  MessageRole,
  ToolCall,
  ToolResult,
  ToolDefinition,
  ToolContext,
  ToolResponse,
  JsonSchema,
  StreamEvent,
} from '@little-house-studio/types'
export type {
  Session,
  Message,
  MessageRole,
  ToolCall,
  ToolResult,
  ToolDefinition,
  ToolContext,
  ToolResponse,
  JsonSchema,
  StreamEvent,
} from '@little-house-studio/types'

// ─── LLM ────────────────────────────────────────────────────────────────────

/** API 协议类型 */
export type LLMProtocol = 'openai' | 'anthropic' | 'openai-responses'

/** 结构化输出模式 */
export type StructuredOutputMode = 'json_object' | 'json_schema'

/** LLM 提供商预设配置 */
export interface LLMPreset {
  name: string
  url: string
  key: string
  model: string
  maxTokens: number
  /** 总上下文窗口（输入+输出），用于 token 追踪和压缩决策 */
  maxContext?: number
  protocol: LLMProtocol
  stream: boolean
  supportsVision: boolean
  supportsReasoning: boolean
  nativeToolCalling: boolean
  nativeStructuredOutput: boolean
  structuredOutputMode?: StructuredOutputMode
  reasoningParams?: Record<string, unknown>
}

/** Token 用量统计 */
export interface LLMUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cacheCreationTokens?: number
  cacheReadTokens?: number
}

/** 模型定价信息 */
export interface Pricing {
  inputPrice: number
  outputPrice: number
  cacheHitPrice: number
  currency: string
}

/** 单次模型调用结果 */
export interface ModelCallResult {
  rawResponse: string
  content: string
  parsed: Record<string, unknown>
  retryIndex: number
  validationError: string
  attemptDiagnostics: Record<string, unknown>[]
  nativeToolCalls: Record<string, unknown>[]
  usage?: LLMUsage
  rawRequest?: Record<string, unknown>
  rawResponseData?: Record<string, unknown>
  rawSseEvents: string[]
}

// ─── Agent Config ───────────────────────────────────────────────────────────

/** Agent 定义 */
export interface AgentConfig {
  name: string
  role?: string
  label?: string
  description?: string
  permissions?: Record<string, unknown>
  outputSpec?: Record<string, unknown>
}

// ─── App Config ─────────────────────────────────────────────────────────────

/** 上下文窗口管理设置 */
export interface ContextSettings {
  thresholdPercent: number
  keepRecentPercent: number
}

/** 插件开关 */
export interface PluginSettings {
  plugins?: Record<string, { enabled: boolean }>
  signalRender?: { imagePath?: string; imageFit?: string }
  [key: string]: unknown
}

/** 安全策略 */
export interface SecurityConfig {
  sandboxMode: string
  dangerousCommandsRequireApproval: boolean
  allowedHosts?: string[]
  blockedCommands?: string[]
}

/** API 配置 */
export interface ApiConfig {
  presets: LLMPreset[]
  defaultPreset: number
  /** role 名 → presets 数组下标。/api/run 的 role 参数据此路由到具体 preset。 */
  rolePresets: Record<string, number>
  agentRoundLimit: number
  promptRoot: string
  promptEntrypoint: string
  userEntrypoint: string
  toolSchemasFile: string
  promptRoles: Record<string, string>
  contextSettings: ContextSettings
  pluginSettings?: PluginSettings
}

/** 应用全局配置 */
export interface AppConfig {
  api: ApiConfig
  security?: SecurityConfig
  ui?: Record<string, unknown>
}

// ─── Health ─────────────────────────────────────────────────────────────────

/** 健康检查响应 */
export interface HealthResponse {
  ok: boolean
  uptime: number
  sessionsCount: number
  diskUsagePct: number
  version: string
}

// ─── Prompt ─────────────────────────────────────────────────────────────────

/** 编译后的 prompt 树节点 */
export interface PromptNode {
  path: string
  content: string
  children: PromptNode[]
}

/** Prompt 编译结果 */
export interface CompiledPrompt {
  system: string
  roles: Record<string, string>
  tree: PromptNode
}

// ─── Protocol (解析层) ──────────────────────────────────────────────────────

/** LLM 原始响应解析结果 */
export interface ParsedResponse {
  content: string
  toolCalls: ToolCall[]
  structuredOutput?: Record<string, unknown>
  reasoning?: string
}

// ─── Event Bus ──────────────────────────────────────────────────────────────

/** 事件类型枚举 */
export type EventType =
  | 'message:user'
  | 'message:assistant'
  | 'message:system'
  | 'message:tool'
  | 'session:create'
  | 'session:destroy'
  | 'tool:call'
  | 'tool:result'
  | 'stream:start'
  | 'stream:delta'
  | 'stream:end'
  | 'stream:error'
  | 'agent:start'
  | 'agent:stop'
  | 'config:reload'
  | 'error'

/** 事件总线回调 */
export type EventHandler = (event: StreamEvent) => void
