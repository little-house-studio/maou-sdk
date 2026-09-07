/**
 * 无 UI webhook 宿主：自己开槽、自己跑 Runtime。
 * 不依赖 CLI / WebUI；createHandle 可换成 coding-agent。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type {
  Message,
  StreamEvent,
  ToolMessage,
  WebhookAgentMessage,
  WebhookSendMode,
} from "@little-house-studio/types";
import { runtimePresetRoute } from "@little-house-studio/types";
import { type SessionStore } from "@little-house-studio/context";
import { normalizeSendTurn, sendDelivery } from "./send-turn.js";
import {
  createStandardAgentDeps,
  getRolePresetFromMaouConfig,
  listModelsForCli,
  listProvidersForCli,
  resolvePresetForCli,
  type StandardAgentDeps,
} from "../../bootstrap/index.js";
import { Runtime } from "../runtime-facade.js";
import type { AgentHandle } from "../handle.js";
import { MESSAGE_QUEUE, type QueuedMessage } from "../message-queue.js";
import { listOpsAgents } from "../list-ops-agents.js";
import type {
  WebhookAgentInfo,
  WebhookChatLine,
  WebhookHost,
  WebhookQueuedItem,
  WebhookSendResult,
  WebhookSessionInfo,
  WebhookStatusInfo,
} from "./host.js";
import {
  resolveWebhookTarget,
  type WebhookTarget,
} from "./target.js";
import { resolveWorkspaceForSwitch } from "./workspace.js";

type ApprovalMode = "normal" | "auto" | "yolo";

type Slot = {
  switchId: string;
  agentName: string;
  projectRoot: string;
  projectPath: string | null;
  handle: AgentHandle | null;
  sessionStore: SessionStore | null;
  sessionId: string | null;
  runs: Map<string, AbortController>;
  restoredSession: boolean;
};

export type WebhookCreateHandle = (opts: {
  name: string;
  projectRoot: string;
  maouRoot: string;
  deps: StandardAgentDeps;
}) => AgentHandle;

export function createDefaultWebhookHandle(opts: {
  name: string;
  projectRoot: string;
  maouRoot: string;
  deps: StandardAgentDeps;
}): AgentHandle {
  const runtime = new Runtime({
    configStore: opts.deps.configStore,
    sessionStore: opts.deps.sessionStore,
    toolRegistry: opts.deps.toolRegistry,
    llmClient: opts.deps.llmClient,
    maouRoot: opts.maouRoot,
    projectRoot: opts.projectRoot,
    agentName: opts.name,
    agentScope: opts.name === "ops" ? "global" : "project",
    log: () => {},
    enablePostLogger: false,
  });
  return {
    runtime,
    agentName: opts.name,
    projectRoot: opts.projectRoot,
    toolWhitelist: [],
    startSession: (title?: string) => runtime.startSession(opts.name, title),
  };
}

function lastSessionPath(projectRoot: string): string {
  return join(projectRoot, ".maou", "last-session.json");
}

function readLastSessionPointer(projectRoot: string): string | null {
  try {
    const p = lastSessionPath(projectRoot);
    if (!existsSync(p)) return null;
    const raw = JSON.parse(readFileSync(p, "utf8")) as { sessionId?: string };
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

function latestSessionId(store: SessionStore): string | null {
  try {
    const list = store.list();
    if (list.length === 0) return null;
    const sorted = [...list].sort((a, b) =>
      String(b.updatedAt ?? b.lastMsgAt ?? "").localeCompare(
        String(a.updatedAt ?? a.lastMsgAt ?? ""),
      ),
    );
    return sorted[0]?.id ?? null;
  } catch {
    return null;
  }
}

function formatMessages(store: SessionStore, sessionId: string): WebhookChatLine[] {
  const data = store.load(sessionId);
  const msgs = (data?.messages ?? []) as Array<Record<string, unknown>>;
  return msgs.map((m, i) => {
    const roleRaw = String(m.role ?? "assistant");
    const role: Message["role"] =
      roleRaw === "user" ||
      roleRaw === "assistant" ||
      roleRaw === "system" ||
      roleRaw === "tool"
        ? roleRaw
        : "assistant";
    const images = Array.isArray(m.images)
      ? (m.images as Message["images"])
      : undefined;
    const toolName = String(m.tool_name ?? m.toolName ?? "").trim();
    const toolMsg =
      m.tool_message && typeof m.tool_message === "object"
        ? (m.tool_message as ToolMessage)
        : undefined;
    return {
      role,
      content: typeof m.content === "string" ? m.content : String(m.content ?? ""),
      timestamp: String(m.createdAt ?? m.created_at ?? m.timestamp ?? ""),
      ...(images?.length ? { images } : {}),
      ...(m.source ? { source: String(m.source) } : {}),
      id: String(m.id ?? `${sessionId}-${i}`),
      ...(toolName ? { toolName } : {}),
      ...(toolMsg
        ? {
            toolMessage: toolMsg,
            toolOk: toolMsg.ok,
          }
        : {}),
    };
  });
}

function collectAssistantText(events: StreamEvent[]): string {
  const parts: string[] = [];
  for (const ev of events) {
    if (ev.type === "text" || ev.type === "assistant" || ev.type === "content") {
      const bit = ev.delta ?? ev.content ?? ev.message;
      if (typeof bit === "string" && bit) parts.push(bit);
    }
  }
  return parts.join("");
}

export type WebhookAgentHostOpts = {
  bootProjectRoot?: string;
  maouRoot?: string;
  sandboxMode?: string;
  createHandle?: WebhookCreateHandle;
  /** 测试用：占坑但不跑 Runtime */
  skipRun?: boolean;
};

export class WebhookAgentHost implements WebhookHost {
  readonly bootProjectRoot: string;
  readonly maouRoot: string;
  skipRun: boolean;
  private createHandleFn: WebhookCreateHandle;
  private slots = new Map<string, Slot>();
  private activeSwitchId = "";
  private provider = "";
  private model = "";
  private sandboxMode: ApprovalMode;
  private pending = new Map<
    string,
    {
      resolve: (v: { approve: boolean; persist?: string }) => void;
      info: Record<string, unknown>;
    }
  >();

  constructor(opts: WebhookAgentHostOpts = {}) {
    this.bootProjectRoot = opts.bootProjectRoot ?? process.cwd();
    this.maouRoot = opts.maouRoot ?? join(homedir(), ".maou");
    this.createHandleFn = opts.createHandle ?? createDefaultWebhookHandle;
    this.skipRun = Boolean(opts.skipRun);
    const m = String(opts.sandboxMode ?? "yolo");
    this.sandboxMode = m === "normal" || m === "auto" || m === "yolo" ? m : "yolo";
    this.bootstrapPreset();
  }

  listAgents(): WebhookAgentInfo[] {
    const busy = this.busySwitchIds();
    const entries = listOpsAgents({
      maouRoot: this.maouRoot,
      ensureProjectPaths: [this.bootProjectRoot],
    });
    return entries
      .filter((e) => e.name && e.switch_id)
      .map((e) => {
        const switchId = String(e.switch_id);
        return {
          name: String(e.name),
          switchId,
          group: e.group,
          status: busy.has(switchId) ? "running" : "idle",
          projectPath: e.project_path,
        };
      });
  }

  resolveAgent(raw?: string | null): WebhookTarget {
    return resolveWebhookTarget({
      raw,
      agents: this.listAgents(),
      activeSwitchId: this.activeSwitchId,
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
    if (!slot.sessionId) this.startSessionOn(slot);
    const sid = slot.sessionId!;
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
    this.activeSwitchId = slot.switchId;

    if (this.skipRun) {
      return {
        status: "started",
        sessionId: sid,
        switchId: slot.switchId,
        agent: slot.agentName,
      };
    }

    if (opts.wait) {
      const events = await this.runOnSlot(slot, n.turn, ac, opts.timeoutMs);
      return {
        status: "started",
        sessionId: sid,
        switchId: slot.switchId,
        agent: slot.agentName,
        text: collectAssistantText(events),
      };
    }

    void this.runOnSlot(slot, n.turn, ac).catch((e) => {
      console.error("[webhook]", e instanceof Error ? e.message : e);
    });
    return {
      status: "started",
      sessionId: sid,
      switchId: slot.switchId,
      agent: slot.agentName,
    };
  }

  abort(opts: { agent?: string; session?: string }): {
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
    if (!slot.sessionId) this.startSessionOn(slot);
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

  listSessions(agent?: string): WebhookSessionInfo[] {
    const slot = this.slotFor(agent);
    try {
      return (slot.sessionStore?.list() ?? []).map((s) => ({
        id: s.id,
        title: s.title || "新对话",
        updatedAt: s.updatedAt,
        messageCount: s.messageCount ?? 0,
        lastMsgAt: s.lastMsgAt,
        ...(s.parentSessionId ? { parentSessionId: s.parentSessionId } : {}),
      }));
    } catch {
      return [];
    }
  }

  newSession(opts: { agent?: string; title?: string }): { sessionId: string } {
    const slot = this.slotFor(opts.agent);
    this.startSessionOn(slot, opts.title);
    return { sessionId: slot.sessionId! };
  }

  switchSession(opts: { agent?: string; session: string }): { sessionId: string } {
    const slot = this.slotFor(opts.agent, opts.session);
    return { sessionId: slot.sessionId! };
  }

  clearSession(opts: { agent?: string; session?: string }): { sessionId: string } {
    const slot = this.slotFor(opts.agent, opts.session);
    const id = slot.sessionId;
    if (!id || !slot.sessionStore) throw new Error("no active session");
    this.abort({ agent: opts.agent, session: id });
    slot.sessionStore.clearSession(id);
    void slot.handle?.runtime.atCacheRebuildPoint({
      reason: "session_clear",
      sessionId: id,
      agentName: slot.agentName,
    });
    return { sessionId: id };
  }

  deleteSession(opts: {
    agent?: string;
    session: string;
  }): { deleted: boolean; sessionId: string | null } {
    const slot = this.slotFor(opts.agent);
    const id = opts.session.trim();
    if (!id) throw new Error("session required");
    this.abort({ agent: opts.agent, session: id });
    const deleted = slot.sessionStore?.delete(id) ?? false;
    if (slot.sessionId === id) slot.sessionId = null;
    return { deleted, sessionId: slot.sessionId };
  }

  renameSession(opts: {
    agent?: string;
    session: string;
    title: string;
  }): { sessionId: string; title: string } {
    const slot = this.slotFor(opts.agent, opts.session);
    const id = opts.session.trim();
    const title = opts.title.trim().slice(0, 80);
    if (!id) throw new Error("session required");
    if (!title) throw new Error("title required");
    const metaPath = join(slot.projectRoot, ".maou", "sessions", `${id}.meta.json`);
    if (!existsSync(metaPath)) throw new Error(`session not found: ${id}`);
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(readFileSync(metaPath, "utf8")) as Record<string, unknown>;
    } catch {
      meta = { id };
    }
    meta.id = id;
    meta.title = title;
    meta.updated_at = new Date().toISOString();
    writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf8");
    return { sessionId: id, title };
  }

  sessionMessages(opts: {
    agent?: string;
    session?: string;
  }): { sessionId: string; messages: WebhookChatLine[] } {
    const slot = this.slotFor(opts.agent, opts.session);
    const id = slot.sessionId;
    if (!id || !slot.sessionStore) return { sessionId: "", messages: [] };
    return { sessionId: id, messages: formatMessages(slot.sessionStore, id) };
  }

  sessionStats(opts: {
    agent?: string;
    session?: string;
  }): { sessionId: string; stats: Record<string, unknown> } {
    const slot = this.slotFor(opts.agent, opts.session);
    const id = slot.sessionId;
    if (!id || !slot.sessionStore) return { sessionId: "", stats: {} };
    const list = slot.sessionStore.list().find((s) => s.id === id);
    const messages = formatMessages(slot.sessionStore, id);
    return {
      sessionId: id,
      stats: {
        title: list?.title ?? "",
        messageCount: list?.messageCount ?? messages.length,
        lastMsgAt: list?.lastMsgAt,
        updatedAt: list?.updatedAt,
        userTurns: messages.filter((m) => m.role === "user").length,
        assistantTurns: messages.filter((m) => m.role === "assistant").length,
      },
    };
  }

  exportSession(opts: {
    agent?: string;
    session?: string;
  }): { sessionId: string; text: string } {
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

  setModel(provider: string, model: string): { provider: string; model: string } {
    this.provider = provider;
    this.model = model;
    return this.getModel();
  }

  listProviders(): Array<{ id: string; name?: string }> {
    return listProvidersForCli();
  }

  listModels(provider?: string): Array<{ id: string; name?: string }> {
    return listModelsForCli(provider || this.provider);
  }

  getApprovalMode(): string {
    return this.sandboxMode;
  }

  setApprovalMode(mode: string): string {
    if (mode === "normal" || mode === "auto" || mode === "yolo") {
      this.sandboxMode = mode;
    }
    return this.sandboxMode;
  }

  listApprovals(): Array<Record<string, unknown>> {
    return [...this.pending.values()].map((p) => p.info);
  }

  answerApproval(id: string, choice: string): boolean {
    const p = this.pending.get(id);
    if (!p) return false;
    this.pending.delete(id);
    const approve = choice === "once" || choice === "always";
    p.resolve({
      approve,
      persist: choice === "always" ? "whitelist" : choice === "blacklist" ? "blacklist" : "none",
    });
    return true;
  }

  listQueue(opts: { agent?: string; session?: string }): WebhookQueuedItem[] {
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

  clearQueue(opts: { agent?: string; session?: string }): number {
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
    const slot = this.slotFor(opts.agent, opts.session);
    const id = slot.sessionId;
    if (!id) return false;
    return MESSAGE_QUEUE.remove(id, opts.queueId);
  }

  abortAll(): void {
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
  }

  private busySwitchIds(): Set<string> {
    const out = new Set<string>();
    for (const slot of this.slots.values()) {
      if (slot.runs.size > 0) out.add(slot.switchId);
    }
    return out;
  }

  private slotFor(agent?: string, session?: string): Slot {
    const target = this.resolveAgent(agent);
    const slot = this.ensureSlot(target);
    if (session?.trim()) {
      const id = session.trim();
      const data = slot.sessionStore?.load(id);
      if (!data) throw new Error(`session not found: ${id}`);
      slot.sessionId = id;
      writeLastSessionPointer(slot.projectRoot, id, slot.agentName);
    }
    return slot;
  }

  private ensureSlot(target: WebhookTarget): Slot {
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
      const deps = createStandardAgentDeps(projectRoot, this.maouRoot, {
        reviewerOnMissingPreset: "approve",
      });
      slot.sessionStore = deps.sessionStore;
      slot.handle = this.createHandleFn({
        name: slot.agentName,
        projectRoot,
        maouRoot: this.maouRoot,
        deps,
      });
    }
    this.restoreSession(slot);
    if (!this.activeSwitchId) this.activeSwitchId = slot.switchId;
    return slot;
  }

  private restoreSession(slot: Slot): void {
    if (slot.restoredSession || slot.sessionId) {
      slot.restoredSession = true;
      return;
    }
    slot.restoredSession = true;
    const store = slot.sessionStore;
    if (!store) return;
    const fromPtr = readLastSessionPointer(slot.projectRoot);
    if (fromPtr && store.load(fromPtr)) {
      slot.sessionId = fromPtr;
      return;
    }
    const latest = latestSessionId(store);
    if (latest && store.load(latest)) {
      slot.sessionId = latest;
      writeLastSessionPointer(slot.projectRoot, latest, slot.agentName);
    }
  }

  private startSessionOn(slot: Slot, title?: string): void {
    if (!slot.handle) return;
    const id = slot.handle.startSession(title);
    slot.sessionId = id;
    writeLastSessionPointer(slot.projectRoot, id, slot.agentName);
    this.activeSwitchId = slot.switchId;
  }

  private async runOnSlot(
    slot: Slot,
    message: WebhookAgentMessage,
    ac: AbortController,
    timeoutMs?: number,
  ): Promise<StreamEvent[]> {
    const handle = slot.handle;
    const sessionId = slot.sessionId;
    if (!handle || !sessionId) return [];
    const n = normalizeSendTurn(message);
    const events: StreamEvent[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => ac.abort(), timeoutMs);
    }
    try {
      const preset = resolvePresetForCli(this.provider, this.model) as Record<
        string,
        unknown
      >;
      for await (const ev of handle.runtime.run({
        sessionId,
        userMessage: n.sessionText,
        images: n.images,
        userVideo: n.video,
        userAudio: n.audio,
        userName: n.name,
        userCommand: n.command,
        preset,
        stream: true,
        abortSignal: ac.signal,
        source: "webhook",
        initAgentName: slot.agentName,
        sandboxMode: this.sandboxMode,
      })) {
        events.push(ev);
        if (ev.type === "done" || ev.type === "error") break;
      }
    } finally {
      if (timer) clearTimeout(timer);
      if (slot.runs.get(sessionId) === ac) slot.runs.delete(sessionId);
    }
    return events;
  }

  private bootstrapPreset(): void {
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
}
