/**
 * 把各种入站形态收成 AgentSendMessage（发给 Agent 的结构体）。
 * webhook / Runtime / 队列共用。工具回包不要走这里，用 ToolMessage。
 */
import type {
  AgentSendContentBlock,
  AgentSendMessage,
  AgentSendMode,
  MessageMedia,
} from "@little-house-studio/types";

function asText(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function collectMedia(raw: unknown): MessageMedia[] {
  const items = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
  const out: MessageMedia[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (o.type === "image" || o.type === "video" || o.type === "audio" || o.mimeType || o.mime_type) {
      const data = asText(o.data ?? o.url);
      const mimeType = asText(o.mimeType ?? o.mime_type) || "application/octet-stream";
      if (data) out.push({ mimeType, data });
    }
  }
  return out;
}

function flattenContent(body: unknown): { text: string; extraImages: MessageMedia[] } {
  if (typeof body === "string") return { text: body.trim(), extraImages: [] };
  if (!Array.isArray(body)) return { text: "", extraImages: [] };
  const texts: string[] = [];
  const extraImages: MessageMedia[] = [];
  for (const b of body as AgentSendContentBlock[]) {
    if (typeof b === "string") {
      if (b.trim()) texts.push(b.trim());
      continue;
    }
    if (!b || typeof b !== "object") continue;
    const o = b as Record<string, unknown>;
    const t = asText(o.text ?? o.content);
    if (t) texts.push(t);
    if (o.type === "image" || o.mimeType || o.mime_type) {
      extraImages.push(...collectMedia(o));
    }
  }
  return { text: texts.join("\n"), extraImages };
}

function parseSendMode(v: unknown): AgentSendMode | undefined {
  const m = asText(v).toLowerCase();
  if (!m) return undefined;
  if (m === "queue" || m === "队列") return "queue";
  if (m === "insert" || m === "插入") return "insert";
  if (
    m === "stop_and_send" ||
    m === "stop-and-send" ||
    m === "停止并发送" ||
    m === "stop"
  ) {
    return "stop_and_send";
  }
  return undefined;
}

function escapeXmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * 字符串、旧 Message、新 AgentSendMessage 都收成发送结构体。
 */
export function toAgentSendMessage(input: unknown): AgentSendMessage {
  if (typeof input === "string") {
    const content = input.trim();
    if (!content) throw new Error("message content required");
    return { content };
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("message must be a string or AgentSendMessage object");
  }
  const raw = input as Record<string, unknown>;
  const fromContent = flattenContent(raw.content ?? raw.text ?? raw.message ?? raw.prompt);
  const image = [
    ...collectMedia(raw.image ?? raw.images),
    ...fromContent.extraImages,
  ];
  const video = collectMedia(raw.video ?? raw.videos);
  const audio = collectMedia(raw.audio ?? raw.audios);
  const command = asText(raw.command).replace(/^\//, "");
  const name = asText(raw.name);
  const send_mode = parseSendMode(raw.send_mode ?? raw.sendMode);
  if (!fromContent.text && !command) throw new Error("message content required");
  return {
    content: fromContent.text,
    ...(name ? { name } : {}),
    ...(image.length ? { image } : {}),
    ...(video.length ? { video } : {}),
    ...(audio.length ? { audio } : {}),
    ...(command ? { command } : {}),
    ...(send_mode ? { send_mode } : {}),
  };
}

/** @deprecated 用 toAgentSendMessage */
export function toAgentUserMessage(input: unknown): AgentSendMessage {
  return toAgentSendMessage(input);
}

export function flattenAgentSendText(msg: AgentSendMessage): string {
  return flattenContent(msg.content).text;
}

/** 写入会话 / 给模型看的正文：有 name 则包裹 */
export function formatAgentSendSessionText(msg: AgentSendMessage): string {
  const text = flattenAgentSendText(msg);
  const name = asText(msg.name);
  if (!name) return text;
  return `<message name="${escapeXmlAttr(name)}">${text}</message>`;
}

/** 指令匹配用：`/goal 正文`；无 command 则同 session 文本 */
export function formatAgentSendRuntimeText(msg: AgentSendMessage): string {
  const session = formatAgentSendSessionText(msg);
  const command = asText(msg.command).replace(/^\//, "");
  if (!command) return session;
  const plain = flattenAgentSendText(msg);
  return plain ? `/${command} ${plain}` : `/${command}`;
}

export function agentSendImages(msg: AgentSendMessage): MessageMedia[] {
  return collectMedia(msg.image);
}

export function agentSendVideo(msg: AgentSendMessage): MessageMedia[] {
  return collectMedia(msg.video);
}

export function agentSendAudio(msg: AgentSendMessage): MessageMedia[] {
  return collectMedia(msg.audio);
}

export function resolveAgentSendMode(
  msg: AgentSendMessage,
  envelope?: string | null,
): AgentSendMode | "now" {
  return parseSendMode(msg.send_mode) ?? parseSendMode(envelope) ?? "now";
}

export function agentUserMessageText(input: unknown): string {
  return flattenAgentSendText(toAgentSendMessage(input));
}

export function unwrapAgentSendTag(text: string): string {
  const m = text.match(/^<message name="[^"]*">([\s\S]*)<\/message>$/);
  return m ? m[1]! : text;
}
