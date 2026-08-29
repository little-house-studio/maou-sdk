/**
 * 冷打开：把未闭合的工具调用分成「没开始」和「结局未知」。
 */

import type { SessionLedgerEvent } from "@little-house-studio/types";

export const TOOL_NOT_STARTED = "tool_not_started";
export const TOOL_OUTCOME_UNKNOWN = "tool_outcome_unknown";

export type RecoveredTool = {
  callId: string;
  name: string;
  code: typeof TOOL_NOT_STARTED | typeof TOOL_OUTCOME_UNKNOWN;
  content: string;
};

function callIdOf(ev: SessionLedgerEvent): string {
  const d = ev.data ?? {};
  return String(d.id ?? d.callId ?? d.toolCallId ?? d.tool_call_id ?? ev.messageId ?? "").trim();
}

function toolNameOf(ev: SessionLedgerEvent): string {
  return String(ev.data?.name ?? ev.data?.toolName ?? ev.data?.tool_name ?? "tool");
}

export function classifyUnclosedTools(events: SessionLedgerEvent[]): RecoveredTool[] {
  const calls = new Map<string, { name: string; dispatched: boolean; done: boolean }>();
  for (const ev of events) {
    if (ev.type === "tool/call") {
      const id = callIdOf(ev);
      if (!id) continue;
      const prev = calls.get(id) ?? { name: toolNameOf(ev), dispatched: false, done: false };
      prev.name = toolNameOf(ev) || prev.name;
      calls.set(id, prev);
    } else if (ev.type === "tool/dispatch") {
      const id = callIdOf(ev);
      if (!id) continue;
      const prev = calls.get(id) ?? { name: toolNameOf(ev), dispatched: false, done: false };
      prev.dispatched = true;
      prev.name = toolNameOf(ev) || prev.name;
      calls.set(id, prev);
    } else if (ev.type === "tool/result" || ev.type === "tool/async") {
      const id = callIdOf(ev) || String(ev.data?.toolCallId ?? ev.data?.tool_call_id ?? "").trim();
      if (!id) continue;
      const prev = calls.get(id) ?? { name: toolNameOf(ev), dispatched: false, done: false };
      prev.done = true;
      calls.set(id, prev);
    }
  }
  const out: RecoveredTool[] = [];
  for (const [callId, row] of calls) {
    if (row.done) continue;
    if (row.dispatched) {
      out.push({
        callId,
        name: row.name,
        code: TOOL_OUTCOME_UNKNOWN,
        content:
          `工具 ${row.name} 已发出去，但结果没记下来。结局未知。只重试只读或幂等的事，不要盲目重跑有副作用的操作。`,
      });
    } else {
      out.push({
        callId,
        name: row.name,
        code: TOOL_NOT_STARTED,
        content: `工具 ${row.name} 还没开始执行，可以再试。`,
      });
    }
  }
  return out;
}

export function compactLockOpen(events: SessionLedgerEvent[]): boolean {
  let open = false;
  for (const ev of events) {
    if (ev.type === "compact/start") open = true;
    if (ev.type === "compact/end") open = false;
  }
  return open;
}

/** 最后一条 turn/start 没有配对 turn/end。 */
export function classifyOpenTurn(
  events: SessionLedgerEvent[],
): { open: boolean; startSeq?: number } {
  let open = false;
  let startSeq: number | undefined;
  for (const ev of events) {
    if (ev.type === "turn/start") {
      open = true;
      startSeq = ev.seq;
    } else if (ev.type === "turn/end") {
      open = false;
      startSeq = undefined;
    }
  }
  return open ? { open: true, startSeq } : { open: false };
}
