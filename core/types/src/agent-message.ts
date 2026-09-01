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
 * 写入会话 / 喂模型时：有发送者则包成
 * `<message from="help" name="门磁">content</message>`。
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

/** 信封类型：普通投递 / 回复 / 子会话汇报 */
export type SenderEnvelopeType = "message" | "reply" | "report";

export type SenderEnvelope = {
  body: string;
  /** Agent / 会话身份，模型侧认发送者 */
  from?: string;
  /** 展示名（webhook 传感器等） */
  name?: string;
  to?: string;
  type?: SenderEnvelopeType;
  inReplyTo?: string;
};

function escapeXmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function hasSender(env: SenderEnvelope): boolean {
  return Boolean(env.from?.trim() || env.name?.trim());
}

/** 已经是 `<message …>…</message>` 整段。 */
export function isSenderEnvelope(text: string): boolean {
  return /^<message\b[^>]*>[\s\S]*<\/message>\s*$/.test(text.trim());
}

/** 带 from= 的信封：队友 / 子会话发出。 */
export function isAgentSenderEnvelope(text: string): boolean {
  return /^<message\b[^>]*\bfrom=/.test(text.trim());
}

/**
 * 有发送者时包一层 XML；无发送者原样返回。
 * 不重复包裹已经是信封的正文。
 */
export function formatSenderEnvelope(env: SenderEnvelope): string {
  const body = env.body;
  if (isSenderEnvelope(body)) return body.trim();
  if (!hasSender(env)) return body;
  const attrs: string[] = [];
  const from = env.from?.trim();
  const name = env.name?.trim();
  const to = env.to?.trim();
  const type = env.type && env.type !== "message" ? env.type : undefined;
  const reply = env.inReplyTo?.trim();
  if (from) attrs.push(`from="${escapeXmlAttr(from)}"`);
  if (name) attrs.push(`name="${escapeXmlAttr(name)}"`);
  if (to) attrs.push(`to="${escapeXmlAttr(to)}"`);
  if (type) attrs.push(`type="${type}"`);
  if (reply) attrs.push(`in_reply_to="${escapeXmlAttr(reply)}"`);
  return `<message ${attrs.join(" ")}>${body}</message>`;
}

export function unwrapSenderEnvelope(text: string): string {
  const t = text.trim();
  const m = t.match(/^<message\b[^>]*>([\s\S]*)<\/message>$/);
  return m ? m[1]! : text;
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
