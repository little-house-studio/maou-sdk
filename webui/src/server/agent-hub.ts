/**
 * AgentHub —— Web 侧会话 / 模型 / 审批 / 流式 run（复用 coding-agent）。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  createStandardAgentDeps,
  getRolePresetFromMaouConfig,
  resolvePresetForCli,
  listProvidersForCli,
  listModelsForCli,
} from "@little-house-studio/agent";
import type { StreamEvent } from "@little-house-studio/types";
import { createCodingAgent } from "@little-house-studio/coding-agent";
import type { SessionStore } from "@little-house-studio/context";
import {
  setTerminalPolicyRoot,
  setTerminalApprover,
  getTerminalMode,
  setTerminalMode,
  type TerminalMode,
  type TerminalApprover,
} from "@little-house-studio/tools";
import {
  collectSessionStats,
  formatSessionAnalyze,
  formatSessionStats,
  latestSessionId,
  type SessionStats,
} from "./session-stats.js";
import {
  listLiveAgents,
  parseAgentSwitchId,
  resolveDefaultSwitchId,
  type LiveAgentDto,
} from "./agent-list.js";

function lastSessionPath(projectRoot: string): string {
  return join(projectRoot, ".maou", "last-session.json");
}

function readLastSessionPointer(projectRoot: string): string | null {
  try {
    const p = lastSessionPath(projectRoot);
    if (!existsSync(p)) return null;
    const raw = JSON.parse(readFileSync(p, "utf8")) as {
      sessionId?: string;
    };
    const id = String(raw.sessionId ?? "").trim();
    if (!id) return null;
    const jsonl = join(projectRoot, ".maou", "sessions", `${id}.jsonl`);
    const meta = join(projectRoot, ".maou", "sessions", `${id}.meta.json`);
    if (existsSync(jsonl) || existsSync(meta)) return id;
  } catch {
    /* ignore */
  }
  return null;
}

function writeLastSessionPointer(
  projectRoot: string,
  sessionId: string,
  agentName: string,
): void {
  try {
    const p = lastSessionPath(projectRoot);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(
      p,
      JSON.stringify(
        {
          sessionId,
          agentName,
          cwd: projectRoot,
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
  } catch {
    /* ignore */
  }
}

export type ApprovalMode = "normal" | "auto" | "yolo";

export interface AgentHubOpts {
  projectRoot?: string;
  maouRoot?: string;
  /** 默认 yolo：本机 Web 可改 normal/auto */
  sandboxMode?: string;
  /** Initial active agent name (default coding) */
  agentName?: string;
}

export type SessionSummary = {
  id: string;
  title: string;
  updatedAt?: string;
  messageCount: number;
  lastMsgAt?: string;
};

export type ChatHistoryLine = {
  id: string;
  role: string;
  content: string;
  ts?: string;
};

export type PendingApproval = {
  id: string;
  command: string;
  agentName: string;
  cwd?: string;
  risk?: "low" | "high";
  summary?: string;
  label?: string;
  reason?: string;
  createdAt: number;
};

type PendingEntry = {
  resolve: (v: {
    approve: boolean;
    persist?: "whitelist" | "blacklist" | "none";
  }) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
  info: PendingApproval;
};

const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;

function genApprovalId(): string {
  return `ta_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function asApprovalMode(v: string | undefined): ApprovalMode {
  if (v === "normal" || v === "auto" || v === "yolo") return v;
  return "yolo";
}

export class AgentHub {
  readonly projectRoot: string;
  readonly maouRoot: string;
  /** Active agent name (terminal / session scoping; switchable via /api/agents/active) */
  private _agentName: string;
  /** CLI switch_id: system:<name> | project:<path>:<name> */
  private _activeSwitchId: string;
  /** Project path when active agent is project-scoped */
  private _activeProjectPath: string | null = null;
  private handle: ReturnType<typeof createCodingAgent> | null = null;
  private sessionStore: SessionStore | null = null;
  private sessionId: string | null = null;
  private abort: AbortController | null = null;
  private provider = "";
  private model = "";
  /** run() sandboxMode — 与 terminal policy 同步 */
  private sandboxMode: ApprovalMode;
  private pendingApprovals = new Map<string, PendingEntry>();
  private approverInstalled = false;
  private restoredSession = false;

  constructor(opts: AgentHubOpts = {}) {
    this.projectRoot = opts.projectRoot ?? process.cwd();
    this.maouRoot = opts.maouRoot ?? join(homedir(), ".maou");
    this.sandboxMode = asApprovalMode(opts.sandboxMode);
    this._agentName = opts.agentName?.trim() || "coding";
    // CLI switch_id: project path when this hub serves a registered project
    const def = resolveDefaultSwitchId(
      this.projectRoot,
      this._agentName,
      this.maouRoot,
    );
    this._activeSwitchId = def.switchId;
    this._activeProjectPath = def.projectPath;
  }

  get agentName(): string {
    return this._agentName;
  }

  get activeSwitchId(): string {
    return this._activeSwitchId;
  }

  get activeProjectPath(): string | null {
    return this._activeProjectPath;
  }

  /**
   * Switch active agent by CLI switch_id (preferred) or bare name.
   * project:<path>:<name> scopes terminal/session agent label + project path.
   */
  setActiveAgent(nameOrSwitchId: string): void {
    const raw = String(nameOrSwitchId || "").trim();
    if (!raw) return;
    const parsed = parseAgentSwitchId(raw);
    if (parsed) {
      this._agentName = parsed.agentName;
      this._activeProjectPath =
        parsed.kind === "project" ? parsed.projectPath ?? null : null;
      this._activeSwitchId =
        parsed.kind === "project" && parsed.projectPath
          ? `project:${parsed.projectPath}:${parsed.agentName}`
          : `system:${parsed.agentName}`;
      return;
    }
    this._agentName = raw;
    this._activeProjectPath = null;
    this._activeSwitchId = `system:${raw}`;
  }

  private rememberSession(id: string | null) {
    if (!id) return;
    this.sessionId = id;
    writeLastSessionPointer(this.projectRoot, id, this.agentName);
  }

  /** CLI 对齐：last-session.json → 否则 mtime 最新 jsonl */
  private restoreLastSessionIfNeeded() {
    if (this.restoredSession || this.sessionId) {
      this.restoredSession = true;
      return;
    }
    this.restoredSession = true;
    const fromPtr = readLastSessionPointer(this.projectRoot);
    if (fromPtr && this.sessionStore?.load(fromPtr)) {
      this.sessionId = fromPtr;
      return;
    }
    const latest = latestSessionId(this.projectRoot);
    if (latest && this.sessionStore?.load(latest)) {
      this.sessionId = latest;
      writeLastSessionPointer(this.projectRoot, latest, this.agentName);
    }
  }

  private ensureAgent() {
    if (this.handle && this.sessionStore) {
      this.restoreLastSessionIfNeeded();
      return this.handle;
    }
    const deps = createStandardAgentDeps(this.projectRoot, this.maouRoot, {
      reviewerOnMissingPreset: "approve",
    });
    this.sessionStore = deps.sessionStore;
    this.handle = createCodingAgent({
      projectRoot: this.projectRoot,
      maouRoot: this.maouRoot,
      configStore: deps.configStore,
      sessionStore: deps.sessionStore,
      toolRegistry: deps.toolRegistry,
      llmClient: deps.llmClient,
      log: () => {},
      enablePostLogger: false,
    });
    this.bootstrapPreset();
    this.installTerminalApprover();
    // 同步磁盘策略（不强制覆盖 yolo 默认，除非磁盘有明确值）
    try {
      setTerminalPolicyRoot(this.maouRoot);
      const disk = getTerminalMode(this.agentName);
      if (disk === "normal" || disk === "auto" || disk === "yolo") {
        // 构造时若显式传了 sandboxMode 用构造值；否则跟磁盘
        if (!process.env.MAOU_SANDBOX_MODE) {
          this.sandboxMode = disk;
        } else {
          setTerminalMode(this.agentName, this.sandboxMode);
        }
      } else {
        setTerminalMode(this.agentName, this.sandboxMode);
      }
    } catch {
      /* ignore */
    }
    this.restoreLastSessionIfNeeded();
    return this.handle;
  }

  private bootstrapPreset() {
    // 不覆盖已由 setModel 写入的选择
    if (this.provider && this.model) return;
    try {
      const main = getRolePresetFromMaouConfig("main") as
        | { name?: string; model?: string }
        | undefined;
      if (main?.name && main?.model) {
        this.provider = main.name;
        this.model = main.model;
        return;
      }
    } catch {
      /* fall through */
    }
    const ps = listProvidersForCli();
    if (ps[0]) {
      this.provider = ps[0].id;
      const ms = listModelsForCli(ps[0].id);
      this.model = ms[0]?.id ?? "";
    }
  }

  private installTerminalApprover() {
    if (this.approverInstalled) return;
    this.approverInstalled = true;
    try {
      setTerminalPolicyRoot(this.maouRoot);
    } catch {
      /* ignore */
    }

    const approver: TerminalApprover = async (command, ctx) => {
      const mode = this.sandboxMode;
      // yolo: 直接放行（DCG 仍在 tools 层硬拦）
      if (mode === "yolo") {
        return { approve: true, persist: "none" };
      }
      // auto: 尝试 reviewer；无 reviewer 时弹人手
      if (mode === "auto" && !ctx.forceHuman) {
        // 无注入 reviewer 时退回人手卡（与 CLI 行为接近）
      }

      return new Promise((resolve, reject) => {
        const id = genApprovalId();
        const timer = setTimeout(() => {
          this.pendingApprovals.delete(id);
          reject(new Error("approval timeout"));
        }, APPROVAL_TIMEOUT_MS);
        const info: PendingApproval = {
          id,
          command,
          agentName: ctx.agentName || this.agentName,
          cwd: ctx.cwd,
          risk: ctx.risk === "high" ? "high" : "low",
          summary: ctx.summary,
          label: ctx.label,
          reason: ctx.reason,
          createdAt: Date.now(),
        };
        this.pendingApprovals.set(id, { resolve, reject, timer, info });
      });
    };

    setTerminalApprover(approver);
  }

  getMeta() {
    this.ensureAgent();
    return {
      sessionId: this.sessionId,
      provider: this.provider,
      model: this.model,
      projectRoot: this.projectRoot,
      sandboxMode: this.sandboxMode,
      approvalMode: this.sandboxMode,
      agentName: this.agentName,
      providers: listProvidersForCli(),
      models: this.provider ? listModelsForCli(this.provider) : [],
    };
  }

  listModels(provider?: string) {
    const p = provider || this.provider;
    return listModelsForCli(p);
  }

  listProviders() {
    return listProvidersForCli();
  }

  setModel(provider: string, model: string) {
    this.provider = provider;
    this.model = model;
  }

  /**
   * CLI-aligned agent list (AgentRegistry + presence file).
   * Busy/approval from this hub affect the *active* agent's status light.
   */
  listAgents(): LiveAgentDto[] {
    return listLiveAgents({
      maouRoot: this.maouRoot,
      projectRoot: this.projectRoot,
      activeSwitchId: this._activeSwitchId,
      activeAgentName: this.agentName,
      activeProjectPath: this._activeProjectPath,
      agentBusy: Boolean(this.abort),
      hasPendingApproval: this.pendingApprovals.size > 0,
    });
  }

  getApprovalMode(): ApprovalMode {
    return this.sandboxMode;
  }

  setApprovalMode(mode: string): ApprovalMode {
    const m = asApprovalMode(mode);
    this.sandboxMode = m;
    this.ensureAgent();
    try {
      setTerminalPolicyRoot(this.maouRoot);
      setTerminalMode(this.agentName, m as TerminalMode);
    } catch {
      /* ignore */
    }
    return m;
  }

  listSessions(): SessionSummary[] {
    this.ensureAgent();
    const store = this.sessionStore!;
    try {
      return store.list().map((s) => ({
        id: s.id,
        title: s.title || "新对话",
        updatedAt: s.updatedAt,
        messageCount: s.messageCount ?? 0,
        lastMsgAt: s.lastMsgAt,
      }));
    } catch {
      return [];
    }
  }

  newSession(title?: string): { sessionId: string } {
    this.ensureAgent();
    this.abortRun();
    const id = this.handle!.startSession(title);
    this.rememberSession(id);
    return { sessionId: id };
  }

  switchSession(sessionId: string): { sessionId: string } {
    this.ensureAgent();
    const id = String(sessionId || "").trim();
    if (!id) throw new Error("sessionId required");
    const store = this.sessionStore!;
    const data = store.load(id);
    if (!data) throw new Error(`session not found: ${id}`);
    this.abortRun();
    this.rememberSession(id);
    return { sessionId: id };
  }

  /** 清空会话消息（保留会话 id / 元数据） */
  clearSessionMessages(sessionId?: string | null): { sessionId: string } {
    this.ensureAgent();
    const id = sessionId || this.sessionId;
    if (!id) throw new Error("no active session");
    this.abortRun();
    this.sessionStore!.clearSession(id);
    this.rememberSession(id);
    return { sessionId: id };
  }

  /** 删除会话文件；若删的是当前会话则开新会话 */
  deleteSession(sessionId: string): {
    deleted: boolean;
    sessionId: string | null;
  } {
    this.ensureAgent();
    const id = String(sessionId || "").trim();
    if (!id) throw new Error("sessionId required");
    this.abortRun();
    const deleted = this.sessionStore!.delete(id);
    if (this.sessionId === id) {
      this.sessionId = null;
    }
    return { deleted, sessionId: this.sessionId };
  }

  /** 重命名会话标题（写 meta.json） */
  renameSession(sessionId: string, title: string): { sessionId: string; title: string } {
    this.ensureAgent();
    const id = String(sessionId || "").trim();
    const t = String(title || "").trim();
    if (!id) throw new Error("sessionId required");
    if (!t) throw new Error("title required");
    const metaPath = join(
      this.projectRoot,
      ".maou",
      "sessions",
      `${id}.meta.json`,
    );
    if (!existsSync(metaPath)) throw new Error(`session not found: ${id}`);
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(readFileSync(metaPath, "utf8")) as Record<
        string,
        unknown
      >;
    } catch {
      meta = { id };
    }
    meta.id = id;
    meta.title = t.slice(0, 80);
    meta.updated_at = new Date().toISOString();
    writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf8");
    return { sessionId: id, title: String(meta.title) };
  }

  /** 导出当前会话纯文本 transcript */
  exportTranscript(sessionId?: string | null): string {
    const msgs = this.loadSessionMessages(sessionId);
    if (msgs.length === 0) return "(empty session)\n";
    return (
      msgs
        .map((m) => {
          const role = (m.role || "assistant").toUpperCase();
          return `### ${role}\n${m.content || ""}\n`;
        })
        .join("\n") + "\n"
    );
  }

  /** 加载会话消息供 WebUI 渲染历史 */
  loadSessionMessages(sessionId?: string | null): ChatHistoryLine[] {
    this.ensureAgent();
    const id = sessionId || this.sessionId;
    if (!id) return [];
    const data = this.sessionStore!.load(id);
    const msgs = (data?.messages ?? []) as Array<Record<string, unknown>>;
    return msgs.map((m, i) => {
      const raw = m.content;
      let content = "";
      if (typeof raw === "string") content = raw;
      else if (Array.isArray(raw)) {
        content = raw
          .map((c: unknown) => {
            if (typeof c === "string") return c;
            if (c && typeof c === "object" && "text" in (c as object)) {
              return String((c as { text?: string }).text ?? "");
            }
            return "";
          })
          .join("");
      } else if (raw != null) content = JSON.stringify(raw);
      return {
        id: `${id}-${i}`,
        role: String(m.role ?? "assistant"),
        content,
        ts: String(m.createdAt ?? m.created_at ?? ""),
      };
    });
  }

  listPendingApprovals(): PendingApproval[] {
    return [...this.pendingApprovals.values()].map((p) => p.info);
  }

  answerApproval(
    id: string,
    choice: "once" | "always" | "deny" | "blacklist",
  ): boolean {
    const p = this.pendingApprovals.get(id);
    if (!p) return false;
    this.pendingApprovals.delete(id);
    if (p.timer) clearTimeout(p.timer);
    switch (choice) {
      case "once":
        p.resolve({ approve: true, persist: "none" });
        break;
      case "always":
        p.resolve({ approve: true, persist: "whitelist" });
        break;
      case "blacklist":
        p.resolve({ approve: false, persist: "blacklist" });
        break;
      case "deny":
      default:
        p.resolve({ approve: false, persist: "none" });
        break;
    }
    return true;
  }

  cancelAllApprovals(reason = "cancelled") {
    for (const [id, p] of this.pendingApprovals) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(new Error(reason));
      this.pendingApprovals.delete(id);
    }
  }

  abortRun() {
    this.abort?.abort();
    this.abort = null;
    // Stop must unblock any in-flight terminal approval waits (CLI cancel stack)
    this.cancelAllApprovals("aborted");
  }

  /** Session token/message stats from on-disk jsonl */
  getSessionStats(sessionId?: string | null): SessionStats | null {
    this.ensureAgent();
    const id = sessionId || this.sessionId;
    if (!id) return null;
    return collectSessionStats(this.projectRoot, id);
  }

  getSessionStatsText(sessionId?: string | null): string {
    const s = this.getSessionStats(sessionId);
    if (!s) return "Usage\n  暂无活动会话。";
    return formatSessionStats(s);
  }

  analyzeSession(sessionId?: string | null): string {
    const s = this.getSessionStats(sessionId);
    if (!s) return "Analyze\n  暂无活动会话。";
    return formatSessionAnalyze(s);
  }

  /**
   * 流式跑一轮用户消息；yield StreamEvent。
   */
  async *runChat(message: string): AsyncGenerator<StreamEvent> {
    const agent = this.ensureAgent();
    const text = message.trim();
    if (!text) return;

    this.abort?.abort();
    this.abort = new AbortController();

    if (!this.sessionId) {
      this.rememberSession(agent.startSession());
    } else {
      this.rememberSession(this.sessionId);
    }
    const sessionId = this.sessionId!;
    const preset = resolvePresetForCli(this.provider, this.model) as Record<
      string,
      unknown
    >;

    try {
      for await (const ev of agent.runtime.run({
        sessionId,
        userMessage: text,
        preset,
        stream: true,
        abortSignal: this.abort.signal,
        source: "webui",
        sandboxMode: this.sandboxMode,
      })) {
        yield ev;
        if (ev.type === "done" || ev.type === "error") break;
      }
    } finally {
      this.abort = null;
    }
  }
}
