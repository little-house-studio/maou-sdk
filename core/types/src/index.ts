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
  /**
   * 单轮内多个工具调用是否可并行执行。
   * true = 该工具无副作用/读操作，安全并发（如 read/glob/grep/find_code/lsp）；
   * 缺省/false = 串行（写文件、终端、有状态操作）。
   * AgentRuntime 会把连续的 parallelSafe 调用合并为并发组，其余按序执行，保持顺序语义。
   */
  parallelSafe?: boolean
  /**
   * 该工具调用后是否**终止** loop（不再进入下一轮）。
   * 缺省/false = 继续 loop（拿到结果 → 下一轮，标准行为）。
   * true = 收尾型工具（如 task_finish）。
   * 规则：一轮内若**所有**被调工具都是 endsLoop，则结束 loop；只要有一个非 endsLoop 工具就继续。
   */
  endsLoop?: boolean
  /**
   * 该工具是否**阻塞** loop 等待真实结果。
   * 缺省/true = 阻塞（标准行为，loop 等工具返回后才进下一轮）。
   * false = 非阻塞（fire-and-forget 后台任务，如启动开发服务器、监听文件变化）：
   *   - runtime 立即提交占位 tool_result（"后台执行中"），不等待真实结果
   *   - loop 直接进入下一轮
   *   - 真实结果通过 StreamEvent 异步上报（如果工具支持）
   */
  blocking?: boolean
  /**
   * 该工具的执行超时时间（毫秒）。0 = 无超时。
   * 未设置时使用 ToolExecutor 的 defaultTimeoutMs（默认 0 = 无超时）。
   * 工具可自行覆盖，如 search_internet 可设 30_000（搜索不宜太久），
   * use_terminal 可设 0（命令可能跑很久）。
   */
  timeoutMs?: number
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
  /** 工具输出压缩级别：off=不压；normal=保守(默认)；aggressive=更激进。由 AgentRuntime 从 agent.json 注入。 */
  compressionLevel?: "off" | "normal" | "aggressive"
  /**
   * 子 Agent 真并行执行器（由 AgentRuntime 注入；harness 提供 runFn）。
   *
   * agent_message 工具调此函数 fork 子 Agent 执行独立任务。
   * 缺省（undefined）→ agent_message 退回原 stub 行为（"暂未开放"）。
   */
  subagentExecutor?: SubagentExecutorLike
}

/**
 * SubagentExecutor 的最小契约（types 包不依赖 agent 包）。
 * 真实实现见 @little-house-studio/agent 的 SubagentExecutor。
 */
export interface SubagentExecutorLike {
  /** fork 单个子 Agent 执行任务。 */
  fork(taskId: string, task: string): Promise<SubagentResultLike>
  /** 并发 fork 一层 task（同层可并行）。 */
  forkLayer(tasks: Array<{ id: string; desc: string }>): Promise<SubagentResultLike[]>
}

export interface SubagentResultLike {
  taskId: string
  subSessionId: string
  output: string
  ok: boolean
  error?: string
  elapsedMs: number
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
  agentRoundLimit: number
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
export { Profiler } from './profiler.js'
export type { SpanRecord, SpanSummary, ProfileReport } from './profiler.js'
