/**
 * ChatSession SDK — 核心 LLM 对话封装
 *
 * 提供简洁的高层 API，用于与 LLM 进行对话。
 * 内部组合 LLMClient + ModelCaller，对外屏蔽协议细节。
 */

import { StreamJsonAccumulator } from './stream-parser.js'
import { LLMClient, ProtocolGateway } from './client.js'
import { ModelCaller } from './caller.js'
import { computeCost, type Pricing, type CostBreakdown } from './compute-cost.js'
import { validateRequest } from './guardrails.js'
import { reasoningParamsFor, type ReasoningLevel } from './reasoning.js'
import type { ModelCallResult, CallerStreamEvent } from './caller.js'
import type {
  APIPreset,
  LLMUsage,
  LLMToolCall,
} from './adapters/types.js'
import { normalizeApiProtocol, completeApiUrl } from './adapters/types.js'

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * 极简事件发射器（替代 node:events，使 ChatSession 可在浏览器/边缘运行时直接打包）。
 * 仅实现 ChatSession 需要的 on/off/once/emit。
 */
type EmitterHandler = (...args: unknown[]) => void
class TinyEmitter {
  private handlers = new Map<string, Set<EmitterHandler>>()
  on(event: string, handler: EmitterHandler): this {
    let set = this.handlers.get(event)
    if (!set) { set = new Set(); this.handlers.set(event, set) }
    set.add(handler)
    return this
  }
  off(event: string, handler: EmitterHandler): this {
    this.handlers.get(event)?.delete(handler)
    return this
  }
  once(event: string, handler: EmitterHandler): this {
    const wrapped: EmitterHandler = (...args) => { this.off(event, wrapped); handler(...args) }
    return this.on(event, wrapped)
  }
  emit(event: string, ...args: unknown[]): boolean {
    const set = this.handlers.get(event)
    if (!set || set.size === 0) return false
    for (const h of [...set]) { try { h(...args) } catch { /* 监听器异常不影响主流程 */ } }
    return true
  }
}

/** 附件 */
export interface Attachment {
  type: 'image' | 'video' | 'audio' | 'document'
  data: string        // base64
  mimeType: string    // e.g. "image/png"
  name?: string
}

/** 聊天消息 */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  attachments?: Attachment[]
  toolCalls?: LLMToolCall[]
  usage?: LLMUsage
  timestamp: number
}

/** 聊天响应 */
export interface ChatResponse {
  content: string
  toolCalls: LLMToolCall[]
  usage: LLMUsage | null
  rawResponse: string
  message: ChatMessage
}

/** 流式增量 */
export interface ChatDelta {
  type: 'delta' | 'thinking' | 'thinking_start' | 'thinking_end' | 'tool_call' | 'field_complete' | 'field_streaming' | 'error'
  /** 累积文本（从头到现在的完整文本） */
  content?: string
  /** 增量文本（本次 chunk 新增的字符） */
  delta?: string
  /** 思考/推理内容（本次 chunk 的思考增量） */
  thinking?: string
  /** 累积思考内容 */
  thinkingContent?: string
  /** 工具调用 */
  toolCall?: LLMToolCall
  /** 工具名称（流式检测到的，可能不完整） */
  toolName?: string
  /** 工具调用是否完整 */
  toolComplete?: boolean
  /** 结构化输出：新完成的字段名 */
  fieldName?: string
  /** 结构化输出：字段值（完成时） */
  fieldValue?: unknown
  /** 结构化输出：字段流式内容（字符串字段流式输出时） */
  fieldContent?: string
  /** 结构化输出：字段增量（本次新增） */
  fieldDelta?: string
  /** 结束原因 */
  finishReason?: string | null
  /** token 用量（流结束时可能附带） */
  usage?: LLMUsage | null
  /** 错误信息 */
  error?: string
}

/** 连接测试结果 */
export interface ConnectionTestResult {
  ok: boolean
  model: string
  latencyMs: number
  error?: string
}

/** 模型信息 */
export interface ModelInfo {
  id: string
  ownedBy: string
  created?: number
}

/** LLM 事件类型 */
export type LLMEventType =
  | 'send'           // 发送消息
  | 'receive'        // 收到完整响应
  | 'first_token'    // 模型首字
  | 'thinking_start' // 模型思考开始
  | 'thinking_end'   // 模型思考结束
  | 'output_start'   // 模型输出开始
  | 'output_end'     // 模型输出结束
  | 'parse_error'    // 解析错误
  | 'delta'          // 每个流式增量
  | 'error'          // 错误
  | 'abort'          // 中断

// ─── ChatSession ────────────────────────────────────────────────────────────

export class ChatSession {
  private client: LLMClient
  private caller: ModelCaller
  private preset: APIPreset
  private messages: ChatMessage[] = []
  private emitter = new TinyEmitter()
  private _aborted = false
  /** 当前进行中的请求的 AbortController —— abort() 真正中断底层 fetch */
  private _abortController: AbortController | null = null
  /** 会话级清理回调（关闭注入的资源，如 WebSocket 连接） */
  private _cleanupFns: Array<() => void | Promise<void>> = []
  private reasoningLevel: string = 'off'
  /** 原生工具 schema（setTools 设置，send 时传给 caller） */
  private toolSchemas: Record<string, unknown>[] | null = null
  /** 结构化输出 JSON schema（setJsonSchema 设置） */
  private jsonSettings: Record<string, unknown> | null = null

  constructor(options: {
    preset: APIPreset
    maxRetries?: number
    loopThreshold?: number
  }) {
    // 构造时做基本校验，fail fast
    if (!options.preset.url) throw new Error('ChatSession: preset.url is required')
    if (!options.preset.model) throw new Error('ChatSession: preset.model is required')
    this.preset = options.preset
    this.client = new LLMClient()
    this.caller = new ModelCaller({
      client: this.client,
      emitEvent: (type, data) => ({ type, data }),
      emitLog: (level, data) => ({ type: level, data: { message: data } }),
      maxRetries: options.maxRetries ?? 3,
      loopThreshold: options.loopThreshold ?? 10,
    })
  }

  // ── 事件订阅 ──

  on(event: LLMEventType, handler: (...args: unknown[]) => void): this {
    this.emitter.on(event, handler)
    return this
  }

  off(event: LLMEventType, handler: (...args: unknown[]) => void): this {
    this.emitter.off(event, handler)
    return this
  }

  once(event: LLMEventType, handler: (...args: unknown[]) => void): this {
    this.emitter.once(event, handler)
    return this
  }

  // ── 发送消息（非流式）──

  async send(text: string, options?: { attachments?: Attachment[] }): Promise<ChatResponse> {
    // 0. 防傻瓜校验
    const guard = validateRequest({
      preset: this.preset,
      text,
      attachments: options?.attachments,
      reasoningLevel: this.reasoningLevel,
      toolSchemas: this.toolSchemas ?? undefined,
    })
    if (!guard.ok) throw new Error(guard.error)
    for (const w of guard.warnings) console.warn(`[ChatSession] ${w}`)
    const safeAttachments = guard.sanitizedAttachments

    const timestamp = Date.now()

    // 1. 构建用户消息
    const userMessage: ChatMessage = {
      role: 'user',
      content: text,
      attachments: safeAttachments,
      timestamp,
    }
    this.messages.push(userMessage)
    this.emitter.emit('send', userMessage)

    // 2. 构建消息数组（包含历史）
    const llmMessages = this._buildLLMMessages()

    // 3. 调用 LLM（内部走流式以触发事件，但对外累积为完整响应）
    this._abortController = new AbortController()
    let firstTokenEmitted = false
    const safeToolSchemas = guard.sanitizedToolSchemas as Record<string, unknown>[] | undefined
    const stream = this.caller.callStream({
      sessionId: `chat-${Date.now()}`,
      roundIndex: this.messages.length,
      preset: this.preset,
      messages: llmMessages as Record<string, string>[],
      autoFormat: !!this.jsonSettings,
      jsonSettings: this.jsonSettings,
      stream: true,
      toolSchemas: safeToolSchemas,
      nativeToolCalling: safeToolSchemas ? true : undefined,
      abortSignal: this._abortController.signal,
    })

    let accumulatedContent = ''
    let result = await stream.next()
    while (!result.done) {
      // 检查中断
      if (this._aborted) {
        this._aborted = false
        this.emitter.emit('abort', { type: 'abort' })
        break
      }
      const event = result.value as CallerStreamEvent
      if (event.type === 'thinking_delta') {
        // 非流式 send 也透传思考事件（累积但不对外 yield）
        this.emitter.emit('delta', { type: 'thinking', thinking: String(event.data.delta ?? '') })
      } else if (event.type === 'assistant_delta' && event.data?.delta) {
        const deltaText = String(event.data.delta)
        accumulatedContent += deltaText
        if (!firstTokenEmitted) {
          this.emitter.emit('first_token', { content: deltaText })
          this.emitter.emit('output_start')
          firstTokenEmitted = true
        }
        this.emitter.emit('delta', { type: 'delta', delta: deltaText, content: accumulatedContent })
      } else if (event.type === 'tool_pending') {
        this.emitter.emit('tool_call', { type: 'tool_call', toolCall: event.data.tool })
      } else if (event.type === 'model.error') {
        this.emitter.emit('error', { type: 'error', error: event.data.error })
      }
      result = await stream.next()
    }
    if (firstTokenEmitted) {
      this.emitter.emit('output_end')
    }

    // 4. 构建 assistant 消息
    // 注意：abort 中断时 result.value 可能是 undefined（generator 未正常 return）
    const callResult = result.value as ModelCallResult | undefined
    const content = callResult?.content ?? accumulatedContent
    const nativeToolCalls = callResult?.nativeToolCalls ?? []
    const usage = callResult?.usage ?? null

    const assistantMessage: ChatMessage = {
      role: 'assistant',
      content,
      toolCalls: nativeToolCalls.length > 0 ? nativeToolCalls : undefined,
      usage: usage ?? undefined,
      timestamp: Date.now(),
    }
    this.messages.push(assistantMessage)

    // 5. 触发事件
    this.emitter.emit('receive', assistantMessage)

    // 6. 返回响应
    return {
      content,
      toolCalls: nativeToolCalls,
      usage,
      rawResponse: callResult?.rawResponse ?? content,
      message: assistantMessage,
    }
  }

  // ── 发送消息（流式）──

  async *sendStream(text: string, options?: { attachments?: Attachment[] }): AsyncGenerator<ChatDelta> {
    // 0. 防傻瓜校验
    const guard = validateRequest({
      preset: this.preset,
      text,
      attachments: options?.attachments,
      reasoningLevel: this.reasoningLevel,
      toolSchemas: this.toolSchemas ?? undefined,
    })
    if (!guard.ok) throw new Error(guard.error)
    for (const w of guard.warnings) console.warn(`[ChatSession] ${w}`)
    const safeAttachments = guard.sanitizedAttachments

    const timestamp = Date.now()

    // 1. 构建用户消息
    const userMessage: ChatMessage = {
      role: 'user',
      content: text,
      attachments: safeAttachments,
      timestamp,
    }
    this.messages.push(userMessage)
    this.emitter.emit('send', userMessage)

    // 2. 构建消息数组
    const llmMessages = this._buildLLMMessages()

    // 3. 调用 LLM 流式
    this._abortController = new AbortController()
    const safeToolSchemas = guard.sanitizedToolSchemas as Record<string, unknown>[] | undefined
    const stream = this.caller.callStream({
      sessionId: `chat-${Date.now()}`,
      roundIndex: this.messages.length,
      preset: this.preset,
      messages: llmMessages as Record<string, string>[],
      autoFormat: !!this.jsonSettings,
      jsonSettings: this.jsonSettings,
      stream: true,
      toolSchemas: safeToolSchemas,
      nativeToolCalling: safeToolSchemas ? true : undefined,
      abortSignal: this._abortController.signal,
    })

    let accumulatedContent = ''
    let accumulatedThinking = ''
    let toolCalls: LLMToolCall[] = []
    let usage: LLMUsage | null = null
    let rawResponse = ''
    let firstTokenEmitted = false
    let thinkingActive = false

    // 流式 JSON 字段提取器
    const jsonAcc = new StreamJsonAccumulator()

    let result = await stream.next()
    while (!result.done) {
      // 检查中断
      if (this._aborted) {
        this._aborted = false
        this.emitter.emit('abort', { type: 'abort' })
        break
      }

      const event = result.value as CallerStreamEvent

      // 思考/推理内容增量
      if (event.type === 'thinking_delta') {
        const thinkingDelta = String(event.data.delta ?? '')
        if (thinkingDelta) {
          if (!thinkingActive) {
            thinkingActive = true
            this.emitter.emit('thinking_start', { type: 'thinking_start' })
          }
          accumulatedThinking += thinkingDelta
          const chatDelta: ChatDelta = {
            type: 'thinking',
            thinking: thinkingDelta,
            thinkingContent: accumulatedThinking,
          }
          this.emitter.emit('delta', chatDelta)
          yield chatDelta
        }
        result = await stream.next()
        continue
      }

      if (event.type === 'assistant_delta') {
        const delta = event.data.delta as string
        if (!delta) { result = await stream.next(); continue }

        accumulatedContent += delta

        // 首字事件
        if (!firstTokenEmitted) {
          firstTokenEmitted = true
          this.emitter.emit('first_token', { type: 'first_token', content: delta })
          this.emitter.emit('output_start', { type: 'output_start' })
        }

        const chatDelta: ChatDelta = {
          type: 'delta',
          delta,                          // 增量：本次新增的字符
          content: accumulatedContent,     // 累积：从头到现在的完整文本
        }
        this.emitter.emit('delta', chatDelta)
        yield chatDelta

        // ── 流式 JSON 字段提取 ──
        jsonAcc.feed(delta)

        // 检测工具调用（从结构化输出中）
        const toolDetected = jsonAcc.detectToolCall()
        if (toolDetected) {
          yield {
            type: 'tool_call',
            toolName: toolDetected.name,
            toolComplete: toolDetected.complete,
            content: accumulatedContent,
          }
        }

        // 检查新完成的字段
        for (const field of jsonAcc.getNewFields()) {
          const fieldDelta: ChatDelta = {
            type: 'field_complete',
            fieldName: field.name,
            fieldValue: field.value,
            content: accumulatedContent,
          }
          this.emitter.emit('delta', fieldDelta)
          yield fieldDelta
        }

        // 检查正在流式输出的字符串字段
        for (const [, sf] of jsonAcc.getStreamingFields()) {
          if (!sf.complete && sf.delta) {
            const streamDelta: ChatDelta = {
              type: 'field_streaming',
              fieldName: sf.name,
              fieldContent: sf.content,
              fieldDelta: sf.delta,
              content: accumulatedContent,
            }
            this.emitter.emit('delta', streamDelta)
            yield streamDelta
          }
        }
      } else if (event.type === 'tool_pending') {
        const tc = event.data.tool as LLMToolCall
        if (thinkingActive) {
          thinkingActive = false
          this.emitter.emit('thinking_end', { type: 'thinking_end' })
        }
        const chatDelta: ChatDelta = { type: 'tool_call', toolCall: tc }
        this.emitter.emit('tool_call', chatDelta)
        yield chatDelta
      } else if (event.type === 'model.error') {
        const err = String(event.data.error)
        const chatDelta: ChatDelta = { type: 'error', error: err }
        this.emitter.emit('error', chatDelta)
        yield chatDelta
      }

      result = await stream.next()
    }

    // 4. 获取最终结果（generator 返回值）
    if (result.done) {
      const callResult = result.value as ModelCallResult
      accumulatedContent = callResult.content || accumulatedContent
      toolCalls = callResult.nativeToolCalls
      usage = callResult.usage
      rawResponse = callResult.rawResponse
    }

    // 关闭思考 / 输出状态
    if (thinkingActive) {
      this.emitter.emit('thinking_end', { type: 'thinking_end' })
    }
    if (firstTokenEmitted) {
      this.emitter.emit('output_end', { type: 'output_end' })
    }

    // 5. 构建 assistant 消息
    const assistantMessage: ChatMessage = {
      role: 'assistant',
      content: accumulatedContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: usage ?? undefined,
      timestamp: Date.now(),
    }
    this.messages.push(assistantMessage)

    // 6. 触发事件
    this.emitter.emit('receive', assistantMessage)
  }

  // ── 中断 ──

  abort(): void {
    this._aborted = true
    // 真正中断底层 fetch + 流读取
    this._abortController?.abort()
    this._abortController = null
  }

  // ── 资源清理 ──

  /**
   * 注册一个会话级清理回调（如关闭注入的 WebSocket、释放句柄）。
   * dispose() 时按注册逆序执行。
   */
  onCleanup(fn: () => void | Promise<void>): this {
    this._cleanupFns.push(fn)
    return this
  }

  /**
   * 销毁会话：中断进行中的请求，并按逆序执行全部清理回调（单个失败不影响其余）。
   */
  async dispose(): Promise<void> {
    this.abort()
    const fns = this._cleanupFns.splice(0).reverse()
    for (const fn of fns) {
      try { await fn() } catch { /* 清理失败不影响其余 */ }
    }
  }

  // ── 获取历史 ──

  getHistory(): ChatMessage[] {
    return [...this.messages]
  }

  // ── 清空历史 ──

  clearHistory(): void {
    this.messages = []
  }

  // ── 替换历史（用于跨厂商交接 / 外部恢复会话）──

  setHistory(messages: ChatMessage[]): void {
    this.messages = [...messages]
  }

  // ── 重试 / 续传（一流操作）──

  /**
   * 重试上一轮：移除最后一条 assistant 消息（若有），重新发起。
   * 用于"模型答得不好/中断，重来一次"。保留历史上下文。
   */
  async retry(options?: { attachments?: Attachment[] }): Promise<ChatResponse> {
    // 移除最后一条 assistant（重试的就是它）；若末条是 user 则直接重发
    if (this.messages.length > 0 && this.messages[this.messages.length - 1].role === 'assistant') {
      const lastUser = [...this.messages].reverse().find((m) => m.role === 'user')
      this.messages.pop() // 移除 assistant
      if (!lastUser) throw new Error('retry: 历史里没有 user 消息可重发')
      return this.send(lastUser.content, { attachments: options?.attachments ?? lastUser.attachments })
    }
    throw new Error('retry: 上一条不是 assistant，无需重试')
  }

  /**
   * 从一个（被中断/出错的）AssistantMessage 续传：把它的部分内容当作 assistant 历史存入，
   * 调用方可继续追加 user 消息让模型接着写。
   * 用于 stream 的 abort/error 后"断点续传"。
   */
  resumeFrom(partial: { content?: string; toolCalls?: LLMToolCall[] }): void {
    const msg: ChatMessage = {
      role: 'assistant',
      content: partial.content ?? '',
      toolCalls: partial.toolCalls && partial.toolCalls.length > 0 ? partial.toolCalls : undefined,
      timestamp: Date.now(),
    }
    this.messages.push(msg)
  }

  // ── 获取原始发送请求 ──

  buildRequest(text: string): { url: string; headers: Record<string, string>; body: string } {
    const gateway = new ProtocolGateway()
    const protocol = normalizeApiProtocol(this.preset.protocol)
    const adapter = gateway.resolve(protocol)
    const url = completeApiUrl(this.preset.url ?? '', protocol)
    const headers = adapter.buildRequestHeaders(this.preset)

    // 构建只包含当前输入的消息（不包含历史）
    const messages: Record<string, unknown>[] = [{ role: 'user', content: text }]

    const payload = adapter.buildRequestPayload({
      preset: this.preset,
      messages,
      stream: false,
      toolSchemas: this.toolSchemas,
      jsonSettings: this.jsonSettings,
      nativeToolCalling: this.toolSchemas ? true : false,
    })

    return { url, headers, body: JSON.stringify(payload) }
  }

  // ── 设置思考强度（统一 5 级：minimal/low/medium/high/xhigh + off）──

  setReasoning(level: ReasoningLevel, opts?: { budgetTokens?: number }): void {
    try {
      // 写入规范形 reasoning_params；各协议适配器会自动翻译为 reasoning_effort / thinkingConfig 等
      this.preset.reasoning_params = reasoningParamsFor(level, opts)
      this.reasoningLevel = level
    } catch (err) {
      this.emitter.emit('parse_error', { type: 'parse_error', error: String(err) })
    }
  }

  // ── 原生工具调用 ──

  /**
   * 设置原生工具 schema。设置后，send/sendStream 会把 tools 传给模型，
   * 模型可以主动发起工具调用（nativeToolCalling）。
   *
   * 注意：发送时若 preset.nativeToolCalling === false，guardrail 会 warn 并丢弃 toolSchemas。
   *
   * @param schemas 工具 schema 数组，格式同 OpenAI function calling
   */
  setTools(schemas: Record<string, unknown>[]): void {
    this.toolSchemas = schemas
  }

  /** 清除工具 schema */
  clearTools(): void {
    this.toolSchemas = null
  }

  // ── 结构化输出（JSON Schema）──

  /**
   * 设置结构化输出 schema。设置后，send/sendStream 会用 autoFormat + jsonSettings，
   * 让模型输出符合 schema 的 JSON。
   *
   * @param schema jsonSettings 对象，支持字段：
   *   - schema / schema_template：JSON Schema 字符串或对象
   *   - 其他 deriveJsonSettings 支持的字段
   */
  setJsonSchema(schema: Record<string, unknown>): void {
    this.jsonSettings = schema
  }

  /** 清除结构化输出设置 */
  clearJsonSchema(): void {
    this.jsonSettings = null
  }

  // ── Token 统计 ──

  getTotalUsage(): { input: number; output: number; cacheHit: number; total: number; cost: CostBreakdown | null } {
    let input = 0
    let output = 0
    let cacheHit = 0
    let total = 0

    for (const msg of this.messages) {
      if (!msg.usage) continue
      input += msg.usage.prompt_tokens ?? 0
      output += msg.usage.completion_tokens ?? 0
      total += msg.usage.total_tokens ?? 0
      // 尝试常见的 cache token 字段
      for (const key of ['cache_read_input_tokens', 'cache_hit_tokens']) {
        const v = msg.usage[key]
        if (typeof v === 'number') { cacheHit += v; break }
      }
    }

    // 计算成本（基于 preset 的 pricing 配置）
    const pricing = (this.preset as Record<string, unknown>).pricing as Pricing | undefined
    const aggregatedUsage = {
      prompt_tokens: input,
      completion_tokens: output,
      total_tokens: total,
      cache_read_input_tokens: cacheHit,
    }
    const cost = computeCost(aggregatedUsage, pricing)

    return { input, output, cacheHit, total, cost }
  }

  // ── 获取当前预设 ──

  getPreset(): APIPreset {
    return { ...this.preset }
  }

  // ── 更新预设 ──

  setPreset(preset: APIPreset): void {
    this.preset = preset
  }

  // ── 内部：构建发送给 LLM 的消息数组 ──

  private _buildLLMMessages(): Record<string, unknown>[] {
    const result: Record<string, unknown>[] = []

    for (const msg of this.messages) {
      // 跳过带 usage 的 assistant 消息中重复的 usage 字段
      if (msg.attachments && msg.attachments.length > 0) {
        result.push({
          role: msg.role,
          content: this._buildMultimodalContent(msg.content, msg.attachments),
        })
      } else {
        result.push({ role: msg.role, content: msg.content })
      }
    }

    return result
  }

  // ── 内部：构建多模态 content 数组 ──
  // 尽力而为地按各厂商 API 约定输出对应格式：
  // - image：image_url（OpenAI 兼容）/ image source（Anthropic 由 adapter 转换）
  // - audio：input_audio（OpenAI gpt-4o-audio 支持）
  // - document：document source（Anthropic 支持 PDF 等）
  // - video：暂无主流厂商直接支持二进制视频，用文本描述占位（建议外部预先抽帧转 image）

  private _buildMultimodalContent(text: string, attachments: Attachment[]): unknown[] {
    const parts: unknown[] = [{ type: 'text', text }]

    for (const att of attachments) {
      switch (att.type) {
        case 'image':
          parts.push({
            type: 'image_url',
            image_url: { url: `data:${att.mimeType};base64,${att.data}` },
          })
          break
        case 'audio':
          // OpenAI gpt-4o-audio 的 input_audio 格式
          parts.push({
            type: 'input_audio',
            input_audio: {
              data: att.data,
              format: (att.mimeType.split('/')[1] ?? 'mp3').toLowerCase(),
            },
          })
          // 附带文本描述，方便不支持音频的模型理解
          parts.push({ type: 'text', text: `[音频附件: ${att.name ?? 'audio'} (${att.mimeType})]` })
          break
        case 'document':
          // Anthropic document source 格式（PDF 等）
          // 同时放 OpenAI 兼容的 image_url（部分模型能处理），用 data URL
          parts.push({
            type: 'image_url',
            image_url: { url: `data:${att.mimeType};base64,${att.data}` },
            // Anthropic adapter 会识别 document 类型并转换
            _document: {
              type: 'document',
              source: {
                type: 'base64',
                media_type: att.mimeType,
                data: att.data,
              },
            },
          })
          parts.push({ type: 'text', text: `[文档附件: ${att.name ?? 'document'} (${att.mimeType})]` })
          break
        case 'video':
          // 主流厂商不直接支持二进制视频，文本描述占位
          // 建议：外部预先抽帧为多个 image 附件，或用支持视频的专有 API
          parts.push({ type: 'text', text: `[视频附件: ${att.name ?? 'video'} (${att.mimeType})，请外部抽帧后以图片形式提供]` })
          break
      }
    }

    return parts
  }
}
