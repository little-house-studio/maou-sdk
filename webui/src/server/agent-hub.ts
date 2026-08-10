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
  MESSAGE_QUEUE,
  type MessageQueueMode,
  type QueuedMessage,
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
import { listAgentTerminals } from "./agent-terminals.js";

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
  /** Agent appendMessage meta.tool_name — 工具徽章真实名，禁止丢弃 */
  toolName?: string;
  toolOk?: boolean;
  toolCallId?: string;
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

/**
 * Workspace root for sessions + coding-agent when an agent is active.
 * - project:<path>:<name> → <path>
 * - system:ops → ~/.maou/ops (if present) else maouRoot
 * - other system agents (main/coding/…) → hub boot cwd (webui --cwd)
 *   so launching webui in a repo still uses that repo's .maou/sessions
 */
export function resolveWorkspaceForSwitch(opts: {
  maouRoot: string;
  bootProjectRoot: string;
  kind: "system" | "project";
  agentName: string;
  projectPath: string | null;
}): string {
  if (opts.kind === "project" && opts.projectPath?.trim()) {
    return opts.projectPath.trim();
  }
  const name = (opts.agentName || "").trim();
  if (name === "ops") {
    const ops = join(opts.maouRoot, "ops");
    return existsSync(ops) ? ops : opts.maouRoot;
  }
  return opts.bootProjectRoot;
}

/**
 * 每个可切换 Agent（switch_id）的运行时槽。
 * 切换 Agent 时保留槽位与进行中的 run，不销毁、不 abort。
 */
type AgentRuntimeSlot = {
  switchId: string;
  agentName: string;
  projectRoot: string;
  projectPath: string | null;
  handle: ReturnType<typeof createCodingAgent> | null;
  sessionStore: SessionStore | null;
  sessionId: string | null;
  /** 该 Agent 下每会话的 AbortController */
  runs: Map<string, AbortController>;
  restoredSession: boolean;
};

export class AgentHub {
  /** Launch cwd (webui --cwd); used as list ensure path + fallback workspace */
  readonly bootProjectRoot: string;
  readonly maouRoot: string;
  /** Active workspace for SessionStore / coding-agent (changes on agent switch) */
  private _projectRoot: string;
  /** Active agent name (terminal / session scoping; switchable via /api/agents/active) */
  private _agentName: string;
  /** CLI switch_id: system:<name> | project:<path>:<name> */
  private _activeSwitchId: string;
  /** Project path when active agent is project-scoped */
  private _activeProjectPath: string | null = null;
  private handle: ReturnType<typeof createCodingAgent> | null = null;
  private sessionStore: SessionStore | null = null;
  private sessionId: string | null = null;
  /**
   * 当前焦点 Agent 的 runs（与 slots[active].runs 同一引用）。
   * key = sessionId；切换会话/Agent 都不会 abort 其它 run。
   */
  private runs = new Map<string, AbortController>();
  /** 全部 Agent 槽（含当前）；跨 Agent 并行的核心 */
  private slots = new Map<string, AgentRuntimeSlot>();
  private provider = "";
  private model = "";
  /** run() sandboxMode — 与 terminal policy 同步 */
  private sandboxMode: ApprovalMode;
  private pendingApprovals = new Map<string, PendingEntry>();
  private approverInstalled = false;
  private restoredSession = false;

  constructor(opts: AgentHubOpts = {}) {
    this.bootProjectRoot = opts.projectRoot ?? process.cwd();
    this._projectRoot = this.bootProjectRoot;
    this.maouRoot = opts.maouRoot ?? join(homedir(), ".maou");
    this.sandboxMode = asApprovalMode(opts.sandboxMode);
    this._agentName = opts.agentName?.trim() || "coding";
    // CLI switch_id: project path when this hub serves a registered project
    const def = resolveDefaultSwitchId(
      this.bootProjectRoot,
      this._agentName,
      this.maouRoot,
    );
    this._activeSwitchId = def.switchId;
    this._activeProjectPath = def.projectPath;
    this._projectRoot = resolveWorkspaceForSwitch({
      maouRoot: this.maouRoot,
      bootProjectRoot: this.bootProjectRoot,
      kind: def.projectPath ? "project" : "system",
      agentName: this._agentName,
      projectPath: def.projectPath,
    });
    // 初始槽位
    this.syncActiveIntoSlots();
  }

  /** 把当前焦点状态写回 slots（保证跨 Agent 切换不丢 run） */
  private syncActiveIntoSlots(): void {
    const id = this._activeSwitchId;
    if (!id) return;
    const prev = this.slots.get(id);
    this.slots.set(id, {
      switchId: id,
      agentName: this._agentName,
      projectRoot: this._projectRoot,
      projectPath: this._activeProjectPath,
      handle: this.handle,
      sessionStore: this.sessionStore,
      sessionId: this.sessionId,
      // 保持 runs Map 引用稳定（runChat finally 闭包依赖）
      runs: prev?.runs === this.runs ? this.runs : this.runs,
      restoredSession: this.restoredSession,
    });
  }

  private applySlot(slot: AgentRuntimeSlot): void {
    this._activeSwitchId = slot.switchId;
    this._agentName = slot.agentName;
    this._projectRoot = slot.projectRoot;
    this._activeProjectPath = slot.projectPath;
    this.handle = slot.handle;
    this.sessionStore = slot.sessionStore;
    this.sessionId = slot.sessionId;
    this.runs = slot.runs;
    this.restoredSession = slot.restoredSession;
  }

  /** Effective workspace (sessions + agent run). */
  get projectRoot(): string {
    return this._projectRoot;
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
   * Rebinds workspace SessionStore + coding-agent handle and restores that
   * agent's last session (clicking the left agent list must change chat).
   */
  setActiveAgent(nameOrSwitchId: string): void {
    const raw = String(nameOrSwitchId || "").trim();
    if (!raw) return;

    let nextName = raw;
    let nextProjectPath: string | null = null;
    let nextSwitchId = `system:${raw}`;
    let kind: "system" | "project" = "system";

    const parsed = parseAgentSwitchId(raw);
    if (parsed) {
      nextName = parsed.agentName;
      if (parsed.kind === "project" && parsed.projectPath) {
        kind = "project";
        nextProjectPath = parsed.projectPath;
        nextSwitchId = `project:${parsed.projectPath}:${parsed.agentName}`;
      } else {
        kind = "system";
        nextProjectPath = null;
        nextSwitchId = `system:${parsed.agentName}`;
      }
    }

    const nextRoot = resolveWorkspaceForSwitch({
      maouRoot: this.maouRoot,
      bootProjectRoot: this.bootProjectRoot,
      kind,
      agentName: nextName,
      projectPath: nextProjectPath,
    });

    const same =
      nextSwitchId === this._activeSwitchId &&
      nextRoot === this._projectRoot &&
      nextName === this._agentName;
    if (same) return;

    // 切换 Agent：不 abort、不销毁旧槽 — 旧 Agent 的 run / 终端继续
    this.syncActiveIntoSlots();

    const existing = this.slots.get(nextSwitchId);
    if (existing) {
      this.applySlot(existing);
      // 槽里已有 handle 则只恢复会话指针；否则 ensureAgent 会建
      if (this.handle && this.sessionStore) {
        this.restoreLastSessionIfNeeded();
      } else {
        this.ensureAgent();
        this.syncActiveIntoSlots();
      }
      return;
    }

    // 新 Agent 槽
    this._agentName = nextName;
    this._activeProjectPath = nextProjectPath;
    this._activeSwitchId = nextSwitchId;
    this._projectRoot = nextRoot;
    this.handle = null;
    this.sessionStore = null;
    this.sessionId = null;
    this.runs = new Map();
    this.restoredSession = false;
    this.ensureAgent();
    this.syncActiveIntoSlots();
  }

  private rememberSession(id: string | null) {
    if (!id) return;
    this.sessionId = id;
    writeLastSessionPointer(this.projectRoot, id, this.agentName);
    this.syncActiveIntoSlots();
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
      name: this._agentName,
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
    this.syncActiveIntoSlots();
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
   * Busy light: 该 Agent 有 chat run 或持久终端在跑。
   */
  listAgents(): LiveAgentDto[] {
    const busySwitchIds = this.listBusySwitchIds();
    const termAgents = this.listAgentsWithRunningTerminals();
    const agents = listLiveAgents({
      maouRoot: this.maouRoot,
      // Always ensure boot cwd + active project appear in the list
      projectRoot: this.bootProjectRoot,
      activeSwitchId: this._activeSwitchId,
      activeAgentName: this.agentName,
      activeProjectPath: this._activeProjectPath,
      // 不再只用「当前 Agent」busy；逐条在下方覆盖
      agentBusy: false,
      hasPendingApproval: this.pendingApprovals.size > 0,
    });
    return agents.map((a) => {
      const switchId = a.switchId || a.id;
      const chatBusy = busySwitchIds.has(switchId);
      const termBusy = termAgents.has(a.name);
      if (
        (chatBusy || termBusy) &&
        (a.status === "idle" || a.status === "done_read" || a.status === "done_unread")
      ) {
        return {
          ...a,
          status: "running" as const,
          overview: termBusy && !chatBusy
            ? `终端运行中 · ${a.overview || ""}`.trim()
            : chatBusy
              ? `会话生成中 · ${a.overview || ""}`.trim()
              : a.overview,
        };
      }
      return a;
    });
  }

  /** 有进行中 chat run 的 switchId 集合 */
  listBusySwitchIds(): Set<string> {
    this.syncActiveIntoSlots();
    const out = new Set<string>();
    for (const slot of this.slots.values()) {
      if (slot.runs.size > 0) out.add(slot.switchId);
    }
    return out;
  }

  /** 有 running/active 终端的 agentName 集合 */
  listAgentsWithRunningTerminals(): Set<string> {
    const names = new Set<string>();
    try {
      for (const t of listAgentTerminals()) {
        const st = (t.state || "").toLowerCase();
        if (st === "running" || st === "active" || st === "busy") {
          if (t.agentName) names.add(t.agentName);
        }
      }
    } catch {
      /* terminal engine not ready */
    }
    return names;
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
    // 新建会话不打断其它会话的并行 run
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
    // 切换焦点会话，不 abort 其它会话 run
    this.rememberSession(id);
    return { sessionId: id };
  }

  /** 清空会话消息（保留会话 id / 元数据） */
  clearSessionMessages(sessionId?: string | null): { sessionId: string } {
    this.ensureAgent();
    const id = sessionId || this.sessionId;
    if (!id) throw new Error("no active session");
    this.abortRun(id);
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
    this.abortRun(id);
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
      const toolName = String(
        m.tool_name ?? m.toolName ?? "",
      ).trim();
      const toolCallId = String(
        m.toolCallId ?? m.tool_call_id ?? "",
      ).trim();
      const toolOk =
        typeof m.tool_ok === "boolean"
          ? m.tool_ok
          : typeof m.toolOk === "boolean"
            ? m.toolOk
            : undefined;
      return {
        id: `${id}-${i}`,
        role: String(m.role ?? "assistant"),
        content,
        ts: String(m.createdAt ?? m.created_at ?? ""),
        ...(toolName ? { toolName } : {}),
        ...(toolCallId ? { toolCallId } : {}),
        ...(toolOk !== undefined ? { toolOk } : {}),
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

  /** 中断指定会话 run；缺省为当前焦点会话（只动当前 Agent 槽） */
  abortRun(sessionId?: string | null) {
    const id = (sessionId ?? this.sessionId)?.trim() || null;
    if (!id) return;
    const ac = this.runs.get(id);
    if (ac) {
      try {
        ac.abort();
      } catch {
        /* ignore */
      }
      this.runs.delete(id);
    }
    try {
      MESSAGE_QUEUE.clear(id);
    } catch {
      /* ignore */
    }
    this.syncActiveIntoSlots();
  }

  /** 中断全部 Agent 全部会话 run（仅服务关闭等） */
  abortAllRuns() {
    this.syncActiveIntoSlots();
    for (const slot of this.slots.values()) {
      for (const [id, ac] of slot.runs) {
        try {
          ac.abort();
        } catch {
          /* ignore */
        }
        try {
          MESSAGE_QUEUE.clear(id);
        } catch {
          /* ignore */
        }
      }
      slot.runs.clear();
    }
    this.runs.clear();
    this.cancelAllApprovals("aborted");
  }

  /** 当前焦点 Agent 正在跑的会话 id 列表 */
  listRunningSessions(): string[] {
    return Array.from(this.runs.keys());
  }

  /**
   * 全部 Agent 正在跑的会话（含 switchId / agentName）。
   * 前端可用来给非焦点 Agent 亮灯。
   */
  listAllRunningSessions(): Array<{
    sessionId: string;
    switchId: string;
    agentName: string;
  }> {
    this.syncActiveIntoSlots();
    const out: Array<{
      sessionId: string;
      switchId: string;
      agentName: string;
    }> = [];
    for (const slot of this.slots.values()) {
      for (const sessionId of slot.runs.keys()) {
        out.push({
          sessionId,
          switchId: slot.switchId,
          agentName: slot.agentName,
        });
      }
    }
    return out;
  }

  isSessionBusy(sessionId?: string | null): boolean {
    const id = (sessionId ?? this.sessionId)?.trim() || null;
    return id ? this.runs.has(id) : false;
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
   * 同一会话再次发送会替换该会话旧 run；其它会话 run 不受影响。
   */
  async *runChat(message: string): AsyncGenerator<StreamEvent> {
    const agent = this.ensureAgent();
    const text = message.trim();
    if (!text) return;

    if (!this.sessionId) {
      this.rememberSession(agent.startSession());
    } else {
      this.rememberSession(this.sessionId);
    }
    const sessionId = this.sessionId!;

    // 捕获当前槽的 runs 引用：切 Agent 后 this.runs 会换 Map，finally 必须写回原 Map
    const runsMap = this.runs;
    const switchIdAtStart = this._activeSwitchId;
    // 仅中断「本会话」旧 run，保留其它会话 / 其它 Agent 并行
    runsMap.get(sessionId)?.abort();
    const ac = new AbortController();
    runsMap.set(sessionId, ac);
    this.syncActiveIntoSlots();

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
        abortSignal: ac.signal,
        source: "webui",
        sandboxMode: this.sandboxMode,
      })) {
        yield ev;
        if (ev.type === "done" || ev.type === "error") break;
      }
    } finally {
      if (runsMap.get(sessionId) === ac) {
        runsMap.delete(sessionId);
      }
      // 若仍是该 Agent 焦点，同步槽；否则只更新 slots 里对应 switchId
      const slot = this.slots.get(switchIdAtStart);
      if (slot && slot.runs === runsMap) {
        /* already same ref */
      }
      this.syncActiveIntoSlots();
    }
  }

  /** 当前焦点会话是否 busy（入队判断用） */
  isBusy(sessionId?: string | null): boolean {
    return this.isSessionBusy(sessionId);
  }

  /** 是否有任意会话在跑（Agent 列表灯） */
  isAnyBusy(): boolean {
    return this.runs.size > 0;
  }

  /**
   * UI 发送模式 → MessageQueue 后端模式
   * - queue  → after_round_complete：等当前轮结束再投递，同 run 内继续
   * - insert → interrupt_immediately：打断当前流，下个 round 立刻处理
   */
  static mapSendMode(mode: "queue" | "insert"): MessageQueueMode {
    return mode === "insert" ? "interrupt_immediately" : "after_round_complete";
  }

  /**
   * 运行中把用户消息入队到 Agent MessageQueue（与 runtime 同单例）。
   * 空闲时应直接 runChat，不要走这里。
   */
  enqueueUserMessage(
    message: string,
    mode: "queue" | "insert" = "queue",
  ): {
    ok: true;
    id: number;
    mode: "queue" | "insert";
    queueMode: MessageQueueMode;
    shouldAbort: boolean;
    shouldStopRun: boolean;
    queue: Array<{
      id: number;
      message: string;
      mode: MessageQueueMode;
      enqueuedAt: number;
      source: string;
    }>;
  } {
    this.ensureAgent();
    const text = message.trim();
    if (!text) {
      throw new Error("message required");
    }
    if (!this.sessionId) {
      throw new Error("no active session — send a first message first");
    }
    // 空闲时应走 runChat；入队仅在 agent 运行中有意义（interrupt / after_round）
    if (!this.isBusy()) {
      throw new Error("agent idle — use POST /api/chat to send directly");
    }
    const queueMode = AgentHub.mapSendMode(mode);
    const { id, decision } = MESSAGE_QUEUE.enqueue(this.sessionId, text, {
      mode: queueMode,
      source: "webui",
      metadata: { uiMode: mode },
    });
    return {
      ok: true,
      id,
      mode,
      queueMode,
      shouldAbort: decision.shouldAbort,
      shouldStopRun: decision.shouldStopRun,
      queue: this.listMessageQueue(),
    };
  }

  listMessageQueue(): Array<{
    id: number;
    message: string;
    mode: MessageQueueMode;
    enqueuedAt: number;
    source: string;
  }> {
    if (!this.sessionId) return [];
    return MESSAGE_QUEUE.list(this.sessionId).map((m: QueuedMessage) => ({
      id: m.id,
      message: m.message,
      mode: m.mode,
      enqueuedAt: m.enqueuedAt,
      source: m.source,
    }));
  }

  clearMessageQueue(): number {
    if (!this.sessionId) return 0;
    const n = MESSAGE_QUEUE.size(this.sessionId);
    MESSAGE_QUEUE.clear(this.sessionId);
    return n;
  }

  removeQueuedMessage(id: number): boolean {
    if (!this.sessionId) return false;
    return MESSAGE_QUEUE.remove(this.sessionId, id);
  }
}
