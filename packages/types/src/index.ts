/**
 * @little-house-studio/types — 跨层共享类型（最底层，零依赖）
 *
 * 放"不属于任何具体层、但多层都要用"的领域类型：
 * - 工具基础类型（ToolCall/ToolResult/ToolDefinition/ToolContext/ToolResponse/JsonSchema）
 * - 会话/消息领域类型（Session/Message/MessageRole）
 * - 流式事件（StreamEvent）
 *
 * 这些类型原本散落在 core（被工具污染）和 llm（重复定义），统一收敛到此，
 * 让 core/llm/tools/agent-harness 都从这里进口，打破循环依赖、消除重复定义。
 *
 * 注意：本包不依赖任何 @little-house-studio 包，也不依赖 LLM 细节。
 * StreamEvent.usage 故意用 Record<string, unknown>（而非 LLMUsage），
 * 避免本底层包反向依赖 llm 层。
 */

// ─── Session / Message ──────────────────────────────────────────────────────

/** 会话：一次 agent 交互的完整上下文 */
export interface Session {
  id: string
  agentName: string
  title: string
  messages: Message[]
  createdAt: string
  updatedAt: string
}

/** 消息角色 */
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

/** 单条对话消息 */
export interface Message {
  role: MessageRole
  content: string
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
  timestamp: string
}

// ─── Tool 基础类型 ──────────────────────────────────────────────────────────

/** 工具参数 JSON Schema 定义 */
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

/** 工具定义元数据 */
export interface ToolDefinition {
  name: string
  aliases: string[]
  description: string
  parameters: JsonSchema
  allowedModes: string[] | null
  /** LLM 返回的工具调用参数校验规则（可选） */
  paramGuards?: Record<string, string>
}

/** 工具执行上下文 */
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

/** 工具执行的结构化响应 */
export interface ToolResponse {
  ok: boolean
  message: string
  displayEvents: Record<string, unknown>[]
  payload: Record<string, unknown>
  background: boolean
  images: { mimeType: string; data: string }[]
}

/** 工具调用请求 */
export interface ToolCall {
  id: string
  name: string
  parameters: Record<string, unknown>
}

/** 工具执行结果记录 */
export interface ToolResult {
  toolCallId: string
  name: string
  output: string
  success: boolean
  error: string
  elapsed: number
}

// ─── Stream Events ──────────────────────────────────────────────────────────

/** SSE 流式事件（usage 用宽类型，避免反向依赖 llm 层的 LLMUsage） */
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
