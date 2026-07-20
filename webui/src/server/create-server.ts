/**
 * createWebUiServer —— Express + WebSocket
 * - 聊天：NDJSON StreamEvent
 * - Agent 终端：list / attach（logs 轮询 + write）—— use_terminal 真实会话
 */

import express from "express";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { AgentHub, type AgentHubOpts } from "./agent-hub.js";
import { CopilotHub } from "./copilot-hub.js";
import {
  initAgentTerminalEngine,
  listAgentTerminals,
  getAgentTerminalLogs,
  writeAgentTerminal,
  stopAgentTerminal,
  attachAgentTerminalSocket,
} from "./agent-terminals.js";
import { mountMarkdownRoutes } from "./markdown/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface WebUiServerOpts extends AgentHubOpts {
  port?: number;
  host?: string;
  staticDir?: string;
  /** agent 名，默认 coding */
  agentName?: string;
}

export interface WebUiServer {
  http: HttpServer;
  hub: AgentHub;
  copilot: CopilotHub;
  start: () => Promise<{ host: string; port: number; url: string }>;
  close: () => Promise<void>;
}

function resolveStaticDir(explicit?: string): string | null {
  if (explicit && existsSync(explicit)) return explicit;
  const candidates = [
    join(__dirname, "../client"),
    join(__dirname, "../../dist/client"),
    join(process.cwd(), "webui/dist/client"),
    join(process.cwd(), "dist/client"),
  ];
  for (const d of candidates) {
    if (existsSync(join(d, "index.html"))) return d;
  }
  return null;
}

export function createWebUiServer(opts: WebUiServerOpts = {}): WebUiServer {
  const host = opts.host ?? "127.0.0.1";
  const port = opts.port ?? 8787;
  const agentName = opts.agentName ?? "coding";
  const hub = new AgentHub(opts);
  const copilot = new CopilotHub(opts);

  initAgentTerminalEngine(opts.maouRoot);

  const app = express();
  app.use(express.json({ limit: "4mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      service: "maou-webui",
      ...hub.getMeta(),
      agentName: hub.agentName || agentName,
    });
  });

  app.get("/api/meta", (_req, res) => {
    res.json({
      ...hub.getMeta(),
      agentName: hub.agentName || agentName,
    });
  });

  app.post("/api/model", (req, res) => {
    const provider = String(req.body?.provider ?? "");
    const model = String(req.body?.model ?? "");
    if (!provider || !model) {
      res.status(400).json({ ok: false, error: "provider/model required" });
      return;
    }
    hub.setModel(provider, model);
    res.json({ ok: true, ...hub.getMeta() });
  });

  app.post("/api/chat/abort", (_req, res) => {
    hub.abortRun();
    res.json({ ok: true });
  });

  app.post("/api/chat", async (req, res) => {
    const message = String(req.body?.message ?? "").trim();
    if (!message) {
      res.status(400).json({ ok: false, error: "message required" });
      return;
    }
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    const write = (obj: unknown) => {
      res.write(`${JSON.stringify(obj)}\n`);
    };
    try {
      for await (const ev of hub.runChat(message)) {
        write(ev);
        if (res.writableEnded) break;
      }
    } catch (e) {
      write({
        type: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      if (!res.writableEnded) res.end();
    }
  });

  // ── Markdown 大模块（server/markdown）──
  mountMarkdownRoutes(app, {
    getProjectRoot: () => hub.projectRoot,
  });

  // ── 文档 Copilot（独立 agent 会话）──
  app.get("/api/copilot/meta", (_req, res) => {
    res.json({ ok: true, ...copilot.getMeta() });
  });

  app.post("/api/copilot/abort", (_req, res) => {
    copilot.abortRun();
    res.json({ ok: true });
  });

  app.post("/api/copilot/session/new", (_req, res) => {
    copilot.newSession();
    res.json({ ok: true, ...copilot.getMeta() });
  });

  app.post("/api/copilot/chat", async (req, res) => {
    const message = String(req.body?.message ?? "").trim();
    if (!message) {
      res.status(400).json({ ok: false, error: "message required" });
      return;
    }
    const filePath =
      req.body?.filePath != null ? String(req.body.filePath) : undefined;
    const content =
      req.body?.content != null ? String(req.body.content) : undefined;
    const annotations =
      req.body?.annotations != null
        ? String(req.body.annotations)
        : undefined;

    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    const write = (obj: unknown) => {
      res.write(`${JSON.stringify(obj)}\n`);
    };
    try {
      for await (const ev of copilot.runChat(message, {
        filePath,
        content,
        annotations,
      })) {
        write(ev);
        if (res.writableEnded) break;
      }
    } catch (e) {
      write({
        type: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      if (!res.writableEnded) res.end();
    }
  });

  // ── Agent 终端（use_terminal / terminal-engine）──
  app.get("/api/terminals", (req, res) => {
    const agent = String(req.query.agent ?? agentName);
    const all = req.query.all === "1";
    res.json({
      ok: true,
      agentName: agent,
      terminals: all ? listAgentTerminals() : listAgentTerminals(agent),
    });
  });

  app.get("/api/terminals/:id/logs", async (req, res) => {
    const id = req.params.id;
    const agent = String(req.query.agent ?? agentName);
    const lines = Number(req.query.lines ?? 8000);
    const text = await getAgentTerminalLogs(id, agent, lines);
    res.json({ ok: true, id, agentName: agent, logs: text });
  });

  app.post("/api/terminals/:id/write", async (req, res) => {
    const id = req.params.id;
    const agent = String(req.body?.agent ?? agentName);
    const data = String(req.body?.data ?? "");
    if (!data) {
      res.status(400).json({ ok: false, error: "data required" });
      return;
    }
    try {
      await writeAgentTerminal(id, agent, data);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.post("/api/terminals/:id/stop", async (req, res) => {
    const id = req.params.id;
    const agent = String(req.body?.agent ?? agentName);
    try {
      await stopAgentTerminal(id, agent);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  const staticDir = resolveStaticDir(opts.staticDir);
  if (staticDir) {
    app.use(express.static(staticDir));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api") || req.path.startsWith("/ws")) {
        next();
        return;
      }
      res.sendFile(join(staticDir, "index.html"), (err) => {
        if (err) next();
      });
    });
  } else {
    app.get("/", (_req, res) => {
      res
        .type("html")
        .send(
          `<!doctype html><meta charset=utf-8><title>maou webui</title>
          <p>请先构建前端：cd webui && pnpm run build</p>`,
        );
    });
  }

  const http = createHttpServer(app);

  // WS: /ws/agent-terminal?id=xxx&agent=coding
  const wssAgent = new WebSocketServer({ noServer: true });
  http.on("upgrade", (req, socket, head) => {
    try {
      const url = new URL(req.url || "", "http://localhost");
      if (url.pathname === "/ws/agent-terminal") {
        wssAgent.handleUpgrade(req, socket, head, (ws) => {
          const id = url.searchParams.get("id") || "";
          const agent = url.searchParams.get("agent") || agentName;
          if (!id) {
            ws.send(JSON.stringify({ type: "error", message: "missing id" }));
            ws.close();
            return;
          }
          attachAgentTerminalSocket(ws, { id, agentName: agent });
        });
        return;
      }
      socket.destroy();
    } catch {
      socket.destroy();
    }
  });

  return {
    http,
    hub,
    copilot,
    start() {
      return new Promise((resolve, reject) => {
        http.once("error", reject);
        http.listen(port, host, () => {
          resolve({ host, port, url: `http://${host}:${port}` });
        });
      });
    },
    close() {
      return new Promise((resolve) => {
        hub.abortRun();
        copilot.abortRun();
        wssAgent.close();
        http.close(() => resolve());
      });
    },
  };
}
