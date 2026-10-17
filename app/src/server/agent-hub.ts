/**
 * AgentHub —— Web 侧会话 / 模型 / 审批 / 流式 run（复用 coding-agent）。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { addProject, formatSenderEnvelope, getProjectsList, notePerfMark, runtimePresetRoute } from "@little-house-studio/types";
import {
  createStandardAgentDeps,
  getRolePresetFromMaouConfig,
  resolvePresetForCli,
  listProvidersForCli,
  listModelsForCli,
  AgentRegistry,
  patchAgentCustomConfig,
  readAgentWorkspaceInstructions,
  resolveAgentConfig,
  MESSAGE_QUEUE,
  normalizeSendTurn,
  sendDelivery,
  resolveWebhookTarget,
  resolveWorkspaceForSwitch,
  WebhookResolveError,
  type MessageQueueMode,
  type QueuedMessage,
  type WebhookHost,
  type WebhookAgentInfo,
  type WebhookChatLine,
  type WebhookQueuedItem,
  type WebhookSendResult,
  type WebhookSessionInfo,
  type WebhookStatusInfo,
  type WebhookTarget,
  jobLamp,
} from "@little-house-studio/agent";
import type {
  Message,
  StreamEvent,
  WebhookAgentMessage,
  WebhookSendMode,
} from "@little-house-studio/types";
import { stripTaskCompletionMarkup } from "@little-house-studio/types";
import { createCodingAgent } from "@little-house-studio/coding-agent";
import {
  type SessionStore,
  exportSessionZip,
  preflightSessionExport,
  sessionZipFilename,
  resolveWorkspaceInstructionsEnabled,
  type ExportPreflight,
} from "@little-house-studio/context";
import {
  setTerminalPolicyRoot,
  setTerminalApprover,
  getTerminalMode,
  setTerminalMode,
  type TerminalMode,
  type TerminalApprover,
  bindAskUserHost,
  resolvePermissionPreset,
  isPermissionPresetId,
  listPermissionPresets,
  DEFAULT_PERMISSION_PRESET,
  type AskUserRequest,
  type AskUserResult,
  formatProjectDispatchResult,
} from "@little-house-studio/tools";
import { normalizeCacheUsage } from "@little-house-studio/llm";
import { ConfigStore } from "@little-house-studio/types";
import { sessionPlan, sessionPlanFile, sessionGoals } from "@little-house-studio/context";
import {
  buildCommandCatalog,
  scanSkillCommandNames,
  type CommandCatalogItem,
} from "./command-catalog.js";
import { sanitizeChatImages } from "./chat-images.js";
import {
  collectSessionStats,
  formatSessionAnalyze,
  formatSessionStats,
  latestSessionId,
  type SessionStats,
} from "./session-stats.js";
import {
  collectTodayTokenTotals,
  type TodayTokenTotals,
} from "./today-tokens.js";
import {
  listLiveAgents,
  parseAgentSwitchId,
  resolveDefaultSwitchId,
  type LiveAgentDto,
} from "./agent-list.js";
import {
  inspectAgentFromDisk,
  resolveInspectTarget,
  type AgentInspectSnapshot,
} from "./agent-inspect.js";
import { listAgentTerminals, rebindAgentTerminalPersist } from "./agent-terminals.js";
import {
  ActivityAgentStore,
  type ActivityAgentDto,
} from "./activity-agents.js";
import {
  mergeChildSessions,
  projectSessionsDir,
  runningHelperCount,
  scanSessionsDir,
  sessionExistsOnDisk,
  type ScannedSession,
} from "./project-child-sessions.js";
import {
  backfillUserLoopDuration,
  collectToolCallArgs,
  collectToolCallIntents,
  readHistoryToolMeta,
  readLoopDurationMs,
  readRoleDurationMs,
  slimAssistantToolCalls,
} from "./tool-history.js";
export { resolveWorkspaceForSwitch } from "@little-house-studio/agent";

export type ProjectDispatchRequest = {
  projectPath: string;
  projectName: string;
  task: string;
  parentSessionId: string;
  parentAgent?: string;
};

export type ProjectDispatchReceipt = {
  sessionId: string;
  agent: string;
  switchId: string;
  project: string;
  status: "running";
  taskId: string;
};

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
    const header = join(projectRoot, ".maou", "sessions", id, "session.json");
    if (existsSync(header)) return id;
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
  /**
   * 开机就停在这个 Agent（如 `system:ops`），按 switchId 解析、不预建 runtime。
   * 桌面客户端聊天模式开机总会切到 ops —— 直接从那儿开始，免得先建一个用不上的 coding。
   */
  initialSwitchId?: string;
}

export type SessionLamp =
  | "running"
  | "helpers"
  | "await_approval"
  | "plan_review"
  | "await_ask"
  | "done"
  | "idle";

export type SessionSummary = {
  id: string;
  title: string;
  updatedAt?: string;
  messageCount: number;
  /** 用户发出条数，列表展示用 */
  userTurns: number;
  lastMsgAt?: string;
  parentSessionId?: string;
  lamp?: SessionLamp;
  helperCount?: number;
  switchId?: string;
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
  /** tool_call 参数 description */
  toolDescription?: string;
  /** tool_call 参数 JSON */
  toolArgs?: string;
  durationMs?: number;
  loopDurationMs?: number;
  toolCalls?: Array<{ id: string; description: string }>;
  images?: Message["images"];
  artifacts?: Array<{ path: string; delta: string }>;
  source?: string;
  kind?: string;
  authorType?: string;
  usageInput?: number;
  usageOutput?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cacheReported?: boolean;
};

function isToolLoopHistoryMessage(m: Record<string, unknown>): boolean {
  const source = String(m.source ?? "").trim();
  if (source === "tool_loop" || source === "tool_streak") return true;
  const role = String(m.role ?? "");
  if (role === "assistant" || role === "tool") return false;
  const text = typeof m.content === "string" ? m.content : "";
  return (
    /工具循环警告|检测到工具调用(?:可能陷入)?死循环|dominant\s*≈|同一工具连续\s*\d+|同一调用第\s*\d+/.test(
      text,
    ) ||
    (/请换策略/.test(text) && /<continue>|死循环|重复模式|换工具/.test(text))
  );
}

export type WebhookDeliverOk = {
  ok: true;
  agent: string;
  switchId: string;
  sessionId: string;
  status: "started" | "queued";
  queueId?: number;
};

export type WebhookDeliverErr = {
  ok: false;
  error: string;
  status: number;
  candidates?: WebhookTarget[];
};

export type WebhookDeliverResult = WebhookDeliverOk | WebhookDeliverErr;

export type PendingApproval = {
  id: string;
  command: string;
  agentName: string;
  sessionId?: string;
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

function remainingSessionId(
  store: { list: () => { id: string }[] } | null | undefined,
): string | null {
  return store?.list()[0]?.id ?? null;
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

export class AgentHub implements WebhookHost {
  /**
   * 测试用：占住 runs / 入队，但不拉 Runtime（避免打到真 LLM）。
   * HTTP webhook 不要开。
   */
  static skipWebhookRun = false;
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
  private pendingAsks = new Map<string, {
    payload: AskUserRequest;
    resolve: (r: AskUserResult) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private approverInstalled = false;
  private restoredSession = false;
  private readonly activity = new ActivityAgentStore();

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
    const initial = opts.initialSwitchId?.trim();
    if (initial) {
      const target = this.resolveSwitchTarget(initial);
      this._agentName = target.agentName;
      this._activeSwitchId = target.switchId;
      this._activeProjectPath = target.projectPath;
      this._projectRoot = target.projectRoot;
    }
    // 初始槽位
    this.syncActiveIntoSlots();
  }

  /** 名字或 switchId → 目标 Agent 的身份与工作区（不动当前状态）。 */
  private resolveSwitchTarget(raw: string): {
    agentName: string;
    switchId: string;
    projectPath: string | null;
    projectRoot: string;
  } {
    let agentName = raw;
    let projectPath: string | null = null;
    let switchId = `system:${raw}`;
    let kind: "system" | "project" = "system";

    const parsed = parseAgentSwitchId(raw);
    if (parsed) {
      agentName = parsed.agentName;
      if (parsed.kind === "project" && parsed.projectPath) {
        kind = "project";
        projectPath = parsed.projectPath;
        switchId = `project:${parsed.projectPath}:${parsed.agentName}`;
      } else {
        switchId = `system:${parsed.agentName}`;
      }
    }

    const projectRoot = resolveWorkspaceForSwitch({
      maouRoot: this.maouRoot,
      bootProjectRoot: this.bootProjectRoot,
      kind,
      agentName,
      projectPath,
    });
    return { agentName, switchId, projectPath, projectRoot };
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
    rebindAgentTerminalPersist(this._projectRoot);
  }

  /** Effective workspace (sessions + agent run). */
  get projectRoot(): string {
    return this._projectRoot;
  }

  openProjectRoot(folder: string): { projectRoot: string } {
    const next = resolve(folder);
    if (!existsSync(next) || !statSync(next).isDirectory()) {
      throw new Error("不是文件夹");
    }
    try {
      addProject(basename(next), next);
    } catch {
      /* 名册失败不挡打开 */
    }
    this.setActiveAgent(`project:${next}:${this._agentName || "coding"}`);
    return { projectRoot: this._projectRoot };
  }

  browseFolders(dir?: string): {
    path: string;
    parent: string | null;
    entries: Array<{ name: string; path: string; dir: boolean }>;
  } {
    const home = homedir();
    const raw = dir?.trim() ? resolve(dir) : home;
    if (!existsSync(raw) || !statSync(raw).isDirectory()) {
      throw new Error("打不开这层");
    }
    const entries = readdirSync(raw, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => ({ name: e.name, path: join(raw, e.name), dir: true }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const parent = raw === home ? null : dirname(raw);
    return { path: raw, parent, entries };
  }

  mkdirInBrowse(dir: string, name: string): { path: string } {
    const parent = resolve(dir);
    const folder = name.replace(/[\\/]/g, "").trim();
    if (!folder) throw new Error("名字空");
    const dest = join(parent, folder);
    mkdirSync(dest, { recursive: true });
    return { path: dest };
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

    const target = this.resolveSwitchTarget(raw);
    const nextName = target.agentName;
    const nextProjectPath = target.projectPath;
    const nextSwitchId = target.switchId;
    const nextRoot = target.projectRoot;

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
    rebindAgentTerminalPersist(nextRoot);
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

  /** CLI 对齐：last-session.json → 否则 mtime 最新 session.json */
  private restoreLastSessionIfNeeded() {
    if (this.restoredSession || this.sessionId) {
      this.restoredSession = true;
      return;
    }
    this.restoredSession = true;
    const fromPtr = readLastSessionPointer(this.projectRoot);
    if (fromPtr && this.sessionStore?.exists(fromPtr)) {
      this.sessionStore.recoverCold(fromPtr);
      this.sessionId = fromPtr;
      return;
    }
    const latest = latestSessionId(this.projectRoot);
    if (latest && this.sessionStore?.exists(latest)) {
      this.sessionStore.recoverCold(latest);
      this.sessionId = latest;
      writeLastSessionPointer(this.projectRoot, latest, this.agentName);
    }
  }

  private ensureAgent() {
    if (this.handle && this.sessionStore) {
      this.restoreLastSessionIfNeeded();
      return this.handle;
    }
    const built = this.buildHandle(this._agentName, this.projectRoot);
    this.sessionStore = built.sessionStore;
    this.handle = built.handle;
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
        | { name?: string; model?: string; _providerName?: string }
        | undefined;
      const route = main ? runtimePresetRoute(main) : undefined;
      if (route?.provider && route.model) {
        this.provider = route.provider;
        this.model = route.model;
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
          sessionId: this.sessionId ?? undefined,
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
    bindAskUserHost({
      request: (payload) =>
        new Promise<AskUserResult>((resolve, reject) => {
          const prev = this.pendingAsks.get(payload.sessionId);
          if (prev) {
            clearTimeout(prev.timer);
            prev.reject(new Error("replaced"));
          }
          const timer = setTimeout(() => {
            this.pendingAsks.delete(payload.sessionId);
            reject(new Error("ask_user timeout"));
          }, 10 * 60 * 1000);
          this.pendingAsks.set(payload.sessionId, { payload, resolve, reject, timer });
        }),
    });
  }

  getMeta() {
    this.ensureAgent();
    const meta = this.sessionId ? this.sessionStore?.readMeta(this.sessionId) : null;
    const pin = typeof meta?.permission_preset === "string" ? meta.permission_preset : undefined;
    const sendMode = meta?.send_mode === "insert" ? "insert" : meta?.send_mode === "queue" ? "queue" : undefined;
    const preset = resolvePermissionPreset(pin);
    return {
      sessionId: this.sessionId,
      provider: this.provider,
      model: this.model,
      projectRoot: this.projectRoot,
      sandboxMode: this.sandboxMode,
      approvalMode: this.sandboxMode,
      permissionPreset: preset.id,
      permissionPresetLabel: preset.label,
      sendMode,
      agentName: this.agentName,
      providers: listProvidersForCli(),
      models: this.provider ? listModelsForCli(this.provider) : [],
      jobLamp: this.sessionId ? jobLamp(this.sessionId) : undefined,
      descendants: this.sessionId ? this.sessionStore?.listDescendents(this.sessionId) ?? [] : [],
      parentSessionId: typeof meta?.parent_session_id === "string" ? meta.parent_session_id : undefined,
      oneshot: meta?.oneshot === true || meta?.agent_name === "helper",
      plan: this.sessionId ? sessionPlan.get(this.sessionStore!.sessionDir, this.sessionId) : undefined,
      goal: this.sessionId ? sessionGoals.get(this.sessionStore!.sessionDir, this.sessionId) : undefined,
      workspaceInstructions: this.readWorkspaceInstructionsEnabled(),
    };
  }

  /** 只读：previewAgentSystemPrompt + resolveAgentConfig。不切槽。 */
  inspectAgent(switchId?: string): AgentInspectSnapshot {
    const target = resolveInspectTarget(
      {
        agentName: this.agentName,
        projectRoot: this.projectRoot,
        switchId: this.activeSwitchId,
      },
      {
        maouRoot: this.maouRoot,
        bootProjectRoot: this.bootProjectRoot,
        switchId,
      },
    );
    return inspectAgentFromDisk({
      maouRoot: this.maouRoot,
      agentName: target.agentName,
      projectRoot: target.projectRoot,
      switchId: target.switchId,
    });
  }

  private currentAgentDir(): string {
    const registry = new AgentRegistry(this.maouRoot, this.projectRoot);
    const existing = registry.resolveAgentDir(this.agentName);
    if (existsSync(existing)) return existing;
    if (this.projectRoot) {
      return join(this.projectRoot, ".maou", "agents", this.agentName);
    }
    return existing;
  }

  readWorkspaceInstructionsEnabled(): boolean {
    try {
      const config = resolveAgentConfig(this.currentAgentDir());
      return resolveWorkspaceInstructionsEnabled({
        agent: readAgentWorkspaceInstructions(config),
      });
    } catch {
      return true;
    }
  }

  setWorkspaceInstructions(enabled: boolean): boolean {
    patchAgentCustomConfig(this.currentAgentDir(), { workspace_instructions: enabled });
    return enabled;
  }

  listModels(provider?: string) {
    const p = provider || this.provider;
    return listModelsForCli(p);
  }

  listProviders() {
    return listProvidersForCli();
  }

  setModel(provider: string, model: string): { provider: string; model: string } {
    this.provider = provider;
    this.model = model;
    return { provider: this.provider, model: this.model };
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

  setDefaultPermissionPreset(id: string, confirm?: string): { id: string; label: string } {
    if (!isPermissionPresetId(id)) throw new Error("unknown permission preset");
    const preset = resolvePermissionPreset(id);
    if (preset.confirmRisk && confirm !== preset.confirmRisk) {
      throw new Error(`open+yolo requires confirm: ${preset.confirmRisk}`);
    }
    const store = new ConfigStore(this.projectRoot, this.maouRoot);
    const raw = store.getUserRaw();
    const security = (raw.security && typeof raw.security === "object" ? raw.security : {}) as Record<string, unknown>;
    store.saveUserConfig({ ...raw, security: { ...security, permissionPreset: preset.id } });
    return { id: preset.id, label: preset.label };
  }

  setSessionPermissionPreset(id: string, confirm?: string): { id: string; label: string } {
    if (!isPermissionPresetId(id)) throw new Error("unknown permission preset");
    const preset = resolvePermissionPreset(id);
    if (preset.confirmRisk && confirm !== preset.confirmRisk) {
      throw new Error(`open+yolo requires confirm: ${preset.confirmRisk}`);
    }
    this.ensureAgent();
    if (!this.sessionId) throw new Error("no session");
    this.sessionStore!.setPermissionPreset(this.sessionId, preset.id);
    this.setApprovalMode(preset.approval);
    return { id: preset.id, label: preset.label };
  }

  setSessionSendMode(mode: "queue" | "insert"): "queue" | "insert" {
    this.ensureAgent();
    if (!this.sessionId) throw new Error("no session");
    this.sessionStore!.setSendMode(this.sessionId, mode);
    return mode;
  }

  listPendingAsks(): AskUserRequest[] {
    return [...this.pendingAsks.values()].map((e) => e.payload);
  }

  answerAsk(sessionId: string, result: AskUserResult): boolean {
    const pending = this.pendingAsks.get(sessionId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pendingAsks.delete(sessionId);
    pending.resolve(result);
    return true;
  }

  forkFromMessage(sessionId: string, entryId: string, title?: string): { sessionId: string } {
    this.ensureAgent();
    const child = this.sessionStore!.forkFromEntry(sessionId, entryId, { title });
    this.rememberSession(child.id);
    return { sessionId: child.id };
  }

  setMessageFeedback(
    sessionId: string,
    messageId: string,
    vote: "up" | "down",
    note?: string,
  ): { conflict: boolean } {
    this.ensureAgent();
    const text = (note ?? "").trim().slice(0, 500);
    return this.sessionStore!.noteFeedback(sessionId, messageId, vote, {
      note: text,
    });
  }

  readSessionPlan(): {
    plan?: ReturnType<typeof sessionPlan.get>;
    markdown: string;
    planFile?: string;
  } {
    this.ensureAgent();
    if (!this.sessionId || !this.sessionStore) return { markdown: "" };
    const dir = this.sessionStore.sessionDir;
    const id = this.sessionId;
    return {
      plan: sessionPlan.get(dir, id),
      markdown: sessionPlan.readPlan(dir, id) ?? "",
      planFile: sessionPlanFile(dir, id),
    };
  }

  togglePlanActive(): unknown {
    this.ensureAgent();
    if (!this.sessionId) throw new Error("no session");
    const dir = this.sessionStore!.sessionDir;
    const current = sessionPlan.get(dir, this.sessionId);
    if (current?.active) return sessionPlan.off(dir, this.sessionId);
    return sessionPlan.enter(dir, this.sessionId);
  }

  mutateGoal(action: "pause" | "resume" | "clear" | "edit", objective?: string): unknown {
    this.ensureAgent();
    if (!this.sessionId) throw new Error("no session");
    const dir = this.sessionStore!.sessionDir;
    const current = sessionGoals.get(dir, this.sessionId);
    if (!current && action !== "edit") return null;
    if (action === "clear" && current) return sessionGoals.clear(dir, this.sessionId, current);
    if (action === "pause" && current) return sessionGoals.pause(dir, this.sessionId, current);
    if (action === "resume" && current) return sessionGoals.resume(dir, this.sessionId, current);
    if (action === "edit" && current && objective) return sessionGoals.edit(dir, this.sessionId, current, { objective });
    return current;
  }

  searchSessions(opts: {
    query: string;
    limit?: number;
    cursor?: string;
    sessionId?: string;
  }): {
    items: Array<{
      sessionId: string;
      seq: number;
      absSeq: number;
      type: string;
      messageId?: string;
      snippet: string;
      rank: number;
    }>;
    nextCursor?: string;
  } {
    this.ensureAgent();
    return this.sessionStore!.search(opts);
  }

  listSessions(agent?: string): SessionSummary[] {
    const t0 = performance.now();
    try {
      return this.listSessionsInner(agent);
    } finally {
      notePerfMark("hub.listSessions", performance.now() - t0);
    }
  }

  private listSessionsInner(agent?: string): SessionSummary[] {
    this.ensureAgent();
    this.syncActiveIntoSlots();
    const slot = agent ? this.slotFor(agent) : this.slots.get(this._activeSwitchId);
    const store = slot?.sessionStore ?? this.sessionStore;
    if (!store) return [];
    const homeSwitchId = slot?.switchId ?? this._activeSwitchId;
    try {
      const running = this.collectRunningIds();
      const approvalSessions = new Set(
        this.listPendingApprovals().map((p) => p.sessionId).filter(Boolean) as string[],
      );
      const askBySession = new Map(this.listPendingAsks().map((a) => [a.sessionId, a.kind] as const));
      const home: ScannedSession[] = store.list().map((s) => ({
        id: s.id,
        title: s.title || "新对话",
        updatedAt: s.updatedAt,
        messageCount: s.messageCount ?? 0,
        userTurns: s.userTurns ?? 0,
        lastMsgAt: s.lastMsgAt,
        ...(s.parentSessionId ? { parentSessionId: s.parentSessionId } : {}),
        switchId: homeSwitchId,
      }));
      const merged = mergeChildSessions(home, this.collectForeignSessions(store.sessionDir));
      return merged.map((s) => {
        const helperCount = runningHelperCount(merged, s.id, running);
        let lamp: SessionLamp = "idle";
        if (approvalSessions.has(s.id) || (approvalSessions.size > 0 && running.has(s.id))) {
          lamp = "await_approval";
        } else if (askBySession.get(s.id) === "plan_review") {
          lamp = "plan_review";
        } else if (askBySession.get(s.id) === "questions") {
          lamp = "await_ask";
        } else if (running.has(s.id)) {
          lamp = "running";
        } else if (helperCount > 0) {
          lamp = "helpers";
        } else if ((s.messageCount ?? 0) > 0) {
          lamp = "done";
        }
        return {
          id: s.id,
          title: s.title || "新对话",
          updatedAt: s.updatedAt,
          messageCount: s.messageCount ?? 0,
          userTurns: s.userTurns ?? 0,
          lastMsgAt: s.lastMsgAt,
          lamp,
          ...(helperCount ? { helperCount } : {}),
          ...(s.parentSessionId ? { parentSessionId: s.parentSessionId } : {}),
          ...(s.switchId ? { switchId: s.switchId } : {}),
        };
      });
    } catch {
      return [];
    }
  }

  /** 清空 = 删除整卷，再开一个新会话 */
  clearSessionMessages(sessionId?: string | null): { sessionId: string } {
    this.ensureAgent();
    const id = sessionId || this.sessionId;
    if (!id) throw new Error("no active session");
    this.abortRun(id);
    this.sessionStore!.deleteSession(id);
    if (this.sessionId === id) this.sessionId = null;
    void this.handle?.runtime.atCacheRebuildPoint({
      reason: "session_clear",
      sessionId: id,
      agentName: this.handle.agentName,
    });
    return this.newSession();
  }

  previewDelete(sessionId: string): {
    sessionId: string;
    dependents: { id: string; title: string }[];
    warning?: string;
  } {
    this.ensureAgent();
    const preview = this.sessionStore!.previewDelete(sessionId);
    return {
      sessionId: preview.sessionId,
      dependents: preview.dependents.map((d) => ({ id: d.id, title: d.title })),
      warning: preview.warning,
    };
  }

  /** 导出当前会话纯文本 transcript（全卷 fold，不截尾页） */
  exportTranscript(sessionId?: string | null): string {
    this.ensureAgent();
    const id = sessionId || this.sessionId;
    if (!id || !this.sessionStore) return "(empty session)\n";
    this.sessionStore.flush(id);
    const folded = this.sessionStore.foldBranch(id);
    const msgs = folded?.messages ?? [];
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

  preflightExport(sessionId?: string | null): ExportPreflight {
    this.ensureAgent();
    const id = sessionId || this.sessionId;
    if (!id || !this.sessionStore) {
      return { sessionId: id ?? "", ok: false, error: "no session", files: 0, dependents: [] };
    }
    return preflightSessionExport(this.sessionStore, id);
  }

  exportSessionZip(sessionId?: string | null): Buffer {
    this.ensureAgent();
    const id = sessionId || this.sessionId;
    if (!id || !this.sessionStore) throw new Error("no session");
    return exportSessionZip(this.sessionStore, id);
  }

  sessionExportFilename(sessionId?: string | null): string {
    const id = sessionId || this.sessionId || "session";
    return sessionZipFilename(id);
  }

  loadSessionPage(
    sessionId?: string | null,
    opts?: { limit?: number; beforeSeq?: number },
  ): { messages: ChatHistoryLine[]; oldestSeq: number | null; hasMore: boolean } {
    const t0 = performance.now();
    try {
      this.ensureAgent();
      const id = sessionId || this.sessionId;
      if (!id) return { messages: [], oldestSeq: null, hasMore: false };
      const page = this.sessionStore!.loadRecent(id, {
        limit: opts?.limit ?? 80,
        beforeSeq: opts?.beforeSeq,
      });
      return {
        messages: this.linesFromMessages(id, (page?.messages ?? []) as Array<Record<string, unknown>>),
        oldestSeq: page?.oldestSeq ?? null,
        hasMore: page?.hasMore ?? false,
      };
    } finally {
      notePerfMark("hub.loadSessionPage", performance.now() - t0);
    }
  }

  /** 加载会话消息供 WebUI 渲染历史 */
  loadSessionMessages(sessionId?: string | null): ChatHistoryLine[] {
    this.ensureAgent();
    const id = sessionId || this.sessionId;
    if (!id) return [];
    return this.loadSessionPage(id).messages;
  }

  private linesFromMessages(
    id: string,
    msgs: Array<Record<string, unknown>>,
  ): ChatHistoryLine[] {
    const callIntents = collectToolCallIntents(msgs);
    const callArgs = collectToolCallArgs(msgs);
    const mapped = msgs.filter((m) => !isToolLoopHistoryMessage(m)).map((m, i) => {
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
      const images = Array.isArray(m.images)
        ? (m.images as Message["images"])
        : undefined;
      const source = typeof m.source === "string" ? m.source : undefined;
      const kind = typeof m.kind === "string" ? m.kind : undefined;
      const authorRaw = m.author;
      const authorType =
        authorRaw &&
        typeof authorRaw === "object" &&
        typeof (authorRaw as { type?: unknown }).type === "string"
          ? String((authorRaw as { type: string }).type)
          : undefined;
      const role = String(m.role ?? "assistant");
      const usage = m.usage as Record<string, unknown> | undefined;
      const cache = normalizeCacheUsage(usage);
      const usageInput =
        cache.promptTotal > 0
          ? cache.promptTotal
          : Number(usage?.prompt_tokens ?? usage?.input_tokens ?? usage?.input ?? 0);
      const usageOutput =
        cache.output > 0
          ? cache.output
          : Number(
              usage?.completion_tokens ?? usage?.output_tokens ?? usage?.output ?? 0,
            );
      const toolMeta =
        role === "tool" ? readHistoryToolMeta(m, callIntents, callArgs) : {};
      const toolCalls =
        role === "assistant" ? slimAssistantToolCalls(m) : [];
      const durationMs =
        role === "tool" ? toolMeta.durationMs : readRoleDurationMs(m);
      const loopDurationMs = readLoopDurationMs(m);
      return {
        id: String(m.id ?? `${id}-${i}`),
        role,
        content: role === "assistant" ? stripTaskCompletionMarkup(content) : content,
        ts: String(m.createdAt ?? m.created_at ?? ""),
        ...(toolName ? { toolName } : {}),
        ...(toolCallId ? { toolCallId } : {}),
        ...(toolOk !== undefined ? { toolOk } : {}),
        ...(toolMeta.toolDescription
          ? { toolDescription: toolMeta.toolDescription }
          : {}),
        ...(toolMeta.toolArgs ? { toolArgs: toolMeta.toolArgs } : {}),
        ...(durationMs != null ? { durationMs } : {}),
        ...(loopDurationMs != null ? { loopDurationMs } : {}),
        ...(toolCalls.length ? { toolCalls } : {}),
        ...(images?.length ? { images } : {}),
        ...(Array.isArray(m.artifacts) ? { artifacts: m.artifacts as ChatHistoryLine["artifacts"] } : {}),
        ...(source ? { source } : {}),
        ...(kind ? { kind } : {}),
        ...(authorType ? { authorType } : {}),
        ...(Number.isFinite(usageInput) && usageInput > 0 ? { usageInput } : {}),
        ...(Number.isFinite(usageOutput) && usageOutput > 0 ? { usageOutput } : {}),
        ...(cache.reported
          ? {
              cacheReported: true,
              cacheRead: cache.cacheRead,
              cacheWrite: cache.cacheWrite,
            }
          : {}),
        ...(typeof m.seq === "number" ? { seq: m.seq } : {}),
      };
    });
    return backfillUserLoopDuration(mapped);
  }

  listPendingApprovals(): PendingApproval[] {
    return [...this.pendingApprovals.values()].map((p) => p.info);
  }

  answerApproval(
    id: string,
    choice: string,
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
  abortRun(sessionId?: string | null, keepQueue = false) {
    const id = (sessionId ?? this.sessionId)?.trim() || null;
    if (!id) return;
    const ac = this.runs.get(id);
    if (ac) {
      try {
        ac.abort();
      } catch {
        /* ignore */
      }
      // Keep the run lock for queue-preserving stops until the generator exits.
      if (!keepQueue) this.runs.delete(id);
    }
    try {
      if (!keepQueue) MESSAGE_QUEUE.clear(id);
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

  /** 当前店列表里应亮灯的会话（含后台项目孩子） */
  listSessionRailRunningIds(): string[] {
    const visible = new Set(this.listSessions().map((s) => s.id));
    const out = new Set<string>(this.listRunningSessions());
    for (const id of this.collectRunningIds()) {
      if (visible.has(id)) out.add(id);
    }
    return [...out];
  }

  private collectRunningIds(): Set<string> {
    this.syncActiveIntoSlots();
    const ids = new Set<string>();
    for (const slot of this.slots.values()) {
      for (const id of slot.runs.keys()) ids.add(id);
    }
    for (const rec of this.activity.list()) {
      if (rec.status === "running") ids.add(rec.sessionId);
    }
    return ids;
  }

  private collectForeignSessions(homeDir: string): ScannedSession[] {
    this.syncActiveIntoSlots();
    const extras: ScannedSession[] = [];
    for (const slot of this.slots.values()) {
      if (!slot.sessionStore || slot.sessionStore.sessionDir === homeDir) continue;
      for (const s of slot.sessionStore.list()) {
        extras.push({
          id: s.id,
          title: s.title || "新对话",
          updatedAt: s.updatedAt,
          messageCount: s.messageCount ?? 0,
          userTurns: s.userTurns ?? 0,
          lastMsgAt: s.lastMsgAt,
          ...(s.parentSessionId ? { parentSessionId: s.parentSessionId } : {}),
          switchId: slot.switchId,
        });
      }
    }
    for (const project of getProjectsList(this.maouRoot)) {
      const dir = projectSessionsDir(project.path);
      if (dir === homeDir) continue;
      extras.push(...scanSessionsDir(dir, `project:${project.path}:coding`));
    }
    for (const rec of this.activity.list()) {
      extras.push({
        id: rec.sessionId,
        title: rec.projectName ? `${rec.displayName} · ${rec.projectName}` : rec.displayName,
        messageCount: 0,
        userTurns: 0,
        lastMsgAt: new Date(rec.startedAt).toISOString(),
        updatedAt: new Date(rec.startedAt).toISOString(),
        parentSessionId: rec.parentSessionId,
        switchId: rec.switchId,
      });
    }
    return extras;
  }

  private findSessionHome(sessionId: string): { switchId: string; sessionId: string } | null {
    const id = sessionId.trim();
    if (!id) return null;
    this.syncActiveIntoSlots();
    if (this.sessionStore?.exists(id)) {
      return { switchId: this._activeSwitchId, sessionId: id };
    }
    for (const slot of this.slots.values()) {
      if (slot.sessionStore?.exists(id)) {
        return { switchId: slot.switchId, sessionId: id };
      }
    }
    const rec = this.activity.findBySession(id);
    if (rec) return { switchId: rec.switchId, sessionId: id };
    for (const project of getProjectsList(this.maouRoot)) {
      if (sessionExistsOnDisk(projectSessionsDir(project.path), id)) {
        return { switchId: `project:${project.path}:coding`, sessionId: id };
      }
    }
    return null;
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

  listActivityAgents(): ActivityAgentDto[] {
    return this.activity.list();
  }

  async dispatchProjectTask(
    req: ProjectDispatchRequest,
  ): Promise<ProjectDispatchReceipt> {
    const switchId = `project:${req.projectPath}:coding`;
    const slot = this.slotFor(switchId);
    if (slot.sessionId && slot.runs.has(slot.sessionId)) {
      this.startSlotSession(slot, `ops → ${req.projectName}`);
    } else if (!slot.sessionId) {
      this.startSlotSession(slot, `ops → ${req.projectName}`);
    }
    const sessionId = slot.sessionId;
    if (!sessionId || !slot.handle) throw new Error("failed to open coding session");
    slot.sessionStore?.setParentSessionId(sessionId, req.parentSessionId);

    const rec = this.activity.upsert({
      id: `${switchId}::${sessionId}`,
      switchId,
      agent: "coding",
      displayName: "Coding",
      sessionId,
      projectPath: req.projectPath,
      projectName: req.projectName,
      parentSessionId: req.parentSessionId,
      status: "running",
      startedAt: Date.now(),
    });

    if (!slot.runs.has(sessionId)) {
      slot.runs.set(sessionId, new AbortController());
    }
    if (slot.switchId === this._activeSwitchId) this.syncActiveIntoSlots();

    if (!AgentHub.skipWebhookRun) {
      void this.runProjectDispatch(slot, rec.id, req.task);
    }

    return {
      sessionId,
      agent: "coding",
      switchId,
      project: req.projectPath,
      status: "running",
      taskId: rec.id,
    };
  }

  finishProjectDispatch(
    idOrSessionId: string,
    result: { ok: boolean; output?: string; error?: string },
  ): ActivityAgentDto | null {
    const rec = this.activity.complete(
      idOrSessionId,
      result.ok ? "done" : "failed",
      result.output || result.error,
    );
    if (!rec) return null;
    this.writeBackProjectDispatch(rec, result);
    return this.activity.get(rec.id)
      ? {
          id: rec.id,
          switchId: rec.switchId,
          agent: rec.agent,
          displayName: rec.displayName,
          sessionId: rec.sessionId,
          projectPath: rec.projectPath,
          projectName: rec.projectName,
          parentSessionId: rec.parentSessionId,
          status: rec.status,
          startedAt: rec.startedAt,
          endedAt: rec.endedAt,
        }
      : null;
  }

  private async runProjectDispatch(
    slot: AgentRuntimeSlot,
    activityId: string,
    task: string,
  ): Promise<void> {
    let output = "";
    let ok = true;
    try {
      for await (const ev of this.runChatOnSlot(slot, { content: task }, "project_send")) {
        if (ev.type === "assistant" || ev.type === "text" || ev.type === "content") {
          const bit = ev.delta ?? ev.content ?? ev.message;
          if (typeof bit === "string" && bit.trim()) output = bit;
        }
        if (ev.type === "round_limit") {
          ok = false;
          const bit = ev.message ?? ev.content;
          if (typeof bit === "string" && bit.trim()) output = bit;
        }
        if (ev.type === "error") ok = false;
      }
    } catch (error) {
      ok = false;
      output = error instanceof Error ? error.message : String(error);
    }
    this.finishProjectDispatch(activityId, { ok, output });
  }

  private writeBackProjectDispatch(
    rec: { parentSessionId: string; sessionId: string; projectName: string; projectPath: string; switchId: string },
    result: { ok: boolean; output?: string; error?: string },
  ): void {
    const parent = this.findSlotBySession(rec.parentSessionId);
    if (!parent?.sessionStore) return;
    parent.sessionId = rec.parentSessionId;
    const body = formatProjectDispatchResult({
      ok: result.ok,
      projectName: rec.projectName,
      projectPath: rec.projectPath,
      sessionId: rec.sessionId,
      output: result.output,
      error: result.error,
    });
    const content = formatSenderEnvelope({
      body,
      from: "coding",
      type: "report",
    });
    const turn = { content };
    if (parent.runs.has(rec.parentSessionId)) {
      MESSAGE_QUEUE.enqueue(rec.parentSessionId, content, {
        mode: "after_round_complete",
        source: "project_dispatch",
        sessionDir: parent.sessionStore.sessionDir,
        metadata: {
          fromSessionId: rec.sessionId,
          fromAgent: "coding",
          from: "coding",
        },
      });
      return;
    }
    parent.runs.set(rec.parentSessionId, new AbortController());
    if (parent.switchId === this._activeSwitchId) this.syncActiveIntoSlots();
    if (!AgentHub.skipWebhookRun) {
      this.drainGenerator(this.runChatOnSlot(parent, turn, "project_dispatch"));
    }
  }

  private findSlotBySession(sessionId: string): AgentRuntimeSlot | null {
    this.syncActiveIntoSlots();
    for (const slot of this.slots.values()) {
      if (slot.sessionStore?.exists(sessionId)) return slot;
    }
    try {
      const ops = this.ensureSlot(this.resolveAgent("ops"));
      if (ops.sessionStore?.exists(sessionId)) return ops;
    } catch {
      /* ops 槽建不出来就放弃回写 */
    }
    return null;
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
    const stats = collectSessionStats(this.projectRoot, id);
    return this.applyRuntimeOccupancy(id, stats);
  }

  private applyRuntimeOccupancy(sessionId: string, stats: SessionStats): SessionStats {
    try {
      const snap = this.handle?.runtime.getContextSnapshotForSession?.(sessionId);
      if (!snap) return stats;
      return {
        ...stats,
        contextUsed: snap.used,
        lastInputTokens: snap.lastInput,
        lastOutputTokens: snap.lastOutput,
        lastCacheRead: snap.lastCacheRead ?? stats.lastCacheRead,
        lastCacheWrite: snap.lastCacheWrite ?? stats.lastCacheWrite,
        contextBreakdown: snap.breakdown ?? {
          ...stats.contextBreakdown,
          window: snap.max,
          used: snap.used,
          promptTotal: snap.lastInput,
          output: snap.lastOutput,
          free: Math.max(0, snap.max - snap.used),
          occupancyPct:
            snap.max > 0
              ? Math.min(100, Math.max(0, Math.round((snap.used / snap.max) * 100)))
              : 0,
        },
      };
    } catch {
      return stats;
    }
  }

  getSessionStatsText(sessionId?: string | null): string {
    const s = this.getSessionStats(sessionId);
    if (!s) return "Usage\n  暂无活动会话。";
    return formatSessionStats(s);
  }

  /** 本机日历日 in/out：TokenTracker 日桶加总 */
  getTodayTokenTotals(): TodayTokenTotals {
    return collectTodayTokenTotals(this.maouRoot);
  }

  /** 用量事件带上日桶快照，顶栏跟着这一轮写盘后的合计走。 */
  private stampTodayOnUsage(ev: StreamEvent): StreamEvent {
    const t = String((ev as { type?: string }).type ?? "");
    if (t !== "usage" && t !== "model.usage" && t !== "assistant.usage") {
      return ev;
    }
    return { ...ev, today: this.getTodayTokenTotals() } as StreamEvent;
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
  listCommandCatalog(): CommandCatalogItem[] {
    const handle = this.ensureAgent();
    const runtime = handle.runtime?.commandRegistry?.list() ?? [];
    const skills = scanSkillCommandNames({
      projectRoot: this.projectRoot,
      maouRoot: this.maouRoot,
      agentName: this.agentName,
    });
    return buildCommandCatalog(runtime, skills);
  }

  /**
   * 第一条 run 的 done 之后，把队列剩余项接着跑；事件仍走当前生成器。
   * 用户在最后一轮收尾后入队时，round_end / loop_end 已经查过空队列。
   */
  private async *flushQueuedTurns(
    sessionId: string,
    acBox: { current: AbortController },
    startRun: (userMessage: string, signal: AbortSignal) => AsyncGenerator<StreamEvent>,
  ): AsyncGenerator<StreamEvent> {
    for (;;) {
      if (acBox.current.signal.aborted) return;
      const next = MESSAGE_QUEUE.takeNext(sessionId);
      if (!next) return;
      if (acBox.current.signal.aborted) return;
      yield {
        type: "queued_user",
        id: next.id,
        requestId: next.metadata.requestId,
        content: next.message,
        mode: next.mode,
        source: next.source,
        phase: "run_end",
      } as StreamEvent;
      for await (const ev of startRun(next.message, acBox.current.signal)) {
        yield this.stampTodayOnUsage(ev);
        if (ev.type === "error") return;
        if (ev.type === "done") break;
      }
    }
  }

  async *runChat(
    message: string,
    opts?: { images?: Message["images"]; sessionId?: string; resumeQueue?: boolean },
  ): AsyncGenerator<StreamEvent> {
    this.assertQueueSession(opts?.sessionId);
    if (this.isBusy()) throw new Error("当前会话仍在运行，请排队发送或等待停止完成");
    const agent = this.ensureAgent();
    const images = sanitizeChatImages(opts?.images);
    const text = message.trim() || (images.length ? "(附图)" : "");
    if (!text && !opts?.resumeQueue) return;

    if (!this.sessionId) {
      this.rememberSession(agent.startSession());
    } else {
      this.rememberSession(this.sessionId);
    }
    const sessionId = this.sessionId!;

    // 捕获当前槽的 runs 引用：切 Agent 后 this.runs 会换 Map，finally 必须写回原 Map
    const runsMap = this.runs;
    const switchIdAtStart = this._activeSwitchId;
    // Single consumer per session; queue claims happen under this run lock.
    const acBox = { current: new AbortController() };
    runsMap.set(sessionId, acBox.current);
    this.syncActiveIntoSlots();

    const preset = resolvePresetForCli(this.provider, this.model) as Record<
      string,
      unknown
    >;

    try {
      let first = text;
      if (opts?.resumeQueue) {
        const next = MESSAGE_QUEUE.takeNext(sessionId);
        if (!next) return;
        first = next.message;
        yield { type: "queued_user", id: next.id, requestId: next.metadata.requestId, content: next.message, mode: next.mode, source: next.source, phase: "run_end" } as StreamEvent;
      }
      for await (const ev of agent.runtime.run({
        sessionId,
        userMessage: first,
        preset,
        stream: true,
        abortSignal: acBox.current.signal,
        source: "app",
        deferQueueOnExit: true,
        sandboxMode: this.sandboxMode,
        ...(images.length ? { images } : {}),
      })) {
        yield this.stampTodayOnUsage(ev);
        if (ev.type === "error") return;
        if (ev.type === "done") break;
      }
      yield* this.flushQueuedTurns(sessionId, acBox, (userMessage, signal) =>
        agent.runtime.run({
          sessionId,
          userMessage,
          preset,
          stream: true,
          abortSignal: signal,
          source: "app",
          deferQueueOnExit: true,
          sandboxMode: this.sandboxMode,
        }),
      );
    } finally {
      if (runsMap.get(sessionId) === acBox.current) {
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

  /** All UI mutations are scoped to the session visible when the request was made. */
  assertQueueSession(sessionId?: string): void {
    if (sessionId !== undefined && sessionId !== this.sessionId) {
      throw new Error("会话已切换，请刷新消息队列后重试");
    }
  }

  enqueueUserMessage(message: string, mode: "queue" | "insert" = "queue", opts: { sessionId?: string; requestId?: string } = {}) {
    this.assertQueueSession(opts.sessionId);
    this.ensureAgent();
    const text = message.trim();
    if (!text) throw new Error("message required");
    if (!this.sessionId) throw new Error("请先创建会话");
    const queueMode = AgentHub.mapSendMode(mode);
    const { id, decision } = MESSAGE_QUEUE.enqueue(this.sessionId, text, {
      mode: queueMode, source: "app", requestId: opts.requestId,
      metadata: { uiMode: mode }, sessionDir: this.sessionStore?.sessionDir,
    });
    return { ok: true as const, id, mode, queueMode, shouldAbort: decision.shouldAbort,
      shouldStopRun: decision.shouldStopRun, ...this.messageQueueSnapshot() };
  }

  listMessageQueue() {
    if (!this.sessionId) return [];
    return MESSAGE_QUEUE.list(this.sessionId).map((m: QueuedMessage) => ({
      id: m.id, message: m.message, mode: m.mode, enqueuedAt: m.enqueuedAt, source: m.source,
      requestId: typeof m.metadata.requestId === "string" ? m.metadata.requestId : undefined,
    }));
  }

  messageQueueSnapshot(sessionId?: string) {
    this.assertQueueSession(sessionId);
    return { sessionId: this.sessionId, busy: this.isBusy(), capacity: MESSAGE_QUEUE.capacity, queue: this.listMessageQueue() };
  }

  clearMessageQueue(sessionId?: string, ids?: number[]): number {
    this.assertQueueSession(sessionId);
    if (!this.sessionId) return 0;
    if (ids) return ids.reduce((n, id) => n + Number(MESSAGE_QUEUE.remove(this.sessionId!, id)), 0);
    const n = MESSAGE_QUEUE.size(this.sessionId);
    MESSAGE_QUEUE.clear(this.sessionId);
    return n;
  }

  removeQueuedMessage(id: number, sessionId?: string): boolean {
    this.assertQueueSession(sessionId);
    return this.sessionId ? MESSAGE_QUEUE.remove(this.sessionId, id) : false;
  }

  updateQueuedMessage(id: number, patch: { message?: string; mode?: "queue" | "insert"; move?: "up" | "down" }, sessionId?: string): boolean {
    this.assertQueueSession(sessionId);
    return this.sessionId ? MESSAGE_QUEUE.update(this.sessionId, id, {
      ...patch, mode: patch.mode ? AgentHub.mapSendMode(patch.mode) : undefined,
    }) : false;
  }

  resolveAgent(raw?: string | null): WebhookTarget {
    return resolveWebhookTarget({
      raw,
      agents: this.listAgents(),
      activeSwitchId: this._activeSwitchId,
      bootProjectRoot: this.bootProjectRoot,
      maouRoot: this.maouRoot,
    });
  }

  status(agent?: string, session?: string): WebhookStatusInfo {
    const slot = this.slotFor(agent, session);
    const sid = session?.trim() || slot.sessionId;
    return {
      agent: slot.agentName,
      switchId: slot.switchId,
      sessionId: sid,
      busy: sid ? slot.runs.has(sid) : slot.runs.size > 0,
      provider: this.provider,
      model: this.model,
      approvalMode: this.sandboxMode,
      projectRoot: slot.projectRoot,
    };
  }

  async send(opts: {
    agent?: string;
    session?: string;
    message: WebhookAgentMessage;
    mode?: WebhookSendMode;
    wait?: boolean;
    timeoutMs?: number;
  }): Promise<WebhookSendResult> {
    const n = normalizeSendTurn(opts.message, opts.mode);
    const slot = this.slotFor(opts.agent, opts.session);
    if (!slot.sessionId) this.startSlotSession(slot);
    const sid = slot.sessionId;
    if (!sid || !slot.handle) throw new Error("failed to open session");
    const busy = slot.runs.has(sid);
    const delivery = sendDelivery(n.mode, busy);

    if (delivery === "queue" || delivery === "insert") {
      const { id } = MESSAGE_QUEUE.enqueue(sid, n.sessionText, {
        mode:
          delivery === "insert"
            ? "interrupt_immediately"
            : "after_round_complete",
        source: "webhook",
        metadata: n.queueMeta,
      });
      return {
        status: "queued",
        sessionId: sid,
        switchId: slot.switchId,
        agent: slot.agentName,
        queueId: id,
      };
    }
    if (delivery === "stop_and_send") {
      slot.runs.get(sid)?.abort();
      slot.runs.delete(sid);
    }

    const ac = new AbortController();
    slot.runs.set(sid, ac);
    if (AgentHub.skipWebhookRun) {
      return {
        status: "started",
        sessionId: sid,
        switchId: slot.switchId,
        agent: slot.agentName,
      };
    }
    if (opts.wait) {
      if (opts.timeoutMs && opts.timeoutMs > 0) {
        setTimeout(() => ac.abort(), opts.timeoutMs);
      }
      const parts: string[] = [];
      for await (const ev of this.runChatOnSlot(slot, n.turn, "webhook")) {
        if (ev.type === "text" || ev.type === "assistant" || ev.type === "content") {
          const bit = ev.delta ?? ev.content ?? ev.message;
          if (typeof bit === "string" && bit) parts.push(bit);
        }
      }
      return {
        status: "started",
        sessionId: sid,
        switchId: slot.switchId,
        agent: slot.agentName,
        text: parts.join(""),
      };
    }
    this.drainGenerator(this.runChatOnSlot(slot, n.turn, "webhook"));
    return {
      status: "started",
      sessionId: sid,
      switchId: slot.switchId,
      agent: slot.agentName,
    };
  }

  abort(opts: { agent?: string; session?: string } = {}): {
    aborted: boolean;
    sessionId: string | null;
  } {
    const slot = this.slotFor(opts.agent, opts.session);
    const sid = (opts.session ?? slot.sessionId)?.trim() || null;
    if (!sid) return { aborted: false, sessionId: null };
    const ac = slot.runs.get(sid);
    if (ac) {
      try {
        ac.abort();
      } catch {
        /* ignore */
      }
      slot.runs.delete(sid);
    }
    try {
      MESSAGE_QUEUE.clear(sid);
    } catch {
      /* ignore */
    }
    if (slot.switchId === this._activeSwitchId) {
      this.syncActiveIntoSlots();
    }
    return { aborted: Boolean(ac), sessionId: sid };
  }

  enqueue(opts: {
    agent?: string;
    session?: string;
    message: WebhookAgentMessage;
    mode?: "queue" | "insert";
  }): { queueId: number; sessionId: string; switchId: string; agent: string } {
    const n = normalizeSendTurn(opts.message, opts.mode);
    const slot = this.slotFor(opts.agent, opts.session);
    if (!slot.sessionId) this.startSlotSession(slot);
    const sid = slot.sessionId!;
    if (!slot.runs.has(sid)) {
      throw new Error("agent idle — use action send");
    }
    const { id } = MESSAGE_QUEUE.enqueue(sid, n.sessionText, {
      mode:
        n.mode === "insert" || opts.mode === "insert"
          ? "interrupt_immediately"
          : "after_round_complete",
      source: "webhook",
      metadata: n.queueMeta,
    });
    return {
      queueId: id,
      sessionId: sid,
      switchId: slot.switchId,
      agent: slot.agentName,
    };
  }

  /** @deprecated 用 send / handleWebhook；测试仍走这条同步口 */
  deliverWebhook(opts: {
    agent?: string;
    message: WebhookAgentMessage;
    sessionId?: string;
  }): WebhookDeliverResult {
    let n;
    try {
      n = normalizeSendTurn(opts.message);
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "message required",
        status: 400,
      };
    }
    try {
      const slot = this.slotFor(opts.agent, opts.sessionId);
      if (!slot.sessionId) this.startSlotSession(slot);
      const sid = slot.sessionId;
      if (!sid) return { ok: false, error: "failed to open session", status: 500 };
      if (slot.runs.has(sid)) {
        const { id } = MESSAGE_QUEUE.enqueue(sid, n.sessionText, {
          mode: "after_round_complete",
          source: "webhook",
          metadata: n.queueMeta,
        });
        return {
          ok: true,
          agent: slot.agentName,
          switchId: slot.switchId,
          sessionId: sid,
          status: "queued",
          queueId: id,
        };
      }
      slot.runs.set(sid, new AbortController());
      if (!AgentHub.skipWebhookRun) {
        this.drainGenerator(this.runChatOnSlot(slot, n.turn, "webhook"));
      }
      return {
        ok: true,
        agent: slot.agentName,
        switchId: slot.switchId,
        sessionId: sid,
        status: "started",
      };
    } catch (e) {
      if (e instanceof WebhookResolveError) {
        return {
          ok: false,
          error: e.message,
          status: e.status,
          candidates: e.candidates,
        };
      }
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        status: 400,
      };
    }
  }

  newSession(opts?: { agent?: string; title?: string } | string): { sessionId: string } {
    const title = typeof opts === "string" ? opts : opts?.title;
    const agent = typeof opts === "string" ? undefined : opts?.agent;
    if (!agent) {
      this.ensureAgent();
      const id = this.handle!.startSession(title);
      this.rememberSession(id);
      return { sessionId: id };
    }
    const slot = this.slotFor(agent);
    this.startSlotSession(slot, title);
    return { sessionId: slot.sessionId! };
  }

  forkSession(parentId: string, title?: string): { sessionId: string } {
    this.ensureAgent();
    const parent = String(parentId || "").trim();
    if (!parent) throw new Error("parentSessionId required");
    if (!this.sessionStore!.load(parent)) {
      throw new Error(`session not found: ${parent}`);
    }
    const child = this.sessionStore!.forkSession(parent, title);
    this.rememberSession(child.id);
    return { sessionId: child.id };
  }

  newChildSession(parentId: string, title?: string): { sessionId: string } {
    this.ensureAgent();
    const parent = String(parentId || "").trim();
    if (!parent) throw new Error("parentSessionId required");
    const data = this.sessionStore!.load(parent);
    if (!data) throw new Error(`session not found: ${parent}`);
    const child = this.sessionStore!.create({
      title: title ?? "子会话",
      agentName: data.agentName ?? this.agentName,
      parentSessionId: parent,
    });
    this.rememberSession(child.id);
    return { sessionId: child.id };
  }

  switchSession(
    sessionIdOrOpts: string | { agent?: string; session: string },
  ): { sessionId: string } {
    if (typeof sessionIdOrOpts === "string") {
      this.ensureAgent();
      const id = String(sessionIdOrOpts || "").trim();
      if (!id) throw new Error("sessionId required");
      const home = this.findSessionHome(id);
      if (!home) throw new Error(`session not found: ${id}`);
      if (home.switchId !== this._activeSwitchId) {
        this.setActiveAgent(home.switchId);
      }
      if (!this.sessionStore?.exists(id)) throw new Error(`session not found: ${id}`);
      this.sessionStore.recoverCold(id);
      this.rememberSession(id);
      return { sessionId: id };
    }
    const slot = this.slotFor(sessionIdOrOpts.agent, sessionIdOrOpts.session);
    return { sessionId: slot.sessionId! };
  }

  clearSession(opts: { agent?: string; session?: string } = {}): { sessionId: string } {
    if (!opts.agent && !opts.session) {
      return this.clearSessionMessages();
    }
    const slot = this.slotFor(opts.agent, opts.session);
    const id = slot.sessionId;
    if (!id || !slot.sessionStore) throw new Error("no active session");
    this.abort({ agent: opts.agent, session: id });
    slot.sessionStore.deleteSession(id);
    void slot.handle?.runtime.atCacheRebuildPoint({
      reason: "session_clear",
      sessionId: id,
      agentName: slot.agentName,
    });
    if (slot.sessionId === id) slot.sessionId = null;
    return this.newSession({ agent: opts.agent });
  }

  deleteSession(
    sessionIdOrOpts: string | { agent?: string; session: string },
  ): { deleted: boolean; sessionId: string | null } {
    if (typeof sessionIdOrOpts === "string") {
      this.ensureAgent();
      const id = String(sessionIdOrOpts || "").trim();
      if (!id) throw new Error("sessionId required");
      this.abortRun(id);
      const wasActive = this.sessionId === id;
      const deleted = this.sessionStore!.delete(id);
      if (wasActive) {
        const next = remainingSessionId(this.sessionStore);
        if (next) this.rememberSession(next);
        else this.sessionId = null;
      }
      return { deleted, sessionId: this.sessionId };
    }
    const slot = this.slotFor(sessionIdOrOpts.agent);
    const id = sessionIdOrOpts.session.trim();
    this.abort({ agent: sessionIdOrOpts.agent, session: id });
    const wasActive = slot.sessionId === id;
    const deleted = slot.sessionStore?.delete(id) ?? false;
    if (wasActive) {
      const next = remainingSessionId(slot.sessionStore);
      slot.sessionId = next;
      if (slot.switchId === this._activeSwitchId) {
        if (next) this.rememberSession(next);
        else this.sessionId = null;
      }
    }
    return { deleted, sessionId: slot.sessionId };
  }

  renameSession(
    sessionIdOrOpts: string | { agent?: string; session: string; title: string },
    titleArg?: string,
  ): { sessionId: string; title: string } {
    if (typeof sessionIdOrOpts === "string") {
      this.ensureAgent();
      return this.renameOnStore(this.sessionStore!, sessionIdOrOpts, String(titleArg ?? ""));
    }
    const slot = this.slotFor(sessionIdOrOpts.agent, sessionIdOrOpts.session);
    if (!slot.sessionStore) throw new Error("session store missing");
    return this.renameOnStore(slot.sessionStore, sessionIdOrOpts.session, sessionIdOrOpts.title);
  }

  sessionMessages(opts: {
    agent?: string;
    session?: string;
  } = {}): { sessionId: string; messages: WebhookChatLine[] } {
    const mapLines = (lines: ChatHistoryLine[]): WebhookChatLine[] =>
      lines.map((m) => ({
        role:
          m.role === "user" ||
          m.role === "assistant" ||
          m.role === "system" ||
          m.role === "tool"
            ? m.role
            : "assistant",
        content: m.content,
        timestamp: m.ts || "",
        id: m.id,
        ...(m.toolName ? { toolName: m.toolName } : {}),
        ...(m.images?.length ? { images: m.images } : {}),
        ...(m.source ? { source: m.source } : {}),
      }));
    if (!opts.agent && !opts.session) {
      const id = this.sessionId || "";
      return { sessionId: id, messages: mapLines(this.loadSessionMessages(id)) };
    }
    const slot = this.slotFor(opts.agent, opts.session);
    const id = slot.sessionId || "";
    if (!id || !slot.sessionStore) return { sessionId: id, messages: [] };
    const prevStore = this.sessionStore;
    const prevRoot = this._projectRoot;
    this.sessionStore = slot.sessionStore;
    this._projectRoot = slot.projectRoot;
    try {
      return { sessionId: id, messages: mapLines(this.loadSessionMessages(id)) };
    } finally {
      this.sessionStore = prevStore;
      this._projectRoot = prevRoot;
    }
  }

  sessionStats(opts: {
    agent?: string;
    session?: string;
  } = {}): { sessionId: string; stats: Record<string, unknown> } {
    const slot = opts.agent || opts.session ? this.slotFor(opts.agent, opts.session) : null;
    const id = slot?.sessionId || this.sessionId || "";
    const stats = slot
      ? this.applyRuntimeOccupancy(id, collectSessionStats(slot.projectRoot, id))
      : this.getSessionStats(id);
    return { sessionId: id, stats: (stats ?? {}) as Record<string, unknown> };
  }

  exportSession(opts: {
    agent?: string;
    session?: string;
  } = {}): { sessionId: string; text: string } {
    const { sessionId, messages } = this.sessionMessages(opts);
    if (messages.length === 0) {
      return { sessionId, text: "(empty session)\n" };
    }
    const text =
      messages
        .map((m) => `### ${(m.role || "assistant").toUpperCase()}\n${m.content || ""}\n`)
        .join("\n") + "\n";
    return { sessionId, text };
  }

  getModel(): { provider: string; model: string } {
    return { provider: this.provider, model: this.model };
  }

  listApprovals(): Array<Record<string, unknown>> {
    return this.listPendingApprovals() as unknown as Array<Record<string, unknown>>;
  }

  listQueue(opts: { agent?: string; session?: string } = {}): WebhookQueuedItem[] {
    if (!opts.agent && !opts.session) {
      return this.listMessageQueue();
    }
    const slot = this.slotFor(opts.agent, opts.session);
    const id = slot.sessionId;
    if (!id) return [];
    return MESSAGE_QUEUE.list(id).map((m: QueuedMessage) => ({
      id: m.id,
      message: m.message,
      mode: m.mode,
      enqueuedAt: m.enqueuedAt,
      source: m.source,
    }));
  }

  clearQueue(opts: { agent?: string; session?: string } = {}): number {
    if (!opts.agent && !opts.session) return this.clearMessageQueue();
    const slot = this.slotFor(opts.agent, opts.session);
    const id = slot.sessionId;
    if (!id) return 0;
    const n = MESSAGE_QUEUE.size(id);
    MESSAGE_QUEUE.clear(id);
    return n;
  }

  removeQueue(opts: {
    agent?: string;
    session?: string;
    queueId: number;
  }): boolean {
    if (!opts.agent && !opts.session) {
      return this.removeQueuedMessage(opts.queueId);
    }
    const slot = this.slotFor(opts.agent, opts.session);
    const id = slot.sessionId;
    if (!id) return false;
    return MESSAGE_QUEUE.remove(id, opts.queueId);
  }

  private renameOnStore(
    store: { setTitle(id: string, title: string): boolean },
    sessionId: string,
    title: string,
  ): { sessionId: string; title: string } {
    const id = String(sessionId || "").trim();
    const t = String(title || "").trim();
    if (!id) throw new Error("sessionId required");
    if (!t) throw new Error("title required");
    if (!store.setTitle(id, t)) throw new Error(`session not found: ${id}`);
    return { sessionId: id, title: t.slice(0, 80) };
  }

  private slotFor(agent?: string, session?: string): AgentRuntimeSlot {
    const target = this.resolveAgent(agent);
    const slot = this.ensureSlot(target);
    if (session?.trim()) {
      const id = session.trim();
      const data = slot.sessionStore?.load(id);
      if (!data) throw new Error(`session not found: ${id}`);
      slot.sessionId = id;
      writeLastSessionPointer(slot.projectRoot, id, slot.agentName);
      if (slot.switchId === this._activeSwitchId) this.sessionId = id;
    }
    return slot;
  }

  /**
   * 拿到（或新建）指定 Agent 槽，不切换 WebUI 焦点。
   */
  private ensureSlot(target: WebhookTarget): AgentRuntimeSlot {
    this.syncActiveIntoSlots();
    if (target.switchId === this._activeSwitchId) {
      this.ensureAgent();
      this.syncActiveIntoSlots();
      const active = this.slots.get(target.switchId);
      if (active) return active;
    }

    let slot = this.slots.get(target.switchId);
    const projectRoot = resolveWorkspaceForSwitch({
      maouRoot: this.maouRoot,
      bootProjectRoot: this.bootProjectRoot,
      kind: target.projectPath ? "project" : "system",
      agentName: target.agentName,
      projectPath: target.projectPath,
    });

    if (!slot) {
      slot = {
        switchId: target.switchId,
        agentName: target.agentName,
        projectRoot,
        projectPath: target.projectPath,
        handle: null,
        sessionStore: null,
        sessionId: null,
        runs: new Map(),
        restoredSession: false,
      };
      this.slots.set(target.switchId, slot);
    }

    if (!slot.handle || !slot.sessionStore) {
      const built = this.buildHandle(slot.agentName, slot.projectRoot);
      slot.handle = built.handle;
      slot.sessionStore = built.sessionStore;
    }
    this.restoreSlotSession(slot);
    return slot;
  }

  private buildHandle(agentName: string, projectRoot: string) {
    const deps = createStandardAgentDeps(projectRoot, this.maouRoot, {
      reviewerOnMissingPreset: "approve",
    });
    const handle = createCodingAgent({
      name: agentName,
      projectRoot,
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
    return { handle, sessionStore: deps.sessionStore };
  }

  private restoreSlotSession(slot: AgentRuntimeSlot): void {
    if (slot.restoredSession || slot.sessionId) {
      slot.restoredSession = true;
      return;
    }
    slot.restoredSession = true;
    const store = slot.sessionStore;
    if (!store) return;
    const fromPtr = readLastSessionPointer(slot.projectRoot);
    if (fromPtr && store.exists(fromPtr)) {
      store.recoverCold(fromPtr);
      slot.sessionId = fromPtr;
      return;
    }
    const latest = latestSessionId(slot.projectRoot);
    if (latest && store.exists(latest)) {
      store.recoverCold(latest);
      slot.sessionId = latest;
      writeLastSessionPointer(slot.projectRoot, latest, slot.agentName);
    }
  }

  private startSlotSession(slot: AgentRuntimeSlot, title?: string): void {
    if (!slot.handle) return;
    const id = slot.handle.startSession(title);
    slot.sessionId = id;
    writeLastSessionPointer(slot.projectRoot, id, slot.agentName);
    if (slot.switchId === this._activeSwitchId) {
      this.sessionId = id;
      this.syncActiveIntoSlots();
    }
  }

  private async *runChatOnSlot(
    slot: AgentRuntimeSlot,
    message: WebhookAgentMessage,
    source: string,
  ): AsyncGenerator<StreamEvent> {
    const handle = slot.handle;
    const n = normalizeSendTurn(message);
    if (!handle || (!n.sessionText && !n.command)) return;

    if (!slot.sessionId) {
      this.startSlotSession(slot);
    }
    const sessionId = slot.sessionId;
    if (!sessionId) return;

    const runsMap = slot.runs;
    const ac = runsMap.get(sessionId);
    // 由 deliverToTarget 先占坑；已被 abort / 清槽则不再开跑
    if (!ac || ac.signal.aborted) return;
    const acBox = { current: ac };

    const preset = resolvePresetForCli(this.provider, this.model) as Record<
      string,
      unknown
    >;
    const t0 = performance.now();

    try {
      for await (const ev of handle.runtime.run({
        sessionId,
        userMessage: n.sessionText,
        images: n.images,
        userVideo: n.video,
        userAudio: n.audio,
        userName: source === "project_dispatch" ? "coding" : n.name,
        userCommand: n.command,
        preset,
        stream: true,
        abortSignal: acBox.current.signal,
        source: source || "webhook",
        deferQueueOnExit: true,
        initAgentName: slot.agentName,
        sandboxMode: this.sandboxMode,
      })) {
        yield this.stampTodayOnUsage(ev);
        if (ev.type === "error") return;
        if (ev.type === "done") break;
      }
      yield* this.flushQueuedTurns(sessionId, acBox, (userMessage, signal) =>
        handle.runtime.run({
          sessionId,
          userMessage,
          preset,
          stream: true,
          abortSignal: signal,
          source: source || "webhook",
        deferQueueOnExit: true,
          initAgentName: slot.agentName,
          sandboxMode: this.sandboxMode,
          userName: source === "project_dispatch" ? "coding" : n.name,
        }),
      );
    } finally {
      notePerfMark("hub.runChatOnSlot", performance.now() - t0);
      if (runsMap.get(sessionId) === acBox.current) {
        runsMap.delete(sessionId);
      }
    }
  }

  private drainGenerator(gen: AsyncGenerator<unknown>): void {
    void (async () => {
      try {
        for await (const _ev of gen) {
          /* fire-and-forget：脚本只要 202，会话自己跑 */
        }
      } catch (e) {
        console.error("[webhook]", e instanceof Error ? e.message : e);
      }
    })();
  }
}
