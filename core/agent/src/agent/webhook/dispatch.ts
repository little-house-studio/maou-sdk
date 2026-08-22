/**
 * 消息结构体 → WebhookHost。CLI / WebUI / 裸 HTTP 共用这一条。
 */
import {
  WEBHOOK_HELP,
  WEBHOOK_PROTOCOL_VERSION,
  type WebhookRequest,
  type WebhookResponse,
} from "@little-house-studio/types";
import type { WebhookHost } from "./host.js";
import { WebhookParseError } from "./parse.js";
import { WebhookResolveError } from "./target.js";

function ok(
  req: WebhookRequest,
  extra: Record<string, unknown> = {},
  status = 200,
): WebhookResponse {
  return {
    ok: true,
    v: WEBHOOK_PROTOCOL_VERSION,
    action: req.action,
    id: req.id,
    ...extra,
    status,
  };
}

function fail(
  req: WebhookRequest | { action: WebhookRequest["action"]; id?: string },
  error: string,
  status: number,
  extra: Record<string, unknown> = {},
): WebhookResponse {
  return {
    ok: false,
    v: WEBHOOK_PROTOCOL_VERSION,
    action: req.action,
    id: req.id,
    error,
    status,
    ...extra,
  };
}

function commandToRequest(
  req: Extract<WebhookRequest, { action: "command" }>,
): WebhookRequest {
  const id = String(req.command || "").replace(/^\//, "").trim();
  const args = req.args ?? {};
  const base = { v: req.v, id: req.id, agent: req.agent, session: req.session };
  switch (id) {
    case "new":
    case "new_session":
      return {
        ...base,
        action: "sessions.new",
        title: args.title != null ? String(args.title) : undefined,
      };
    case "stop":
    case "abort":
      return { ...base, action: "abort" };
    case "clear":
      return { ...base, action: "sessions.clear" };
    case "model": {
      const provider = String(args.provider ?? "");
      const model = String(args.model ?? "");
      if (provider && model) {
        return { ...base, action: "model.set", provider, model };
      }
      return { ...base, action: "model.get" };
    }
    case "approval": {
      const mode = String(args.mode ?? "");
      return {
        ...base,
        action: "approval.mode",
        mode:
          mode === "normal" || mode === "auto" || mode === "yolo"
            ? mode
            : undefined,
      };
    }
    case "usage":
    case "cost":
    case "analyze":
      return { ...base, action: "sessions.stats" };
    case "sessions": {
      const sid = String(args.session ?? args.id ?? req.session ?? "").trim();
      if (sid) return { ...base, action: "sessions.switch", session: sid };
      return { ...base, action: "sessions.list" };
    }
    case "help":
      return { ...base, action: "help" };
    default:
      throw new WebhookParseError(`unknown command: ${id}`);
  }
}

export async function dispatchWebhook(
  req: WebhookRequest,
  host: WebhookHost,
): Promise<WebhookResponse> {
  try {
    if (req.action === "command") {
      return await dispatchWebhook(commandToRequest(req), host);
    }

    switch (req.action) {
      case "help":
        return ok(req, { actions: WEBHOOK_HELP });
      case "status":
        return ok(req, { ...host.status(req.agent, req.session) });
      case "send": {
        const r = await host.send({
          agent: req.agent,
          session: req.session,
          message: req.message,
          mode: req.mode,
          wait: req.wait,
          timeoutMs: req.timeoutMs,
        });
        const { status: delivery, ...rest } = r;
        return ok(
          req,
          { ...rest, delivery },
          delivery === "queued" || !req.wait ? 202 : 200,
        );
      }
      case "abort":
        return ok(req, host.abort({ agent: req.agent, session: req.session }));
      case "enqueue":
        return ok(
          req,
          host.enqueue({
            agent: req.agent,
            session: req.session,
            message: req.message,
            mode: req.mode,
          }),
          202,
        );
      case "agents.list":
        return ok(req, { agents: host.listAgents() });
      case "sessions.list":
        return ok(req, { sessions: host.listSessions(req.agent) });
      case "sessions.new":
        return ok(req, host.newSession({ agent: req.agent, title: req.title }));
      case "sessions.switch":
        return ok(
          req,
          host.switchSession({ agent: req.agent, session: req.session }),
        );
      case "sessions.clear":
        return ok(
          req,
          host.clearSession({ agent: req.agent, session: req.session }),
        );
      case "sessions.delete":
        return ok(
          req,
          host.deleteSession({ agent: req.agent, session: req.session }),
        );
      case "sessions.rename":
        return ok(
          req,
          host.renameSession({
            agent: req.agent,
            session: req.session,
            title: req.title,
          }),
        );
      case "sessions.messages":
        return ok(
          req,
          host.sessionMessages({ agent: req.agent, session: req.session }),
        );
      case "sessions.stats":
        return ok(
          req,
          host.sessionStats({ agent: req.agent, session: req.session }),
        );
      case "sessions.export":
        return ok(
          req,
          host.exportSession({ agent: req.agent, session: req.session }),
        );
      case "model.get":
        return ok(req, host.getModel());
      case "model.set":
        return ok(req, host.setModel(req.provider, req.model));
      case "models.list":
        return ok(req, {
          providers: host.listProviders(),
          models: host.listModels(req.provider),
          ...host.getModel(),
        });
      case "approval.list":
        return ok(req, { pending: host.listApprovals() });
      case "approval.answer": {
        const answered = host.answerApproval(req.approvalId, req.choice);
        if (!answered) {
          return fail(req, `approval not found: ${req.approvalId}`, 404);
        }
        return ok(req, { pending: host.listApprovals() });
      }
      case "approval.mode": {
        if (req.mode) host.setApprovalMode(req.mode);
        return ok(req, { mode: host.getApprovalMode() });
      }
      case "queue.list":
        return ok(req, {
          queue: host.listQueue({ agent: req.agent, session: req.session }),
        });
      case "queue.clear":
        return ok(req, {
          cleared: host.clearQueue({ agent: req.agent, session: req.session }),
          queue: [],
        });
      case "queue.remove": {
        const removed = host.removeQueue({
          agent: req.agent,
          session: req.session,
          queueId: req.queueId,
        });
        return ok(req, {
          removed,
          queue: host.listQueue({ agent: req.agent, session: req.session }),
        });
      }
      default:
        return fail(req, `unknown action`, 400);
    }
  } catch (e) {
    if (e instanceof WebhookParseError) {
      return fail(req, e.message, e.status);
    }
    if (e instanceof WebhookResolveError) {
      return fail(req, e.message, e.status, { candidates: e.candidates });
    }
    const msg = e instanceof Error ? e.message : String(e);
    const notFound = /not found|required/i.test(msg);
    return fail(req, msg, notFound ? 400 : 500);
  }
}
