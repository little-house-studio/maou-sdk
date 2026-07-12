/**
 * 会话事件语义（Session Event）
 *
 * 三正交字段（市面主流）：
 * - **author** = 谁发的（human / agent / system / tool）
 * - **kind**   = 什么性质（chat / notice / control / tool_result …）
 * - **wireRole** = 怎么喂模型（可为 cache/API 妥协）
 *
 * 见 docs/SESSION_EVENT.md
 */

import type { SessionStore } from "./session-store.js";

// ── Author（发言人身份）────────────────────────────────────────────────────

/** 发言人类型 */
export type MessageAuthorType = "human" | "agent" | "system" | "tool";

/**
 * 发言人身份 — UI / 审计 / 压缩优先看这个，不看 wireRole
 */
export interface MessageAuthor {
  type: MessageAuthorType;
  /** 稳定 id：user_id / agent_name / tool_name / service_id */
  id?: string;
  /** UI 展示名 */
  displayName?: string;
}

export function authorHuman(id = "user", displayName = "user"): MessageAuthor {
  return { type: "human", id, displayName };
}

export function authorAgent(id: string, displayName?: string): MessageAuthor {
  return { type: "agent", id, displayName: displayName ?? id };
}

export function authorSystem(id: string, displayName?: string): MessageAuthor {
  return { type: "system", id, displayName: displayName ?? id };
}

export function authorTool(id: string, displayName?: string): MessageAuthor {
  return { type: "tool", id, displayName: displayName ?? id };
}

/** UI 头栏标签：user | agent:coder | system:todo | tool:use_terminal */
export function formatAuthorLabel(author: MessageAuthor | undefined | null): string {
  if (!author?.type) return "unknown";
  const name = author.displayName || author.id;
  switch (author.type) {
    case "human":
      return name && name !== "user" ? `user:${name}` : "user";
    case "agent":
      return name ? `agent:${name}` : "agent";
    case "system":
      return name ? `system:${name}` : "system";
    case "tool":
      return name ? `tool:${name}` : "tool";
    default:
      return "unknown";
  }
}

// ── Kind（业务性质）────────────────────────────────────────────────────────

export type SessionEventKind =
  | "human_user"
  | "queued_user"
  | "agent_message"
  | "runtime_control"
  | "system_notice"
  | "tool_call"
  | "tool_result"
  | "tool_async_notify"
  | "assistant_turn"
  | "compact"
  | "unknown";

const SOURCE_KIND: Record<string, SessionEventKind> = {
  human: "human_user",
  user: "human_user",
  cli: "human_user",
  feishu: "human_user",
  message_bus: "agent_message",
  empty_retry: "runtime_control",
  verification: "runtime_control",
  todo_notice: "system_notice",
  "terminal-notification": "tool_async_notify",
  hook: "system_notice",
  injected: "system_notice",
};

export function isSessionEventKind(s: string): s is SessionEventKind {
  return (
    s === "human_user" ||
    s === "queued_user" ||
    s === "agent_message" ||
    s === "runtime_control" ||
    s === "system_notice" ||
    s === "tool_call" ||
    s === "tool_result" ||
    s === "tool_async_notify" ||
    s === "assistant_turn" ||
    s === "compact" ||
    s === "unknown"
  );
}

export function resolveSessionEventKind(msg: {
  role?: string;
  source?: string;
  kind?: string;
  toolCallId?: string;
  tool_call_id?: string;
  content?: string;
  queued?: boolean;
  author?: MessageAuthor | Record<string, unknown>;
}): SessionEventKind {
  if (msg.kind && isSessionEventKind(msg.kind)) return msg.kind;

  const source = String(msg.source ?? "");
  if (source && SOURCE_KIND[source]) return SOURCE_KIND[source];
  if (msg.queued) return "queued_user";

  const role = String(msg.role ?? "");
  if (role === "assistant") return "assistant_turn";
  if (role === "tool") {
    const tid = String(msg.toolCallId ?? msg.tool_call_id ?? "");
    if (source === "terminal-notification" || tid.startsWith("term_notify_")) {
      return "tool_async_notify";
    }
    return "tool_result";
  }
  if (role === "system") return "system_notice";

  if (role === "user") {
    const c = String(msg.content ?? "");
    if (c.includes("<terminal-message>")) return "tool_async_notify";
    if (c.includes("<system_notice")) return "system_notice";
    if (c.includes("<continue>")) return "runtime_control";
    if (c.includes("<verification-failed>") || c.includes("<verification>")) {
      return "runtime_control";
    }
    if (c.startsWith("[来自 ")) return "agent_message";
    return "human_user";
  }

  return "unknown";
}

/** kind → 默认 author（可被显式 author 覆盖） */
export function defaultAuthorForKind(
  kind: SessionEventKind,
  hints?: { agentName?: string; toolName?: string; from?: string },
): MessageAuthor {
  switch (kind) {
    case "human_user":
    case "queued_user":
      return authorHuman();
    case "agent_message":
      return authorAgent(hints?.from || hints?.agentName || "agent");
    case "assistant_turn":
    case "tool_call":
      return authorAgent(hints?.agentName || "assistant", hints?.agentName || "ai");
    case "tool_result":
    case "tool_async_notify":
      return authorTool(hints?.toolName || "tool");
    case "runtime_control":
      return authorSystem("runtime", "runtime");
    case "system_notice":
      return authorSystem(hints?.toolName || "system", hints?.toolName || "system");
    case "compact":
      return authorSystem("compress", "compress");
    default:
      return authorSystem("unknown");
  }
}

/** 从落盘记录推断 author */
export function resolveMessageAuthor(msg: {
  role?: string;
  source?: string;
  kind?: string;
  author?: MessageAuthor | Record<string, unknown>;
  tool_name?: string;
  toolName?: string;
  from?: string;
  agentName?: string;
  agent_name?: string;
  content?: string;
  toolCallId?: string;
  tool_call_id?: string;
  queued?: boolean;
}): MessageAuthor {
  const raw = msg.author;
  if (raw && typeof raw === "object" && typeof (raw as MessageAuthor).type === "string") {
    const a = raw as MessageAuthor;
    return {
      type: a.type,
      id: a.id,
      displayName: a.displayName ?? a.id,
    };
  }

  const kind = resolveSessionEventKind(msg);
  const toolName = String(msg.tool_name ?? msg.toolName ?? "");
  const from = String(msg.from ?? "");
  const agentName = String(msg.agentName ?? msg.agent_name ?? "");

  // source 特化
  if (msg.source === "todo_notice") return authorSystem("todo", "todo");
  if (msg.source === "empty_retry") return authorSystem("runtime", "runtime");
  if (msg.source === "verification") return authorSystem("verify", "verify");
  if (msg.source === "message_bus") return authorAgent(from || "peer", from || "peer");
  if (msg.source === "terminal-notification") {
    return authorTool(toolName || "use_terminal", toolName || "use_terminal");
  }
  if (msg.source === "hook") return authorSystem("hook", "hook");

  return defaultAuthorForKind(kind, {
    agentName: agentName || undefined,
    toolName: toolName || undefined,
    from: from || undefined,
  });
}

export function isHumanTurnKind(kind: SessionEventKind): boolean {
  return kind === "human_user" || kind === "queued_user";
}

export function isUserBubbleKind(kind: SessionEventKind): boolean {
  return kind === "human_user" || kind === "queued_user";
}

export function isNoticeUiKind(kind: SessionEventKind): boolean {
  return (
    kind === "system_notice" ||
    kind === "runtime_control" ||
    kind === "agent_message" ||
    kind === "compact"
  );
}

// ── Wire + append ──────────────────────────────────────────────────────────

export interface AppendSessionEventInput {
  kind: SessionEventKind;
  wireRole?: "user" | "assistant" | "tool" | "system";
  content: string;
  source?: string;
  /** 显式发言人；缺省按 kind/source 推断 */
  author?: MessageAuthor;
  meta?: Record<string, unknown>;
}

export function defaultWireRole(kind: SessionEventKind): "user" | "assistant" | "tool" | "system" {
  switch (kind) {
    case "human_user":
    case "queued_user":
    case "agent_message":
    case "runtime_control":
    case "system_notice":
    case "compact":
      return "user";
    case "assistant_turn":
    case "tool_call":
      return "assistant";
    case "tool_result":
    case "tool_async_notify":
      return "tool";
    default:
      return "user";
  }
}

/**
 * 统一写入会话事件：始终带 kind + author + source。
 */
export function appendSessionEvent(
  sessions: SessionStore,
  sessionId: string,
  input: AppendSessionEventInput,
): ReturnType<SessionStore["appendMessage"]> {
  const kind = input.kind;
  const wireRole = input.wireRole ?? defaultWireRole(kind);
  const source = input.source ?? kind;
  const author =
    input.author ??
    resolveMessageAuthor({
      kind,
      source,
      role: wireRole,
      tool_name: input.meta?.tool_name as string | undefined,
      from: input.meta?.from as string | undefined,
      agentName: input.meta?.agentName as string | undefined,
    });

  return sessions.appendMessage(sessionId, wireRole, input.content, {
    kind,
    source,
    author,
    ...input.meta,
  });
}
