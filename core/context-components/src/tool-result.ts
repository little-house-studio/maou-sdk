/**
 * 统一 tool_result 写入。
 *
 * 同一 toolCallId：第一次写成 role=tool（对称 assistant.tool_calls）；
 * 之后自动写成 role=user。工具不必自己判断第几轮。
 * 写 user 前若尾部还有未配对 tool_call，先补占位，避免插到中间。
 */
import type { ToolMessage } from "@little-house-studio/types";
import { toToolMessage } from "@little-house-studio/types";
import type { SessionStore } from "./session-store.js";
import { appendSessionEvent, authorTool } from "./session-event.js";

export type AppendToolResultOutcome = {
  wireRole: "tool" | "user";
  firstPair: boolean;
  patchedOrphans: number;
};

function asRecord(m: unknown): Record<string, unknown> {
  return m && typeof m === "object" && !Array.isArray(m)
    ? (m as Record<string, unknown>)
    : {};
}

function asArgsRecord(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      return asRecord(JSON.parse(raw));
    } catch {
      return {};
    }
  }
  return asRecord(raw);
}

function toolCallIdsOf(msg: Record<string, unknown>): string[] {
  const raw = msg.toolCalls ?? msg.tool_calls ?? msg.native_tool_calls;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((tc) => String((tc as { id?: string }).id ?? "").trim())
    .filter(Boolean);
}

function toolResultId(msg: Record<string, unknown>): string {
  return String(msg.toolCallId ?? msg.tool_call_id ?? "").trim();
}

function isToolWire(msg: Record<string, unknown>): boolean {
  return String(msg.role ?? "") === "tool" || msg.kind === "tool_result";
}

export function isToolCallIdPaired(
  messages: Array<Record<string, unknown>>,
  toolCallId: string,
): boolean {
  if (!toolCallId) return false;
  return messages.some((m) => isToolWire(m) && toolResultId(m) === toolCallId);
}

/** 尾部尚未闭合的那一批 assistant.tool_calls 里，还缺 tool_result 的 id */
export function pendingToolCallIdsAtTail(
  messages: Array<Record<string, unknown>>,
): string[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m) continue;
    if (isToolWire(m)) continue;
    if (String(m.role ?? "") === "assistant") {
      const ids = toolCallIdsOf(m);
      if (ids.length === 0) return [];
      return ids.filter((id) => {
        for (let j = i + 1; j < messages.length; j++) {
          const n = messages[j];
          if (!n) continue;
          if (String(n.role ?? "") === "assistant") break;
          if (isToolWire(n) && toolResultId(n) === id) return false;
        }
        return true;
      });
    }
    return [];
  }
  return [];
}

export function formatToolFollowupText(msg: ToolMessage): string {
  const body = msg.content ?? "";
  if (body.includes("<tool-followup") || body.includes("<terminal-message>")) {
    return body;
  }
  const idAttr = msg.toolCallId
    ? ` id="${msg.toolCallId.replace(/"/g, "&quot;")}"`
    : "";
  const name = (msg.name || "tool").replace(/"/g, "&quot;");
  return `<tool-followup name="${name}"${idAttr}>\n${body}\n</tool-followup>`;
}

export function findToolCallIdByPayload(
  messages: Array<Record<string, unknown>>,
  key: string,
  value: string,
): string | undefined {
  if (!value) return undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m) continue;

    const bags = [
      asRecord(m.tool_parameters),
      asRecord(m.payload),
      asRecord(m.tool_call),
      asArgsRecord(m.arguments),
      asArgsRecord(m.parameters),
    ];
    for (const params of bags) {
      if (String(params[key] ?? "") !== value) continue;
      const id = toolResultId(m) || String(params.id ?? "").trim();
      if (id) return id;
    }

    const calls = m.toolCalls ?? m.tool_calls ?? m.native_tool_calls;
    if (!Array.isArray(calls)) continue;
    for (const raw of calls) {
      const tc = asRecord(raw);
      const fn = asRecord(tc.function);
      const args = asArgsRecord(tc.arguments ?? tc.parameters ?? fn.arguments);
      if (String(args[key] ?? tc[key] ?? "") !== value) continue;
      const id = String(tc.id ?? "").trim();
      if (id) return id;
    }
  }
  return undefined;
}

export function appendToolResult(
  sessions: SessionStore,
  sessionId: string,
  input: ToolMessage | (Pick<ToolMessage, "name" | "content" | "ok"> & Partial<ToolMessage>),
  extra: {
    source?: string;
    round?: number;
    meta?: Record<string, unknown>;
  } = {},
): AppendToolResultOutcome {
  const msg = toToolMessage(input);
  const data = sessions.load(sessionId);
  const messages = (data?.messages ?? []) as Array<Record<string, unknown>>;
  const id = (msg.toolCallId ?? "").trim();
  const pending = pendingToolCallIdsAtTail(messages);
  const alreadyPaired = id ? isToolCallIdPaired(messages, id) : false;
  const canPair = Boolean(id) && !alreadyPaired && pending.includes(id);

  let patchedOrphans = 0;
  if (!canPair && pending.length > 0) {
    patchedOrphans = patchPendingToolInterrupts(
      sessions,
      sessionId,
      (name) => `工具 ${name} 仍在执行，结果将以后续消息送达`,
    );
  }

  const source = extra.source ?? (canPair ? "tool" : "tool-followup");
  const meta = {
    toolCallId: id || undefined,
    tool_call_id: id || undefined,
    tool_name: msg.name,
    tool_ok: msg.ok,
    tool_message: msg,
    ...(msg.images?.length ? { images: msg.images } : {}),
    ...(msg.payload ? { payload: msg.payload } : {}),
    ...(msg.error ? { error: msg.error } : {}),
    ...(msg.elapsed != null ? { elapsed: msg.elapsed } : {}),
    ...(extra.round != null ? { round: extra.round } : {}),
    ...extra.meta,
  };

  if (canPair) {
    appendSessionEvent(sessions, sessionId, {
      kind: "tool_result",
      wireRole: "tool",
      content: msg.content,
      source,
      author: authorTool(msg.name, msg.name),
      meta,
    });
    return { wireRole: "tool", firstPair: true, patchedOrphans };
  }

  appendSessionEvent(sessions, sessionId, {
    kind: "tool_async_notify",
    wireRole: "user",
    content: formatToolFollowupText(msg),
    source,
    author: authorTool(msg.name, msg.name),
    meta,
  });
  return { wireRole: "user", firstPair: false, patchedOrphans };
}

/** 尾部未配对的 tool_call 全部补占位 tool_result。供队列投递 / 写 follow-up 前调用。 */
export function patchPendingToolInterrupts(
  sessions: SessionStore,
  sessionId: string,
  placeholder?: string | ((name: string, id: string) => string),
): number {
  const data = sessions.load(sessionId);
  const messages = (data?.messages ?? []) as Array<Record<string, unknown>>;
  const pending = pendingToolCallIdsAtTail(messages);
  if (pending.length === 0) return 0;
  const lastAssistant = [...messages]
    .reverse()
    .find((m) => String(m.role ?? "") === "assistant");
  const calls = lastAssistant
    ? ((lastAssistant.toolCalls ??
        lastAssistant.tool_calls ??
        lastAssistant.native_tool_calls ??
        []) as Array<Record<string, unknown>>)
    : [];
  let n = 0;
  for (const id of pending) {
    const tc = calls.find((c) => String(c.id ?? "") === id);
    const fn = tc?.function as { name?: string } | undefined;
    const name = String(tc?.name ?? fn?.name ?? "tool");
    const content =
      typeof placeholder === "function"
        ? placeholder(name, id)
        : (placeholder ?? `工具 ${name} 已被用户打断`);
    appendSessionEvent(sessions, sessionId, {
      kind: "tool_result",
      wireRole: "tool",
      content,
      source: "tool",
      author: authorTool(name, name),
      meta: {
        toolCallId: id,
        tool_call_id: id,
        tool_name: name,
        tool_ok: false,
        interrupted: placeholder == null,
        tool_message: toToolMessage({
          name,
          content,
          ok: false,
          toolCallId: id,
        }),
      },
    });
    n++;
  }
  return n;
}
