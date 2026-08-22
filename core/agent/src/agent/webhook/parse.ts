/**
 * 把任意 JSON 收成 WebhookRequest。
 * 兼容旧体 `{ agent, message }` → `{ action: "send", ... }`。
 */
import {
  WEBHOOK_ACTIONS,
  WEBHOOK_PROTOCOL_VERSION,
  type WebhookAction,
  type WebhookApprovalChoice,
  type WebhookApprovalMode,
  type WebhookRequest,
  type WebhookSendMode,
} from "@little-house-studio/types";
import { toAgentSendMessage } from "@little-house-studio/context";

export class WebhookParseError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "WebhookParseError";
  }
}

const ACTIONS = new Set<string>(WEBHOOK_ACTIONS);

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function hasSpeakable(raw: Record<string, unknown>): boolean {
  const m = raw.message ?? raw.text ?? raw.content ?? raw.prompt;
  if (typeof m === "string") return m.trim().length > 0;
  if (m && typeof m === "object" && !Array.isArray(m)) {
    const o = m as Record<string, unknown>;
    return Boolean(
      str(o.content ?? o.text) ||
        Array.isArray(o.content) ||
        str(o.command),
    );
  }
  return false;
}

function pickAction(raw: Record<string, unknown>): WebhookAction {
  const explicit = str(raw.action ?? raw.op ?? raw.type);
  if (explicit) {
    if (!ACTIONS.has(explicit)) {
      throw new WebhookParseError(`unknown action: ${explicit}`);
    }
    return explicit as WebhookAction;
  }
  if (hasSpeakable(raw)) return "send";
  if (str(raw.command)) return "command";
  throw new WebhookParseError("action required");
}

function sendMode(v: unknown): WebhookSendMode | undefined {
  const m = str(v).toLowerCase();
  if (!m) return undefined;
  if (m === "now" || m === "queue" || m === "insert") return m;
  if (
    m === "stop_and_send" ||
    m === "stop-and-send" ||
    m === "stop" ||
    m === "停止并发送"
  ) {
    return "stop_and_send";
  }
  if (m === "队列") return "queue";
  if (m === "插入") return "insert";
  throw new WebhookParseError(`invalid send mode: ${m}`);
}

function approvalChoice(v: unknown): WebhookApprovalChoice {
  const c = str(v).toLowerCase();
  if (c === "once" || c === "always" || c === "deny" || c === "blacklist") {
    return c;
  }
  throw new WebhookParseError("approval choice required: once|always|deny|blacklist");
}

function approvalMode(v: unknown): WebhookApprovalMode | undefined {
  const m = str(v).toLowerCase();
  if (!m) return undefined;
  if (m === "normal" || m === "auto" || m === "yolo") return m;
  throw new WebhookParseError(`invalid approval mode: ${m}`);
}

/**
 * 解析 webhook 消息结构体。
 * `null` / 非对象会抛 WebhookParseError。
 */
export function parseWebhookRequest(input: unknown): WebhookRequest {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    throw new WebhookParseError("webhook body must be an object");
  }
  const raw = input as Record<string, unknown>;
  const action = pickAction(raw);
  const base = {
    v: WEBHOOK_PROTOCOL_VERSION,
    id: str(raw.id) || undefined,
    agent: str(
      raw.agent ?? raw.switchId ?? raw.switch_id ?? raw.agentName,
    ) || undefined,
    session: str(raw.session ?? raw.sessionId ?? raw.session_id) || undefined,
  };

  const messageRaw =
    raw.message !== undefined
      ? raw.message
      : (raw.text ?? raw.content ?? raw.prompt);

  switch (action) {
    case "send": {
      let message;
      try {
        message = toAgentSendMessage(messageRaw);
      } catch (e) {
        throw new WebhookParseError(
          e instanceof Error ? e.message : "message required",
        );
      }
      const envelopeMode = sendMode(raw.mode);
      if (!message.command && str(raw.command)) {
        message = { ...message, command: str(raw.command).replace(/^\//, "") };
      }
      if (!message.send_mode && envelopeMode && envelopeMode !== "now") {
        message = { ...message, send_mode: envelopeMode };
      }
      return {
        ...base,
        action,
        message,
        mode: envelopeMode ?? message.send_mode,
        wait: raw.wait === true || raw.wait === "true",
        timeoutMs:
          raw.timeoutMs != null && Number.isFinite(Number(raw.timeoutMs))
            ? Number(raw.timeoutMs)
            : undefined,
      };
    }
    case "enqueue": {
      let message;
      try {
        message = toAgentSendMessage(messageRaw);
      } catch (e) {
        throw new WebhookParseError(
          e instanceof Error ? e.message : "message required",
        );
      }
      if (!message.command && str(raw.command)) {
        message = { ...message, command: str(raw.command).replace(/^\//, "") };
      }
      return {
        ...base,
        action,
        message,
        mode: sendMode(raw.mode) === "insert" ? "insert" : "queue",
      };
    }
    case "sessions.new":
      return { ...base, action, title: str(raw.title) || undefined };
    case "sessions.switch":
    case "sessions.delete": {
      const session = base.session;
      if (!session) throw new WebhookParseError("session required");
      return { ...base, action, session };
    }
    case "sessions.rename": {
      const session = base.session;
      const title = str(raw.title);
      if (!session) throw new WebhookParseError("session required");
      if (!title) throw new WebhookParseError("title required");
      return { ...base, action, session, title };
    }
    case "sessions.clear":
    case "sessions.list":
    case "sessions.messages":
    case "sessions.stats":
    case "sessions.export":
    case "help":
    case "status":
    case "abort":
    case "agents.list":
    case "model.get":
    case "approval.list":
    case "queue.list":
    case "queue.clear":
      return { ...base, action };
    case "model.set": {
      const provider = str(raw.provider);
      const model = str(raw.model);
      if (!provider || !model) {
        throw new WebhookParseError("provider and model required");
      }
      return { ...base, action, provider, model };
    }
    case "models.list":
      return { ...base, action, provider: str(raw.provider) || undefined };
    case "approval.answer": {
      const approvalId = str(raw.approvalId ?? raw.approval_id);
      if (!approvalId) throw new WebhookParseError("approvalId required");
      return {
        ...base,
        action,
        approvalId,
        choice: approvalChoice(raw.choice ?? raw.answer),
      };
    }
    case "approval.mode":
      return { ...base, action, mode: approvalMode(raw.mode) };
    case "queue.remove": {
      const queueId = Number(raw.queueId);
      if (!Number.isFinite(queueId)) {
        throw new WebhookParseError("queueId required");
      }
      return { ...base, action, queueId };
    }
    case "command": {
      const command = str(raw.command ?? raw.name);
      if (!command) throw new WebhookParseError("command required");
      const args =
        raw.args && typeof raw.args === "object" && !Array.isArray(raw.args)
          ? (raw.args as Record<string, unknown>)
          : {};
      return { ...base, action, command, args };
    }
    default:
      throw new WebhookParseError(`unknown action: ${action}`);
  }
}
