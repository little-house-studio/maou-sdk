/**
 * createAppServer —— Express + WebSocket
 * - 聊天：NDJSON StreamEvent
 * - Agent 终端：/ws/agent-terminal（subscribe / 轮询）
 * - 人开壳：/ws/terminal（Rust openInteractive）
 * - 桌面端 listen.kind=socket：unix socket / named pipe，不占 TCP 端口
 */

import express from "express";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import type { WebSocket } from "ws";
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
import { loadSessionToolMeta } from "./session-intents.js";
import {
  loadSessionPayloadDetail,
  loadSessionPayloadIndex,
} from "./session-payloads.js";
import { listDiskPlugins, loadDiskPlugins, pluginThemeVars, pluginUiFile } from "./plugin-host.js";
import { ConfigStore } from "@little-house-studio/types";

export type AppListen =
  | { kind: "tcp"; host?: string; port?: number }
  | { kind: "socket"; path: string };

export type AppListenInfo = {
  host: string;
  port: number;
  url: string;
  socketPath?: string;
};

export interface AppServerOpts extends AgentHubOpts {
  port?: number;
  host?: string;
  listen?: AppListen;
  /** agent 名，默认 coding */
  agentName?: string;
}

export interface AppServer {
  http: HttpServer;
  hub: AgentHub;
  copilot: CopilotHub;
  /** 业务 Agent ProactiveService（看板/扫描/派发）；App 只做路由壳 */
  proactive: ProactiveService;
  start: () => Promise<AppListenInfo>;
  close: () => Promise<void>;
  attachAgentTerminal: (
    ws: WebSocket,
    opts: { id: string; agentName: string; pollMs?: number },
  ) => void;
  attachHumanTerminal: (ws: WebSocket) => void;
}

function resolveListen(opts: AppServerOpts): AppListen {
  if (opts.listen) return opts.listen;
  if (opts.port != null || opts.host != null) {
    return {
      kind: "tcp",
      host: opts.host ?? "127.0.0.1",
      port: opts.port ?? 0,
    };
  }
  throw new Error("createAppServer requires listen (socket) or host/port");
}

export function createAppServer(opts: AppServerOpts = {}): AppServer {
  // MVP security: loopback-only by default (DESIGN.md)
  const listen = resolveListen(opts);
  const host = listen.kind === "tcp" ? (listen.host ?? "127.0.0.1") : "ipc";
  const port = listen.kind === "tcp" ? (listen.port ?? 0) : 0;
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
  void loadDiskPlugins({
    projectRoot: hub.projectRoot,
    pluginSettings: new ConfigStore(hub.projectRoot).getPluginSettings(),
  }).catch(() => undefined);
  const termHub = new TerminalHub();

  const app = express();
  app.use(express.json({ limit: "4mb" }));

  // Lightweight liveness only — do not ensureAgent / load sessions here.
  app.get("/api/session-intents", (req, res) => {
    const sessionId = String(req.query.sessionId ?? "");
    const root = String(req.query.root ?? hub.projectRoot ?? "");
    res.json(loadSessionToolMeta(sessionId, root));
  });

  // 调试面板：这一轮发出去的 POST / 收回来的内容（只读落盘账本）
  app.get("/api/session-payloads", (req, res) => {
    const sessionId = String(req.query.sessionId ?? "");
    const root = String(req.query.root ?? hub.projectRoot ?? "");
    res.json(loadSessionPayloadIndex(sessionId, root));
  });

  app.get("/api/session-payload", (req, res) => {
    const sessionId = String(req.query.sessionId ?? "");
    const root = String(req.query.root ?? hub.projectRoot ?? "");
    const kind = req.query.kind === "user" ? "user" : "assistant";
    const id = String(req.query.id ?? "").trim();
    const idxRaw = Number(req.query.index);
    const sel = id
      ? { id }
      : Number.isInteger(idxRaw) && idxRaw >= 0
        ? { index: idxRaw }
        : null;
    if (!sessionId || !sel) {
      res.status(400).json({ ok: false, error: "sessionId + id|index required" });
      return;
    }
    const detail = loadSessionPayloadDetail(sessionId, root, kind, sel);
    if (!detail) {
      res.status(404).json({ ok: false, error: "payload not found" });
      return;
    }
    res.json({ ok: true, detail });
  });

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      service: "maou-app",
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
  app.get("/api/sessions/search", (req, res) => {
    try {
      const query = String(req.query?.q ?? req.query?.query ?? "").trim();
      const cursor = String(req.query?.cursor ?? "").trim() || undefined;
      const sessionId = String(req.query?.sessionId ?? "").trim() || undefined;
      const limitRaw = req.query?.limit;
      const limit =
        limitRaw != null && String(limitRaw).trim() ? Number(limitRaw) : undefined;
      const page = hub.searchSessions({
        query,
        cursor,
        sessionId,
        ...(Number.isFinite(limit) ? { limit } : {}),
      });
      res.json({ ok: true, ...page });
    } catch (e) {
      res.status(400).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.get("/api/project", (_req, res) => {
    res.json({ ok: true, projectRoot: hub.projectRoot });
  });

  app.get("/api/fs/browse", (req, res) => {
    try {
      res.json({ ok: true, ...hub.browseFolders(String(req.query.path ?? "")) });
    } catch (e) {
      res.status(400).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post("/api/fs/mkdir", (req, res) => {
    try {
      res.json({
        ok: true,
        ...hub.mkdirInBrowse(String(req.body?.dir ?? ""), String(req.body?.name ?? "")),
      });
    } catch (e) {
      res.status(400).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post("/api/project/open", (req, res) => {
    try {
      const opened = hub.openProjectRoot(String(req.body?.path ?? ""));
      void loadDiskPlugins({
        projectRoot: opened.projectRoot,
        pluginSettings: new ConfigStore(opened.projectRoot).getPluginSettings(),
      }).catch(() => undefined);
      res.json({ ok: true, ...opened });
    } catch (e) {
      res.status(400).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/plugins", (_req, res) => {
    res.json({
      ok: true,
      plugins: listDiskPlugins(),
      themeVars: {
        light: pluginThemeVars("light"),
        dark: pluginThemeVars("dark"),
      },
    });
  });

  app.get("/api/plugins/:id/ui", (req, res) => {
    const file = pluginUiFile(String(req.params.id ?? ""));
    if (!file || !existsSync(file)) {
      res.status(404).json({ ok: false, error: "no ui" });
      return;
    }
    res.type("text/javascript");
    res.send(readFileSync(file, "utf-8"));
  });

  app.post("/api/plugins/reload", async (_req, res) => {
    try {
      const plugins = await loadDiskPlugins({
        projectRoot: hub.projectRoot,
        pluginSettings: new ConfigStore(hub.projectRoot).getPluginSettings(),
      });
      res.json({ ok: true, plugins });
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post("/api/plugins/toggle", async (req, res) => {
    try {
      const id = String(req.body?.id ?? "").trim();
      const enabled = req.body?.enabled !== false;
      const store = new ConfigStore(hub.projectRoot);
      store.togglePlugin(id, enabled);
      const plugins = await loadDiskPlugins({
        projectRoot: hub.projectRoot,
        pluginSettings: store.getPluginSettings(),
      });
      res.json({ ok: true, plugins });
    } catch (e) {
      res.status(400).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

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

  app.get("/api/commands", (_req, res) => {
    try {
      res.json({ ok: true, commands: hub.listCommandCatalog() });
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
      const parentSessionId = req.body?.parentSessionId
        ? String(req.body.parentSessionId).trim()
        : "";
      const fork = Boolean(req.body?.fork);
      const { sessionId } = parentSessionId
        ? fork
          ? hub.forkSession(parentSessionId, title)
          : hub.newChildSession(parentSessionId, title)
        : hub.newSession(title);
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

  app.head("/api/sessions/:id/export.zip", (req, res) => {
    try {
      const pre = hub.preflightExport(String(req.params.id ?? ""));
      if (!pre.ok) {
        res.status(404).json({ ok: false, error: pre.error ?? "session not found" });
        return;
      }
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${hub.sessionExportFilename(pre.sessionId)}"`);
      res.status(200).end();
    } catch (e) {
      res.status(400).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.get("/api/sessions/:id/export.zip", (req, res) => {
    try {
      const id = String(req.params.id ?? "");
      const pre = hub.preflightExport(id);
      if (!pre.ok) {
        res.status(404).json({ ok: false, error: pre.error ?? "session not found" });
        return;
      }
      const buf = hub.exportSessionZip(id);
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${hub.sessionExportFilename(id)}"`);
      res.send(buf);
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
      // 删光了才新建；还有别的会话时 hub 已经坐过去了
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

  app.get("/api/sessions/active/messages", (req, res) => {
    try {
      const beforeSeqRaw = req.query?.beforeSeq;
      const limitRaw = req.query?.limit;
      const beforeSeq =
        beforeSeqRaw != null && String(beforeSeqRaw).trim()
          ? Number(beforeSeqRaw)
          : undefined;
      const limit =
        limitRaw != null && String(limitRaw).trim() ? Number(limitRaw) : undefined;
      const page = hub.loadSessionPage(undefined, {
        ...(Number.isFinite(beforeSeq) ? { beforeSeq } : {}),
        ...(Number.isFinite(limit) ? { limit } : {}),
      });
      res.json({
        ok: true,
        sessionId: hub.getMeta().sessionId,
        ...page,
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.get("/api/sessions/:id/preview-delete", (req, res) => {
    try {
      const id = String(req.params.id ?? "").trim();
      if (!id) {
        res.status(400).json({ ok: false, error: "id required" });
        return;
      }
      res.json({ ok: true, ...hub.previewDelete(id) });
    } catch (e) {
      res.status(400).json({
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
        today: hub.getTodayTokenTotals(),
        text: hub.getSessionStatsText(),
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.get("/api/usage/today", (_req, res) => {
    try {
      res.json({ ok: true, ...hub.getTodayTokenTotals() });
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

  app.post("/api/permission-preset", (req, res) => {
    try {
      const id = String(req.body?.id ?? "");
      const confirm = typeof req.body?.confirm === "string" ? req.body.confirm : undefined;
      const next =
        req.body?.scope === "default"
          ? hub.setDefaultPermissionPreset(id, confirm)
          : hub.setSessionPermissionPreset(id, confirm);
      res.json({ ok: true, ...next, ...hub.getMeta() });
    } catch (e) {
      res.status(400).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post("/api/send-mode", (req, res) => {
    const mode = String(req.body?.mode ?? "");
    if (mode !== "queue" && mode !== "insert") {
      res.status(400).json({ ok: false, error: "mode must be queue|insert" });
      return;
    }
    try {
      res.json({ ok: true, mode: hub.setSessionSendMode(mode), ...hub.getMeta() });
    } catch (e) {
      res.status(400).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/ask", (_req, res) => {
    res.json({ ok: true, pending: hub.listPendingAsks() });
  });

  app.post("/api/ask", (req, res) => {
    const sessionId = String(req.body?.sessionId ?? hub.getMeta().sessionId ?? "");
    const ok = hub.answerAsk(sessionId, req.body?.result ?? req.body);
    if (!ok) {
      res.status(404).json({ ok: false, error: "no pending ask" });
      return;
    }
    res.json({ ok: true });
  });

  app.post("/api/sessions/fork-message", (req, res) => {
    try {
      const out = hub.forkFromMessage(
        String(req.body?.sessionId ?? hub.getMeta().sessionId ?? ""),
        String(req.body?.entryId ?? ""),
        typeof req.body?.title === "string" ? req.body.title : undefined,
      );
      res.json({ ok: true, ...out });
    } catch (e) {
      res.status(400).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post("/api/sessions/feedback", (req, res) => {
    try {
      const result = hub.setMessageFeedback(
        String(req.body?.sessionId ?? hub.getMeta().sessionId ?? ""),
        String(req.body?.messageId ?? ""),
        req.body?.vote === "down" ? "down" : "up",
        typeof req.body?.note === "string" ? req.body.note : undefined,
      );
      res.json({ ok: true, conflict: result.conflict });
    } catch (e) {
      res.status(400).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/plan", (_req, res) => {
    try {
      res.json({ ok: true, ...hub.readSessionPlan() });
    } catch (e) {
      res.status(400).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post("/api/plan/toggle", (_req, res) => {
    try {
      hub.togglePlanActive();
      // plan / goal 一律以 getMeta() 的落盘态为准（clear 后应当是 undefined）；
      // 之前把返回值写在 spread 前面，会被 getMeta 直接盖掉，是条死代码。
      res.json({ ok: true, ...hub.getMeta() });
    } catch (e) {
      res.status(400).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post("/api/goal", (req, res) => {
    try {
      const action = String(req.body?.action ?? "");
      if (action !== "pause" && action !== "resume" && action !== "clear" && action !== "edit") {
        res.status(400).json({ ok: false, error: "invalid action" });
        return;
      }
      hub.mutateGoal(
        action,
        typeof req.body?.objective === "string" ? req.body.objective : undefined,
      );
      res.json({ ok: true, ...hub.getMeta() });
    } catch (e) {
      res.status(400).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
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
              "/compact · /context · /init · /plan · /goal · /ultragoal — 经 chat 走 Runtime",
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
    const images = Array.isArray(req.body?.images) ? req.body.images : [];
    if (!message && !images.length) {
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
      for await (const ev of hub.runChat(message, { images })) {
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

  app.get("/", (_req, res) => {
    res.status(404).json({ ok: false, error: "desktop client only" });
  });

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
      return new Promise<AppListenInfo>((resolve, reject) => {
        http.once("error", reject);
        const onListening = () => {
          proactive.start();
          if (listen.kind === "socket") {
            resolve({
              host: "ipc",
              port: 0,
              url: `ipc:${listen.path}`,
              socketPath: listen.path,
            });
            return;
          }
          const addr = http.address();
          const actualPort =
            typeof addr === "object" && addr && typeof addr.port === "number"
              ? addr.port
              : port;
          resolve({
            host,
            port: actualPort,
            url: `http://${host}:${actualPort}`,
          });
        };
        if (listen.kind === "socket") {
          const sock = listen.path;
          if (!sock.startsWith("\\\\.\\pipe\\")) {
            mkdirSync(dirname(sock), { recursive: true });
            if (existsSync(sock)) unlinkSync(sock);
          }
          http.listen(sock, onListening);
          return;
        }
        http.listen(port, host, onListening);
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
        http.close(() => {
          if (listen.kind === "socket" && !listen.path.startsWith("\\\\.\\pipe\\")) {
            try {
              if (existsSync(listen.path)) unlinkSync(listen.path);
            } catch {
              /* ignore */
            }
          }
          resolve();
        });
      });
    },
    attachAgentTerminal(ws, attachOpts) {
      attachAgentTerminalSocket(ws, attachOpts);
    },
    attachHumanTerminal(ws) {
      attachTerminalSocket(termHub, ws, hub.projectRoot, hub.agentName || agentName);
    },
  };
}
