/**
 * Agent 发送消息 vs 工具回包。
 * 发给 agent 的那条是 AgentSendMessage；工具返回走 ToolMessage，不要混用。
 */

export type AgentSendMode = 'queue' | 'insert' | 'stop_and_send'

export interface MessageMedia {
  mimeType: string
  data: string
}

/** content 可以是单条文本，或文本块数组 */
export type AgentSendContentBlock = string | { type?: string; text?: string; content?: string }

/**
 * 发给 Agent 的消息（webhook / Runtime / 队列共用）。
 * 写入会话时：有 name 则包成 `<message name="name">content</message>`。
 */
export interface AgentSendMessage {
  name?: string
  content: string | AgentSendContentBlock[]
  image?: MessageMedia | MessageMedia[]
  video?: MessageMedia | MessageMedia[]
  audio?: MessageMedia | MessageMedia[]
  /** 附带指令（如 goal）→ 按 /command 走指令表 */
  command?: string
  send_mode?: AgentSendMode
}

/**
 * 工具返回消息。不是 AgentSendMessage。
 */
export interface ToolMessage {
  name: string
  content: string
  ok: boolean
  toolCallId?: string
  images?: MessageMedia[]
  payload?: Record<string, unknown>
  error?: string
  elapsed?: number
}

export function toToolMessage(
  input: Pick<ToolMessage, 'name' | 'content' | 'ok'> & Partial<ToolMessage>,
): ToolMessage {
  return {
    name: input.name,
    content: input.content,
    ok: input.ok,
    ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
    ...(input.images?.length ? { images: input.images } : {}),
    ...(input.payload && Object.keys(input.payload).length
      ? { payload: input.payload }
      : {}),
    ...(input.error ? { error: input.error } : {}),
    ...(input.elapsed != null ? { elapsed: input.elapsed } : {}),
  }
}
