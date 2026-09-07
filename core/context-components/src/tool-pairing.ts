/**
 * 压缩切边：不能拆开尚未配完的 tool_call / tool_result。
 */

import type { MaouMessage } from "./types/message.js";

export function toolCallIdsOf(m: MaouMessage): string[] {
  const ids: string[] = [];
  if (m.toolCalls?.length) {
    for (const tc of m.toolCalls) {
      const id = String(tc.id ?? "").trim();
      if (id) ids.push(id);
    }
  }
  if ((m.category === "tool_call" || m.category === "assistant") && m.toolCallId) {
    const id = String(m.toolCallId).trim();
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function toolResultIdOf(m: MaouMessage): string {
  if (m.category !== "tool_result") return "";
  return String(m.toolCallId ?? "").trim();
}

/**
 * 从尾部往前累加 token 预算后的「保留区起点」再往左咬合：
 * 尾巴里的 tool_result，其 call 若在切点左侧，把 call 一并划进尾巴。
 */
export function snapRetainStartForToolPairs(
  messages: MaouMessage[],
  start: number,
): number {
  if (messages.length === 0) return 0;
  let i = Math.max(0, Math.min(start, messages.length));
  const retainedResultIds = new Set<string>();
  for (let k = i; k < messages.length; k++) {
    const id = toolResultIdOf(messages[k]!);
    if (id) retainedResultIds.add(id);
  }
  while (i > 0) {
    const prev = messages[i - 1]!;
    const prevCalls = toolCallIdsOf(prev);
    if (prevCalls.some((id) => retainedResultIds.has(id))) {
      i -= 1;
      continue;
    }
    break;
  }
  return i;
}

/** 切点左侧未闭合的 call，其 result 却在右侧 → 不平衡。 */
export function toolPairingBalancedAt(
  messages: MaouMessage[],
  cut: number,
): boolean {
  const open = new Set<string>();
  const end = Math.max(0, Math.min(cut, messages.length));
  for (let i = 0; i < end; i++) {
    for (const id of toolCallIdsOf(messages[i]!)) open.add(id);
    const rid = toolResultIdOf(messages[i]!);
    if (rid) open.delete(rid);
  }
  for (let i = end; i < messages.length; i++) {
    const rid = toolResultIdOf(messages[i]!);
    if (rid && open.has(rid)) return false;
  }
  return true;
}
