/**
 * createWebUiServer —— Express + WebSocket
 * - 聊天：NDJSON StreamEvent
 * - Agent 终端：/ws/agent-terminal（subscribe / 轮询）
 * - 人开壳：/ws/terminal（Rust openInteractive）
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
import {
  TerminalHub,
  attachTerminalSocket,
  getHumanShellCapabilities,
} from "./terminal-hub.js";
import { mountMarkdownRoutes } from "./markdown/index.js";
import { ProactiveService } from "@little-house-studio/agent";
import { mountProactiveRoutes } from "./proactive/routes.js";
import { mountLlmConfigRoutes } from "./llm-config-routes.js";
import { mountWebhookRoutes } from "./webhook.js";
import { shutdownTerminalEngine } from "@little-house-studio/tools";

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
  /** 业务 Agent ProactiveService（看板/扫描/派发）；Web 只做路由壳 */
  proactive: ProactiveService;
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
  // MVP security: loopback-only by default (DESIGN.md)
  const host = opts.host ?? "127.0.0.1";
  const port = opts.port ?? 8787;
  const agentName = opts.agentName ?? "coding";
  const hub = new AgentHub(opts);
  const copilot = new CopilotHub(opts);
  const proactive = new ProactiveService({
    getProjectRoot: () => hub.projectRoot,
    maouRoot: hub.maouRoot,
    sandboxMode: opts.sandboxMode,
    // 派发落地：注入主 coding AgentHub（业务 Agent 不依赖 Web）
    getDispatchPort: () => ({
      runChat: (message: string) => hub.runChat(message),
      abortRun: () => hub.abortRun(),
    }),
  });

  initAgentTerminalEngine(opts.maouRoot, hub.projectRoot);
  const termHub = new TerminalHub();

  const app = express();
  app.use(express.json({ limit: "4mb" }));

  // Lightweight liveness only — do not ensureAgent / load sessions here.
  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      service: "maou-webui",
      agentName: hub.agentName || agentName,
      projectRoot: hub.projectRoot,
    });
  });

  app.get("/api/meta", (_req, res) => {
    const meta = hub.getMeta();
    res.json({
      ...meta,
      agentName: hub.agentName || agentName,
      // 启动恢复：附带活动会话历史，供前端首屏 hydrate
      messages: hub.loadSessionMessages(meta.sessionId),
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

  app.get("/api/models", (req, res) => {
    const provider = String(req.query.provider ?? "");
    const meta = hub.getMeta();
    res.json({
      ok: true,
      ...meta,
      providers: hub.listProviders(),
      models: hub.listModels(provider || undefined),
    });
  });

  // ── Agents（CLI AgentRegistry + presence lights）──
  app.get("/api/agents", (_req, res) => {
    try {
      res.json({
        ok: true,
        activeAgentName: hub.agentName,
        activeSwitchId: hub.activeSwitchId,
        activeProjectPath: hub.activeProjectPath,
        agents: hub.listAgents(),
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.post("/api/agents/active", (req, res) => {
    // Prefer CLI switch_id (project:<path>:<name>); fall back to bare name
    const id = String(
      req.body?.switchId ??
        req.body?.switch_id ??
        req.body?.id ??
        req.body?.name ??
        req.body?.agentName ??
        "",
    ).trim();
    if (!id) {
      res.status(400).json({ ok: false, error: "switchId or name required" });
      return;
    }
    try {
      hub.setActiveAgent(id);
      const meta = hub.getMeta();
      res.json({
        ok: true,
        activeAgentName: hub.agentName,
        activeSwitchId: hub.activeSwitchId,
        activeProjectPath: hub.activeProjectPath,
        ...meta,
        // Hydrate chat for the switched agent (frontend remounts ChatPanel)
        messages: hub.loadSessionMessages(meta.sessionId),
        agents: hub.listAgents(),
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  // ── Sessions（项目 .maou/sessions，与 CLI coding 同源 SessionStore）──
  app.get("/api/sessions", (_req, res) => {
    try {
      res.json({
        ok: true,
        sessions: hub.listSessions(),
        activeSessionId: hub.getMeta().sessionId,
        /** 当前焦点 Agent 下正在跑的会话 */
        runningSessionIds: hub.listRunningSessions(),
        /** 全部 Agent 的并行 run（跨 Agent 灯） */
        allRunning: hub.listAllRunningSessions(),
        /** 有持久终端在跑的 agentName */
        agentsWithRunningTerminals: Array.from(
          hub.listAgentsWithRunningTerminals(),
        ),
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.get("/api/runtime/running", (_req, res) => {
    try {
      res.json({
        ok: true,
        allRunning: hub.listAllRunningSessions(),
        busySwitchIds: Array.from(hub.listBusySwitchIds()),
        agentsWithRunningTerminals: Array.from(
          hub.listAgentsWithRunningTerminals(),
        ),
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.post("/api/sessions", (req, res) => {
    try {
      const title =
        req.body?.title != null ? String(req.body.title) : undefined;
      const { sessionId } = hub.newSession(title);
      res.json({
        ok: true,
        ...hub.getMeta(),
        sessionId,
        sessions: hub.listSessions(),
        messages: hub.loadSessionMessages(sessionId),
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.post("/api/sessions/switch", (req, res) => {
    const id = String(req.body?.id ?? req.body?.sessionId ?? "").trim();
    if (!id) {
      res.status(400).json({ ok: false, error: "id required" });
      return;
    }
    try {
      const { sessionId } = hub.switchSession(id);
      res.json({
        ok: true,
        ...hub.getMeta(),
        sessionId,
        messages: hub.loadSessionMessages(sessionId),
      });
    } catch (e) {
      res.status(400).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.post("/api/sessions/clear", (req, res) => {
    try {
      const id =
        req.body?.id != null ? String(req.body.id) : undefined;
      const { sessionId } = hub.clearSessionMessages(id);
      res.json({
        ok: true,
        ...hub.getMeta(),
        sessionId,
        messages: hub.loadSessionMessages(sessionId),
        sessions: hub.listSessions(),
      });
    } catch (e) {
      res.status(400).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.post("/api/sessions/rename", (req, res) => {
    const id = String(req.body?.id ?? req.body?.sessionId ?? "").trim();
    const title = String(req.body?.title ?? "").trim();
    if (!id || !title) {
      res.status(400).json({ ok: false, error: "id and title required" });
      return;
    }
    try {
      const r = hub.renameSession(id, title);
      res.json({
        ok: true,
        ...r,
        sessions: hub.listSessions(),
        ...hub.getMeta(),
      });
    } catch (e) {
      res.status(400).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.get("/api/sessions/active/export", (_req, res) => {
    try {
      const text = hub.exportTranscript();
      res.type("text/plain; charset=utf-8").send(text);
    } catch (e) {
      res.status(400).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.post("/api/sessions/delete", (req, res) => {
    const id = String(req.body?.id ?? req.body?.sessionId ?? "").trim();
    if (!id) {
      res.status(400).json({ ok: false, error: "id required" });
      return;
    }
    try {
      const r = hub.deleteSession(id);
      let sessionId = r.sessionId;
      let messages = hub.loadSessionMessages(sessionId);
      // 删掉当前会话后自动开一个新的，避免空 active
      if (!sessionId) {
        const n = hub.newSession();
        sessionId = n.sessionId;
        messages = [];
      }
      res.json({
        ok: true,
        deleted: r.deleted,
        ...hub.getMeta(),
        sessionId,
        messages,
        sessions: hub.listSessions(),
      });
    } catch (e) {
      res.status(400).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.get("/api/sessions/active/messages", (_req, res) => {
    try {
      res.json({
        ok: true,
        sessionId: hub.getMeta().sessionId,
        messages: hub.loadSessionMessages(),
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.get("/api/sessions/active/stats", (_req, res) => {
    try {
      const stats = hub.getSessionStats();
      res.json({
        ok: true,
        sessionId: hub.getMeta().sessionId,
        stats,
        text: hub.getSessionStatsText(),
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  // ── Approval mode + pending terminal approvals ──
  app.get("/api/approval", (_req, res) => {
    res.json({
      ok: true,
      mode: hub.getApprovalMode(),
      pending: hub.listPendingApprovals(),
    });
  });

  app.post("/api/approval", (req, res) => {
    const mode = String(req.body?.mode ?? "").trim();
    if (!["normal", "auto", "yolo"].includes(mode)) {
      res.status(400).json({
        ok: false,
        error: "mode must be normal|auto|yolo",
      });
      return;
    }
    const next = hub.setApprovalMode(mode);
    res.json({ ok: true, mode: next, ...hub.getMeta() });
  });

  app.get("/api/approvals/pending", (_req, res) => {
    res.json({ ok: true, pending: hub.listPendingApprovals() });
  });

  app.post("/api/approvals/:id", (req, res) => {
    const id = req.params.id;
    const choice = String(req.body?.choice ?? "deny") as
      | "once"
      | "always"
      | "deny"
      | "blacklist";
    if (!["once", "always", "deny", "blacklist"].includes(choice)) {
      res.status(400).json({ ok: false, error: "invalid choice" });
      return;
    }
    const ok = hub.answerApproval(id, choice);
    if (!ok) {
      res.status(404).json({ ok: false, error: "approval not found" });
      return;
    }
    res.json({ ok: true, pending: hub.listPendingApprovals() });
  });

  /** 核心 slash 等价：new / stop / model / help / sessions 由客户端分流；此处提供统一入口 */
  app.post("/api/command", (req, res) => {
    const id = String(req.body?.id ?? req.body?.command ?? "").trim();
    const args = (req.body?.args ?? {}) as Record<string, unknown>;
    try {
      switch (id) {
        case "new":
        case "new_session": {
          const { sessionId } = hub.newSession(
            args.title != null ? String(args.title) : undefined,
          );
          res.json({
            ok: true,
            command: id,
            ...hub.getMeta(),
            sessionId,
            messages: [],
          });
          return;
        }
        case "stop":
        case "abort": {
          hub.abortRun();
          res.json({ ok: true, command: id });
          return;
        }
        case "model": {
          const provider = String(args.provider ?? "");
          const model = String(args.model ?? "");
          if (provider && model) hub.setModel(provider, model);
          res.json({ ok: true, command: id, ...hub.getMeta() });
          return;
        }
        case "approval": {
          const mode = String(args.mode ?? "");
          if (mode) hub.setApprovalMode(mode);
          res.json({
            ok: true,
            command: id,
            mode: hub.getApprovalMode(),
            ...hub.getMeta(),
          });
          return;
        }
        case "help": {
          res.json({
            ok: true,
            command: id,
            help: [
              "/new — 新会话",
              "/clear — 清空会话消息",
              "/stop — 停止生成（并清空排队）",
              "/model <provider> <model> — 切换模型",
              "/sessions [id] — 列表或切换会话",
              "/approval normal|auto|yolo — 终端审批",
              "/export — 复制 transcript",
              "/usage · /cost · /analyze — 会话用量 / 诊断",
              "/compact · /context · /init · /goal — 经 chat 走 Runtime",
              "/help — 本帮助",
            ],
          });
          return;
        }
        case "clear": {
          try {
            const { sessionId } = hub.clearSessionMessages();
            res.json({
              ok: true,
              command: id,
              ...hub.getMeta(),
              sessionId,
              messages: [],
              sessions: hub.listSessions(),
            });
          } catch {
            res.json({ ok: true, command: id, clientOnly: true });
          }
          return;
        }
        case "usage":
        case "cost": {
          res.json({
            ok: true,
            command: id,
            text: hub.getSessionStatsText(),
            stats: hub.getSessionStats(),
          });
          return;
        }
        case "analyze": {
          res.json({
            ok: true,
            command: id,
            text: hub.analyzeSession(),
            stats: hub.getSessionStats(),
          });
          return;
        }
        default:
          res.status(400).json({
            ok: false,
            error: `unknown local command: ${id} (try send as chat slash for Runtime)`,
            supported: [
              "new",
              "stop",
              "model",
              "approval",
              "help",
              "clear",
              "usage",
              "cost",
              "analyze",
            ],
          });
      }
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.post("/api/chat/abort", (req, res) => {
    const sid =
      req.body?.sessionId != null
        ? String(req.body.sessionId).trim()
        : req.body?.id != null
          ? String(req.body.id).trim()
          : "";
    if (sid) hub.abortRun(sid);
    else hub.abortRun(); // 当前焦点会话
    res.json({
      ok: true,
      runningSessionIds: hub.listRunningSessions(),
    });
  });

  /**
   * 运行中入队（对接 Agent MessageQueue）
   * body: { message, mode?: "queue" | "insert" }
   * - queue  → after_round_complete
   * - insert → interrupt_immediately
   */
  app.post("/api/chat/enqueue", (req, res) => {
    try {
      const message = String(req.body?.message ?? "").trim();
      if (!message) {
        res.status(400).json({ ok: false, error: "message required" });
        return;
      }
      const rawMode = String(req.body?.mode ?? "queue").toLowerCase();
      const mode = rawMode === "insert" ? "insert" : "queue";
      const r = hub.enqueueUserMessage(message, mode);
      res.json(r);
    } catch (e) {
      res.status(400).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.get("/api/chat/queue", (_req, res) => {
    res.json({
      ok: true,
      busy: hub.isBusy(),
      queue: hub.listMessageQueue(),
    });
  });

  app.delete("/api/chat/queue", (_req, res) => {
    const n = hub.clearMessageQueue();
    res.json({ ok: true, cleared: n, queue: [] });
  });

  app.delete("/api/chat/queue/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ ok: false, error: "invalid id" });
      return;
    }
    const removed = hub.removeQueuedMessage(id);
    res.json({
      ok: removed,
      removed,
      queue: hub.listMessageQueue(),
    });
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
    /**
     * 客户端断开才 abort「本条流」对应的会话。
     * 多会话并行：切会话不 abort 其它 run；只掐本 HTTP 连接绑定的 session。
     */
    let boundSessionId: string | null = hub.getMeta().sessionId;
    const abortThis = () => {
      if (boundSessionId) hub.abortRun(boundSessionId);
    };
    const onClientAbort = () => {
      abortThis();
    };
    const onResponseClose = () => {
      if (!res.writableFinished) abortThis();
    };
    req.on("aborted", onClientAbort);
    res.on("close", onResponseClose);
    const write = (obj: unknown) => {
      if (res.writableEnded) return;
      try {
        res.write(`${JSON.stringify(obj)}\n`);
      } catch {
        abortThis();
      }
    };
    try {
      for await (const ev of hub.runChat(message)) {
        if (
          ev &&
          typeof ev === "object" &&
          (ev as { type?: string }).type === "session"
        ) {
          const sid = String(
            (ev as { sessionId?: string }).sessionId ?? "",
          ).trim();
          if (sid) boundSessionId = sid;
        }
        if (res.writableEnded || req.aborted) break;
        write(ev);
      }
    } catch (e) {
      write({
        type: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      req.off("aborted", onClientAbort);
      res.off("close", onResponseClose);
      if (!res.writableEnded) res.end();
    }
  });

  // ── Markdown 大模块（server/markdown）──
  mountMarkdownRoutes(app, {
    getProjectRoot: () => hub.projectRoot,
    onWrite: () => proactive.notifyProjectEdit(),
  });

  // ── 全局 LLM api.presets（真配置持久化）──
  mountLlmConfigRoutes(app);

  // ── 入站 webhook（按 Agent 名叫醒；与 proactive 无关）──
  mountWebhookRoutes(app, hub);

  // ── 主动智能 ──
  mountProactiveRoutes(app, () => proactive);

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
  app.get("/api/terminals/capabilities", (_req, res) => {
    res.json({ ok: true, ...getHumanShellCapabilities() });
  });

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

  // WS: /ws/agent-terminal?id=xxx&agent=coding  |  /ws/terminal 人开壳
  const wssAgent = new WebSocketServer({ noServer: true });
  const wssHuman = new WebSocketServer({ noServer: true });
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
      if (url.pathname === "/ws/terminal") {
        wssHuman.handleUpgrade(req, socket, head, (ws) => {
          attachTerminalSocket(termHub, ws, hub.projectRoot, hub.agentName || agentName);
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
    proactive,
    start() {
      return new Promise<{ host: string; port: number; url: string }>((resolve, reject) => {
        http.once("error", reject);
        http.listen(port, host, () => {
          proactive.start();
          const addr = http.address();
          const actualPort =
            typeof addr === "object" && addr && typeof addr.port === "number"
              ? addr.port
              : port;
          // bind 用 loopback；对外展示域名由 cli/local-entry 拼 maou.localhost
          resolve({
            host,
            port: actualPort,
            url: `http://${host}:${actualPort}`,
          });
        });
      });
    },
    close() {
      return new Promise((resolve) => {
        proactive.stop();
        hub.abortAllRuns();
        hub.cancelAllApprovals("server close");
        copilot.abortRun();
        termHub.closeAll();
        shutdownTerminalEngine();
        wssAgent.close();
        wssHuman.close();
        http.close(() => resolve());
      });
    },
  };
}
