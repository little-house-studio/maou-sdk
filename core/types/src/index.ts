/**
 * @little-house-studio/types — 基础层（共享类型 + 配置 + 工具函数）
 *
 * 原 @little-house-studio/types 已并入本包（按"core/ 文件夹不与 core 包撞名"的决定 A）。
 * 内容：
 * - 领域类型：工具(ToolCall/ToolDefinition/...)、会话(Session/Message)、流式事件(StreamEvent)
 * - 应用配置：AppConfig/ApiConfig/SecurityConfig/...
 * - 配置管理：ConfigStore（Zod 校验 + JSONC + 两级 deep-merge）
 * - 项目管理：getProjectsList/addProject/...
 * - 工具函数 + 常量（MAOU_VERSION/DEFAULT_PORT/...）
 * - 表情检测 detectExpression
 *
 * 依赖：jsonc-parser、zod（ConfigStore 用）。本包是基础层，不依赖其它 @little-house-studio 包。
 */

// ─── 领域类型（Session/Message/Tool/StreamEvent）────────────────────────────
export interface Session {
  id: string
  agentName: string
  title: string
  messages: Message[]
  createdAt: string
  updatedAt: string
}
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'
export interface Message {
  role: MessageRole
  content: string
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
  timestamp: string
}
export interface JsonSchema {
  type: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  additionalProperties?: boolean
  description?: string
  minimum?: number
  maximum?: number
  items?: JsonSchema
  enum?: string[]
  [key: string]: unknown
}
export interface ToolDefinition {
  name: string
  aliases: string[]
  description: string
  parameters: JsonSchema
  allowedModes: string[] | null
  paramGuards?: Record<string, string>
}
export interface ToolContext {
  sessionId: string
  projectRoot: string
  promptRoot: string
  sandboxRoot: string
  sandboxMode: string
  agentName: string
  agentMode: string
  pluginSettings: Record<string, unknown>
  workingDir: string
}
export interface ToolResponse {
  ok: boolean
  message: string
  displayEvents: Record<string, unknown>[]
  payload: Record<string, unknown>
  background: boolean
  images: { mimeType: string; data: string }[]
}
export interface ToolCall {
  id: string
  name: string
  parameters: Record<string, unknown>
}
export interface ToolResult {
  toolCallId: string
  name: string
  output: string
  success: boolean
  error: string
  elapsed: number
}
export interface StreamEvent {
  type: string
  content?: string
  delta?: string
  round?: number
  message?: string
  session?: Session
  tool?: ToolCall | { name: string }
  ok?: boolean
  usage?: Record<string, unknown>
  [key: string]: unknown
}

// ─── LLM 配置类型（@deprecated 权威定义在 @little-house-studio/llm；此处保留供 AppConfig 用）──
/** @deprecated 用 @little-house-studio/llm 的 APIPreset */
export type LLMProtocol = 'openai' | 'anthropic' | 'openai-responses'
/** @deprecated */
export type StructuredOutputMode = 'json_object' | 'json_schema'
/** @deprecated 用 @little-house-studio/llm 的 APIPreset */
export interface LLMPreset {
  name: string
  url: string
  key: string
  model: string
  maxTokens: number
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
/** @deprecated 用 @little-house-studio/llm 的 LLMUsage */
export interface LLMUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cacheCreationTokens?: number
  cacheReadTokens?: number
}
/** @deprecated 用 @little-house-studio/llm 的 Pricing */
export interface Pricing {
  inputPrice: number
  outputPrice: number
  cacheHitPrice: number
  currency: string
}
/** @deprecated 用 @little-house-studio/llm 的 ModelCallResult */
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

// ─── 应用配置类型 ───────────────────────────────────────────────────────────
export interface AgentConfig {
  name: string
  role?: string
  label?: string
  description?: string
  permissions?: Record<string, unknown>
  outputSpec?: Record<string, unknown>
}
export interface ContextSettings {
  thresholdPercent: number
  keepRecentPercent: number
}
export interface PluginSettings {
  plugins?: Record<string, { enabled: boolean }>
  signalRender?: { imagePath?: string; imageFit?: string }
  [key: string]: unknown
}
export interface SecurityConfig {
  sandboxMode: string
  dangerousCommandsRequireApproval: boolean
  allowedHosts?: string[]
  blockedCommands?: string[]
}
export interface ApiConfig {
  presets: LLMPreset[]
  defaultPreset: number
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
export interface AppConfig {
  api: ApiConfig
  security?: SecurityConfig
  ui?: Record<string, unknown>
}
export interface HealthResponse {
  ok: boolean
  uptime: number
  sessionsCount: number
  diskUsagePct: number
  version: string
}
export interface PromptNode {
  path: string
  content: string
  children: PromptNode[]
}
export interface CompiledPrompt {
  system: string
  roles: Record<string, string>
  tree: PromptNode
}
export interface ParsedResponse {
  content: string
  toolCalls: ToolCall[]
  structuredOutput?: Record<string, unknown>
  reasoning?: string
}
export type EventType =
  | 'message:user' | 'message:assistant' | 'message:system' | 'message:tool'
  | 'session:create' | 'session:destroy' | 'tool:call' | 'tool:result'
  | 'stream:start' | 'stream:delta' | 'stream:end' | 'stream:error'
  | 'agent:start' | 'agent:stop' | 'config:reload' | 'error'
export type EventHandler = (event: StreamEvent) => void

// ─── 运行时：配置管理 / 项目管理 / 工具函数 / 表情检测（原 core 包）──────────
export { ConfigStore } from './config-store.js'
export { getProjectsList, addProject, removeProject, autoDiscover } from './project-manager.js'
export type { ProjectEntry, ProjectListItem } from './project-manager.js'
export {
  MAOU_VERSION,
  isWithinPath,
  coerceBool,
  escapeHtml,
  nowIso,
  isConnectionError,
  DEFAULT_PORT,
  MAX_BODY_SIZE,
  MAX_FILE_PROXY_SIZE,
  URL_PROXY_TIMEOUT_MS,
  SSE_PING_INTERVAL_MS,
  DEFAULT_HOST,
} from './utils.js'
export { detectExpression } from './expression.js'
