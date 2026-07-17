/**
 * 「最新一轮」= 最后一条真人 user 消息及其之后的全部消息。
 * 用于：最新轮正文默认展开；历史轮正文默认折叠（工具卡仍折叠）。
 */

import type { ChatMessage } from "../../state/types.js";

/** 是否为对话里的真人用户气泡（非 system_notice 等） */
export function isHumanUserMessage(m: ChatMessage): boolean {
  if (m.role !== "user") return false;
  const kind = m.kind ?? "human_user";
  if (
    kind === "system_notice" ||
    kind === "runtime_control" ||
    kind === "agent_message" ||
    kind === "compact" ||
    kind === "unknown"
  ) {
    return false;
  }
  return true;
}

/** 最后一条真人 user 在 messages 中的下标；无则 -1 */
export function lastHumanUserIndex(messages: readonly ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isHumanUserMessage(messages[i]!)) return i;
  }
  return -1;
}

/** 该消息是否属于「最新一轮」（含该轮的 user 本身） */
export function isInLatestRound(
  messages: readonly ChatMessage[],
  msgId: string,
): boolean {
  const last = lastHumanUserIndex(messages);
  if (last < 0) return true;
  const idx = messages.findIndex((m) => m.id === msgId);
  if (idx < 0) return true;
  return idx >= last;
}
