/**
 * WebUI 上的 webhook HTTP 壳。协议与调度在 @little-house-studio/agent。
 */
import type { Express, Request, Response } from "express";
import {
  checkWebhookSecret,
  dispatchWebhook,
  parseWebhookRequest,
  agentUserMessageText,
  webhookSecretFromEnv,
  WebhookParseError,
  WebhookResolveError,
} from "@little-house-studio/agent";
import { WEBHOOK_PROTOCOL_VERSION } from "@little-house-studio/types";
import type { AgentHub } from "./agent-hub.js";

export {
  resolveWebhookTarget,
  targetFromSwitchId,
  WebhookResolveError,
  type WebhookTarget,
  type WebhookAgentRef,
} from "./webhook-target.js";

export { webhookSecretFromEnv as webhookSecret };

/** Express 版鉴权（转成 IncomingMessage headers）。 */
export function checkWebhookAuth(req: Request): boolean {
  return checkWebhookSecret({
    authorization: req.get("authorization") ?? req.headers?.authorization,
    "x-webhook-secret":
      req.get("x-webhook-secret") ?? req.headers?.["x-webhook-secret"],
    "x-maou-webhook-secret":
      req.get("x-maou-webhook-secret") ??
      req.headers?.["x-maou-webhook-secret"],
  });
}

export function readWebhookAgent(req: Request): string {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  return String(
    body.agent ??
      body.switchId ??
      body.switch_id ??
      body.name ??
      body.agentName ??
      req.query?.agent ??
      req.params?.agent ??
      "",
  ).trim();
}

export function readWebhookMessage(req: Request): string {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const raw = body.message ?? body.text ?? body.content ?? body.prompt ?? "";
  try {
    return agentUserMessageText(raw);
  } catch {
    return "";
  }
}

export function mountWebhookRoutes(app: Express, hub: AgentHub): void {
  const gate = (req: Request, res: Response, next: () => void) => {
    if (!checkWebhookAuth(req)) {
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }
    next();
  };

  app.get("/api/webhook", gate, async (_req, res) => {
    try {
      const help = await dispatchWebhook({ action: "help" }, hub);
      const agents = await dispatchWebhook({ action: "agents.list" }, hub);
      res.json({
        ok: true,
        v: WEBHOOK_PROTOCOL_VERSION,
        action: "help",
        path: "/api/webhook",
        auth: webhookSecretFromEnv() ? "secret" : "open",
        actions: help.actions,
        agents: agents.agents,
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  const post = async (req: Request, res: Response) => {
    const body =
      req.body && typeof req.body === "object" && !Array.isArray(req.body)
        ? { ...req.body }
        : {};
    const pathAgent = String(req.params?.agent ?? "").trim();
    if (pathAgent && !body.agent) body.agent = pathAgent;
    try {
      const parsed = parseWebhookRequest(body);
      const result = await dispatchWebhook(parsed, hub);
      res.status(result.status ?? (result.ok ? 200 : 400)).json(result);
    } catch (e) {
      if (e instanceof WebhookParseError) {
        res.status(e.status).json({
          ok: false,
          v: WEBHOOK_PROTOCOL_VERSION,
          error: e.message,
          status: e.status,
        });
        return;
      }
      if (e instanceof WebhookResolveError) {
        res.status(e.status).json({
          ok: false,
          error: e.message,
          status: e.status,
          candidates: e.candidates,
        });
        return;
      }
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  app.post("/api/webhook", gate, post);
  app.post("/api/webhook/:agent", gate, post);
}
