/**
 * 无 UI webhook HTTP。不依赖 express / webui。
 * POST 一条 WebhookRequest；GET 返回 help + agents。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { WEBHOOK_PROTOCOL_VERSION } from "@little-house-studio/types";
import { dispatchWebhook } from "./dispatch.js";
import type { WebhookHost } from "./host.js";
import { parseWebhookRequest, WebhookParseError } from "./parse.js";
import {
  WebhookAgentHost,
  type WebhookAgentHostOpts,
} from "./runtime-host.js";

export function webhookSecretFromEnv(): string {
  return (process.env.MAOU_WEBHOOK_SECRET ?? "").trim();
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function checkWebhookSecret(
  headers: IncomingMessage["headers"] | undefined,
  secret = webhookSecretFromEnv(),
): boolean {
  if (!secret) return true;
  const h = headers ?? {};
  const rawAuth = String(h.authorization ?? "");
  const bearer = rawAuth.toLowerCase().startsWith("bearer ")
    ? rawAuth.slice(7).trim()
    : "";
  const header = String(
    h["x-webhook-secret"] ?? h["x-maou-webhook-secret"] ?? "",
  ).trim();
  const got = header || bearer;
  return Boolean(got) && safeEqual(got, secret);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(json);
}

function isWebhookPath(url: string): boolean {
  const path = url.split("?")[0] ?? "/";
  return (
    path === "/" ||
    path === "/webhook" ||
    path === "/api/webhook" ||
    path.startsWith("/api/webhook/") ||
    path.startsWith("/webhook/")
  );
}

function pathAgent(url: string): string | undefined {
  const path = (url.split("?")[0] ?? "/").replace(/\/+$/, "");
  const prefixes = ["/api/webhook/", "/webhook/"];
  for (const p of prefixes) {
    if (path.startsWith(p)) {
      const rest = path.slice(p.length);
      return rest && !rest.includes("/") ? decodeURIComponent(rest) : undefined;
    }
  }
  return undefined;
}

export async function handleWebhookHttp(
  req: IncomingMessage,
  res: ServerResponse,
  host: WebhookHost,
  secret = webhookSecretFromEnv(),
): Promise<void> {
  const url = req.url ?? "/";
  if (!isWebhookPath(url)) {
    sendJson(res, 404, { ok: false, error: "not found" });
    return;
  }
  if (!checkWebhookSecret(req.headers, secret)) {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    const help = await dispatchWebhook({ action: "help" }, host);
    const agents = await dispatchWebhook({ action: "agents.list" }, host);
    sendJson(res, 200, {
      ok: true,
      v: WEBHOOK_PROTOCOL_VERSION,
      action: "help",
      path: "/api/webhook",
      auth: secret ? "secret" : "open",
      actions: help.actions,
      agents: agents.agents,
    });
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method not allowed" });
    return;
  }

  let raw: unknown = {};
  const text = await readBody(req);
  if (text.trim()) {
    try {
      raw = JSON.parse(text);
    } catch {
      sendJson(res, 400, { ok: false, error: "invalid json" });
      return;
    }
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const agent = pathAgent(url);
    if (agent && !(raw as { agent?: string }).agent) {
      (raw as { agent?: string }).agent = agent;
    }
  }

  try {
    const parsed = parseWebhookRequest(raw);
    const result = await dispatchWebhook(parsed, host);
    sendJson(res, result.status ?? (result.ok ? 200 : 400), result);
  } catch (e) {
    if (e instanceof WebhookParseError) {
      sendJson(res, e.status, {
        ok: false,
        v: WEBHOOK_PROTOCOL_VERSION,
        error: e.message,
        status: e.status,
      });
      return;
    }
    sendJson(res, 500, {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export type CreateWebhookServerOpts = WebhookAgentHostOpts & {
  host?: string;
  port?: number;
  secret?: string;
};

export function createWebhookServer(opts: CreateWebhookServerOpts = {}): {
  http: Server;
  host: WebhookAgentHost;
  listen: () => Promise<{ host: string; port: number; url: string }>;
  close: () => Promise<void>;
} {
  const bindHost = opts.host ?? "127.0.0.1";
  const port = opts.port ?? Number(process.env.MAOU_WEBHOOK_PORT || 8788);
  const secret = opts.secret ?? webhookSecretFromEnv();
  const agentHost = new WebhookAgentHost(opts);
  const http = createServer((req, res) => {
    void handleWebhookHttp(req, res, agentHost, secret);
  });
  return {
    http,
    host: agentHost,
    listen: () =>
      new Promise((resolve, reject) => {
        http.once("error", reject);
        http.listen(port, bindHost, () => {
          resolve({
            host: bindHost,
            port,
            url: `http://${bindHost}:${port}/api/webhook`,
          });
        });
      }),
    close: () =>
      new Promise((resolve, reject) => {
        agentHost.abortAll();
        http.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
