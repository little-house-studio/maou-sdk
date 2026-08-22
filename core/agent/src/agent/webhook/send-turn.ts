/**
 * webhook 开口：AgentSendMessage → 投递/入队/跑 Runtime 的共用字段。
 */
import type {
  AgentSendMessage,
  AgentSendMode,
  MessageMedia,
  WebhookAgentMessage,
  WebhookSendMode,
} from "@little-house-studio/types";
import {
  agentSendAudio,
  agentSendImages,
  agentSendVideo,
  formatAgentSendRuntimeText,
  formatAgentSendSessionText,
  resolveAgentSendMode,
  toAgentSendMessage,
} from "@little-house-studio/context";

export type NormalizedSendTurn = {
  turn: AgentSendMessage;
  /** 指令匹配用（带 /command） */
  runtimeText: string;
  /** 写入会话用（带 <message name>） */
  sessionText: string;
  name: string;
  command?: string;
  images: MessageMedia[];
  video: MessageMedia[];
  audio: MessageMedia[];
  mode: AgentSendMode | "now";
  queueMeta: Record<string, unknown>;
};

/** busy 时：queue 入队；insert 插入当前 run；stop_and_send 停掉再发；now 也入队 */
export function sendDelivery(
  mode: AgentSendMode | "now",
  busy: boolean,
): "start" | "queue" | "insert" | "stop_and_send" {
  if (!busy) return "start";
  if (mode === "insert") return "insert";
  if (mode === "stop_and_send") return "stop_and_send";
  return "queue";
}

export function normalizeSendTurn(
  input: WebhookAgentMessage,
  envelopeMode?: WebhookSendMode | string | null,
): NormalizedSendTurn {
  const turn = toAgentSendMessage(input);
  const images = agentSendImages(turn);
  const video = agentSendVideo(turn);
  const audio = agentSendAudio(turn);
  const name = (turn.name ?? "").trim() || "user";
  return {
    turn,
    runtimeText: formatAgentSendRuntimeText(turn),
    sessionText: formatAgentSendSessionText(turn),
    name,
    command: turn.command,
    images,
    video,
    audio,
    mode: resolveAgentSendMode(turn, envelopeMode),
    queueMeta: {
      ...(images.length ? { images } : {}),
      ...(video.length ? { video } : {}),
      ...(audio.length ? { audio } : {}),
      ...(turn.name ? { name: turn.name } : {}),
      ...(turn.command ? { command: turn.command } : {}),
    },
  };
}
