/**
 * ChatPanel —— CLI 工作流 + 桌面聊天布局
 * wire chrome reuses draft DraftMarkdown / RoleAvatar / ToolCard for shell parity.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  abortChat,
  answerApproval,
  clearChatQueue,
  clearSession,
  createSession,
  deleteSession,
  enqueueChat,
  exportTranscript,
  fetchApproval,
  fetchMeta,
  fetchModels,
  fetchLlmConfig,
  fetchSessionStats,
  fetchSessions,
  removeChatQueueItem,
  renameSession,
  runCommand,
  setApprovalMode,
  setModel,
  streamChat,
  switchSession,
  type ApprovalMode,
  type ChatHistoryLine,
  type ChatSendMode,
  type Meta,
  type PendingApproval,
  type SessionSummary,
  type StreamEvent,
} from "./api";
import { formatModelErrorForUi } from "./model-error-ui";
import { stripTaskCompletionMarkup } from "./strip-task-completion";
import {
  SessionUsageModal,
  type SessionUsageStats,
} from "./SessionUsageModal";
import {
  buildPrevUserJumpLabel,
  shouldShowJumpBar,
} from "./drafts/jump-prev-user";
import {
  WireThreadView,
  chatLinesToDraftMessages,
} from "./drafts/panels/WireThreadView";
import { ApprovalBanner } from "./drafts/panels/ApprovalBanner";
import { ApprovalPhysicsSwitch } from "./drafts/panels/ApprovalPhysicsSwitch";
import {
  ModelCascadeMenu,
  type ModelCascadeMenuHandle,
} from "./drafts/panels/ModelCascadeMenu";
import { ChromeMark } from "./drafts/icons/Marks";
import { SessionTreeCrumbs } from "./drafts/layout/SessionTreeCrumbs";
import type { DraftApproval } from "./drafts/types";

export type ChatLine = {
  id: string;
  role: "user" | "assistant" | "system" | "tool" | "thinking";
  text: string;
  /** 流式累积原文；text 已剥掉 task_completion */
  raw?: string;
  err?: boolean;
  terminalId?: string;
  agentName?: string;
  /**
   * 实际工具名（来自 stream tool_call/tool_result / history meta.tool_name）。
   * UI 徽章必须用这个；仅当完全未知时才回退显示 "tool"。
   */
  toolName?: string;
  /** 配对 tool_call ↔ tool_result */
  toolCallId?: string;
  /** 可一点重试的用户原文（error 行） */
  retryText?: string;
  /** thinking 行元数据（耗时 / token） */
  thinkStartedAt?: number;
  thinkDurationMs?: number;
  thinkOutputTokens?: number;
};

/**
 * 从工具行正文提取工具名（不硬编码具体工具）。
 * 支持：`▶ name` / `✓ name` / `✗ name` / `工具 name 缺少…`
 */
export function extractToolNameFromText(text: string): string | undefined {
  const t = (text || "").trim();
  if (!t) return undefined;
  const m =
    t.match(/(?:^|[\s▶✓✗×❌xX])工具\s+([a-zA-Z_][\w.-]*)/) ||
    t.match(/^[▶✓✗×❌xX]\s*[·•]?\s*([a-zA-Z_][\w.-]*)/) ||
    t.match(/^([a-zA-Z_][\w.-]*)\s*[·•]/);
  const name = m?.[1]?.trim();
  if (!name || name === "tool" || name === "terminal") return undefined;
  return name;
}

/** 解析最终展示用工具名：优先字段，其次正文，终端会话回退 terminal */
export function resolveChatToolName(line: {
  toolName?: string;
  terminalId?: string;
  text?: string;
}): string {
  const fromField = (line.toolName || "").trim();
  if (fromField && fromField !== "tool") return fromField;
  const fromText = extractToolNameFromText(line.text || "");
  if (fromText) return fromText;
  if (line.terminalId) return "use_terminal";
  return fromField || "tool";
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Clipboard with textarea fallback (non-secure origins / older browsers) */
async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  try {
    if (!document.execCommand("copy")) {
      throw new Error("clipboard copy failed");
    }
  } finally {
    document.body.removeChild(ta);
  }
}

function extractTerminalId(ev: StreamEvent): string | undefined {
  const payload = ev.payload as
    | { terminal_id?: string; terminalId?: string }
    | undefined;
  if (payload?.terminal_id) return String(payload.terminal_id);
  if (payload?.terminalId) return String(payload.terminalId);
  const tool = ev.tool as
    | { result?: { payload?: { terminal_id?: string } } }
    | undefined;
  if (tool?.result?.payload?.terminal_id) {
    return String(tool.result.payload.terminal_id);
  }
  if (typeof ev.terminal_id === "string") return ev.terminal_id;
  const content = String(ev.content ?? ev.message ?? ev.result ?? "");
  const m =
    content.match(/\[?terminal_id[=:]\s*([^\s|,}\]]+)/i) ||
    content.match(/终端\s*ID[:：]\s*(\S+)/i) ||
    content.match(/\b(bg_\d+)\b/);
  return m?.[1];
}

function historyToLines(msgs: ChatHistoryLine[]): ChatLine[] {
  return msgs.map((m) => {
    const role =
      m.role === "user" || m.role === "assistant" || m.role === "system"
        ? m.role
        : m.role === "tool"
          ? "tool"
          : "assistant";
    const text =
      role === "assistant"
        ? stripTaskCompletionMarkup(m.content || "")
        : m.content || "";
    // 优先 session 落盘的 tool_name（Agent 权威），正文解析仅兜底
    const fromMeta = (m.toolName || "").trim();
    const fromBody = role === "tool" ? extractToolNameFromText(text) : undefined;
    const toolName =
      role === "tool"
        ? fromMeta && fromMeta !== "tool"
          ? fromMeta
          : fromBody
        : undefined;
    return {
      id: m.id || uid(),
      role: role as ChatLine["role"],
      text,
      toolName,
      toolCallId: m.toolCallId,
      err:
        role === "tool" &&
        (/^✗|❌|缺少必填|失败/i.test(text.trim()) ||
          m.toolOk === false ||
          Boolean((m as { ok?: boolean }).ok === false)),
    };
  });
}

const HELP_TEXT = [
  "斜杠命令（与 CLI coding 工作流对齐）:",
  "/new — 新会话",
  "/clear — 清空当前会话消息（磁盘会话保留 id）",
  "/export — 复制 transcript 到剪贴板",
  "/stop — 停止生成",
  "/model [provider model] — 切换模型",
  "/sessions [id|prefix] — 列出会话，或切换（/sessions switch <id>）",
  "/approval normal|auto|yolo — 终端审批模式",
  "/compact — 强制压缩上下文（Runtime）",
  "/usage · /cost · /analyze — 会话用量 / 诊断",
  "/context — 上下文占用与压缩阈值（Runtime）",
  "/init — 初始化项目说明（Runtime 任务注入）",
  "/plan [<objective>|off|view|approve|revise|clear] — 先写计划，确认后再改",
  "/goal [<objective>|clear|edit|pause|resume] — 进入 goal 目标模式，按完成度续跑",
  "/ultragoal [<objective> [--budget <tokens>] | status | pause | resume | clear] — 多 agent 宿主验收长目标",
  "/help — 本帮助",
  "",
  "热键: Enter 发送（忙碌时入队） · / 补全 ↑↓ Tab · Ctrl+N 新会话 · Ctrl+M 模型 · Ctrl+. / Esc 停止 · Shift+Tab 审批 · Ctrl+Shift+C 复制 · R 重试",
].join("\n");

const SLASH_SUGGESTIONS = [
  "new",
  "clear",
  "export",
  "stop",
  "model",
  "sessions",
  "approval",
  "usage",
  "cost",
  "analyze",
  "compact",
  "context",
  "init",
  "plan",
  "goal",
  "ultragoal",
  "help",
] as const;

/** Cap pending user messages while a turn is running */
const MAX_QUEUE = 20;

const SEND_MODE_KEY = "maou.webui.sendMode";

function loadSendMode(): ChatSendMode {
  try {
    const v = localStorage.getItem(SEND_MODE_KEY);
    if (v === "insert" || v === "queue") return v;
  } catch {
    /* ignore */
  }
  return "queue";
}

/** Outbox above composer: backend-queued + failed unsent */
type OutboxItem = {
  localId: string;
  text: string;
  status: "queued" | "failed";
  mode: ChatSendMode;
  /** backend MessageQueue id when status=queued */
  queueId?: number;
  error?: string;
};

/** 交给 Runtime.commandRegistry 的 slash（走 chat 流，不本地吞掉） */
const RUNTIME_SLASH = new Set([
  "compact",
  "context",
  "init",
  "goal",
  "agent",
]);

type Props = {
  onOpenTerminal?: (id: string, agentName?: string) => void;
  defaultAgent?: string;
  onMetaChange?: (meta: Meta) => void;
  /** codex = 侧栏线程 + 居中对话 + 底部 composer (also used inside draft-aligned live shell) */
  layout?: "default" | "codex";
  /** 将线程列表 portal 到侧栏容器 */
  threadRailId?: string;
  /** Shell topbar busy chip */
  onBusyChange?: (busy: boolean) => void;
  /** Active session title for topbar */
  onSessionTitleChange?: (title: string | null) => void;
  /** Extra class on root (e.g. wire-context for draft-aligned live shell) */
  className?: string;
  /**
   * wire = draft-shell chrome labels/classes (Chinese SessionList-like rail,
   * wire composer dock). Default keeps legacy English codex chrome.
   */
  chrome?: "default" | "wire";
  /** Push recent system/tool/err lines for bottom dock log board */
  onDockLogLines?: (lines: string[]) => void;
};

export function ChatPanel({
  onOpenTerminal,
  defaultAgent = "coding",
  onMetaChange,
  layout = "default",
  threadRailId,
  onBusyChange,
  onSessionTitleChange,
  className,
  chrome = "default",
  onDockLogLines,
}: Props) {
  const isWire =
    chrome === "wire" ||
    (typeof className === "string" && className.includes("wire-context"));
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusyState] = useState(false);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [providers, setProviders] = useState<{ id: string; name?: string }[]>(
    [],
  );
  const [models, setModels] = useState<{ id: string; name?: string }[]>([]);
  const [approval, setApproval] = useState<ApprovalMode>("yolo");
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [status, setStatus] = useState("");
  const [turnUsage, setTurnUsage] = useState<{
    in: number;
    out: number;
  } | null>(null);
  /** 上下文占用：used tokens / maxContext → 百分比 */
  const [contextUsage, setContextUsage] = useState<{
    used: number;
    max: number;
  } | null>(null);
  const maxContextRef = useRef(128_000);
  /** 上下文 chip → 弹窗（不写入聊天线程） */
  const [usageModalOpen, setUsageModalOpen] = useState(false);
  const [usageModalLoading, setUsageModalLoading] = useState(false);
  const [usageModalError, setUsageModalError] = useState<string | null>(null);
  const [usageModalSessionId, setUsageModalSessionId] = useState<string | null>(
    null,
  );
  const [usageModalStats, setUsageModalStats] =
    useState<SessionUsageStats | null>(null);
  const [usageModalRaw, setUsageModalRaw] = useState<string | null>(null);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);
  /** 发送模式：队列（等本轮）/ 插入（打断当前流）—— 对接到 MessageQueue */
  const [sendMode, setSendModeState] = useState<ChatSendMode>(() => loadSendMode());
  /** 发送框上方：未成功发送 / 已排队待投递 */
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [railEl, setRailEl] = useState<HTMLElement | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const modelMenuRef = useRef<ModelCascadeMenuHandle | null>(null);
  const stickBottomRef = useRef(true);
  /** 当前焦点会话的客户端 AbortController（Stop 用） */
  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  /** Guards double-Enter before busyRef flips inside runUserMessage */
  const inFlightSendRef = useRef(false);
  const lastUserRef = useRef("");
  /**
   * 每会话独立 run 代数。切会话不 bump 其它会话。
   * Map: sessionId → { gen, ac }
   */
  const sessionRunsRef = useRef(
    new Map<string, { gen: number; ac: AbortController }>(),
  );
  /** 正在后台/前台生成的会话 id（驱动会话图标着色） */
  const [runningSessionIds, setRunningSessionIds] = useState<string[]>([]);
  const runningSessionIdsRef = useRef<string[]>([]);
  runningSessionIdsRef.current = runningSessionIds;
  /** 焦点会话（stream 事件只刷当前焦点的 UI） */
  const activeSessionRef = useRef<string | null>(null);

  const setSendMode = useCallback((mode: ChatSendMode) => {
    setSendModeState(mode);
    try {
      localStorage.setItem(SEND_MODE_KEY, mode);
    } catch {
      /* ignore */
    }
  }, []);

  const cycleSendMode = useCallback(() => {
    setSendMode(sendMode === "queue" ? "insert" : "queue");
  }, [sendMode, setSendMode]);

  const queueLen = outbox.filter((o) => o.status === "queued").length;

  const focusComposer = useCallback(() => {
    // Defer so layout/portal settle after session switch
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, []);

  // Parent callbacks via refs — never re-bootstrap because App re-rendered
  const onMetaChangeRef = useRef(onMetaChange);
  onMetaChangeRef.current = onMetaChange;
  const onSessionTitleChangeRef = useRef(onSessionTitleChange);
  onSessionTitleChangeRef.current = onSessionTitleChange;
  const onBusyChangeRef = useRef(onBusyChange);
  onBusyChangeRef.current = onBusyChange;
  const onDockLogLinesRef = useRef(onDockLogLines);
  onDockLogLinesRef.current = onDockLogLines;

  // Portal target for thread list (sidebar mounts independently)
  useEffect(() => {
    if (!threadRailId) {
      setRailEl(null);
      return;
    }
    const pick = () => document.getElementById(threadRailId);
    setRailEl(pick());
    // Host is static in App — one short retry is enough (avoid 200ms poll churn)
    if (!pick()) {
      const t = window.setTimeout(() => {
        setRailEl((prev) => {
          const el = pick();
          return prev === el ? prev : el;
        });
      }, 50);
      return () => clearTimeout(t);
    }
  }, [threadRailId]);

  const pushMeta = useCallback((m: Meta) => {
    setMeta(m);
    onMetaChangeRef.current?.(m);
  }, []);

  const setBusy = useCallback((v: boolean) => {
    setBusyState(v);
    onBusyChangeRef.current?.(v);
  }, []);

  const refreshSessions = useCallback(async () => {
    const s = await fetchSessions();
    setSessions((prev) => {
      const next = s.sessions;
      if (
        prev.length === next.length &&
        prev.every(
          (x, i) =>
            x.id === next[i]?.id &&
            x.title === next[i]?.title &&
            x.messageCount === next[i]?.messageCount &&
            x.updatedAt === next[i]?.updatedAt,
        )
      ) {
        return prev;
      }
      return next;
    });
    // 合并服务端 running（多标签/刷新后恢复灯）与本地仍在飞的流
    if (s.runningSessionIds?.length) {
      setRunningSessionIds((prev) => {
        const set = new Set([...prev, ...s.runningSessionIds]);
        return Array.from(set);
      });
    }
    return s;
  }, []);

  // 焦点会话 ref + busy 仅反映「当前会话」是否在跑
  useEffect(() => {
    activeSessionRef.current = meta?.sessionId ?? null;
    const id = meta?.sessionId;
    const isRunning = Boolean(id && runningSessionIds.includes(id));
    busyRef.current = isRunning;
    setBusy(isRunning);
    // 绑定当前会话的 AbortController（若有）
    if (id) {
      abortRef.current = sessionRunsRef.current.get(id)?.ac ?? null;
    } else {
      abortRef.current = null;
    }
  }, [meta?.sessionId, runningSessionIds, setBusy]);

  // Push active session title to shell topbar
  useEffect(() => {
    const cb = onSessionTitleChangeRef.current;
    if (!cb) return;
    const id = meta?.sessionId;
    if (!id) {
      cb(null);
      return;
    }
    const hit = sessions.find((x) => x.id === id);
    cb(hit?.title || null);
  }, [meta?.sessionId, sessions]);

  const patchContextUsage = useCallback(
    (partial: { used?: number; max?: number }) => {
      setContextUsage((prev) => {
        const used =
          partial.used != null && Number.isFinite(partial.used)
            ? Math.max(0, partial.used)
            : (prev?.used ?? 0);
        const max =
          partial.max != null && Number.isFinite(partial.max) && partial.max > 0
            ? partial.max
            : (prev?.max ?? maxContextRef.current);
        if (max > 0) maxContextRef.current = max;
        if (used <= 0 && !prev && partial.used == null) return prev;
        return { used, max };
      });
    },
    [],
  );

  const refreshContextUsage = useCallback(async () => {
    try {
      const r = await fetchSessionStats();
      if (r.stats) {
        // 会话累计 input 作为上下文占用近似；上限来自 preset maxContext
        patchContextUsage({
          used: r.stats.inputTokens,
          max: maxContextRef.current,
        });
      }
    } catch {
      /* ignore */
    }
  }, [patchContextUsage]);

  // 按当前模型解析 maxContext，并刷新会话 token 占用
  useEffect(() => {
    void fetchLlmConfig()
      .then((cfg) => {
        const name = meta?.model || meta?.provider;
        const hit =
          (name &&
            cfg.presets.find(
              (p) => p.model === name || p.name === name,
            )) ||
          cfg.presets[cfg.defaultPreset] ||
          cfg.presets[0];
        if (hit?.maxContext && hit.maxContext > 0) {
          maxContextRef.current = hit.maxContext;
          patchContextUsage({ max: hit.maxContext });
        }
      })
      .catch(() => {});
    void refreshContextUsage();
  }, [meta?.model, meta?.provider, meta?.sessionId, patchContextUsage, refreshContextUsage]);

  const refreshApproval = useCallback(async () => {
    const a = await fetchApproval();
    setApproval((prev) => (prev === a.mode ? prev : a.mode));
    setPending((prev) => {
      const next = a.pending;
      if (
        prev.length === next.length &&
        prev.every(
          (p, i) =>
            p.id === next[i]?.id &&
            p.command === next[i]?.command &&
            p.risk === next[i]?.risk,
        )
      ) {
        return prev;
      }
      return next;
    });
    return a;
  }, []);

  // Mount-only bootstrap — must not re-run when parent callbacks change identity
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const m = await fetchMeta();
        if (cancelled) return;
        pushMeta(m);
        setApproval(
          (m.approvalMode as ApprovalMode) ||
            (m.sandboxMode as ApprovalMode) ||
            "yolo",
        );
        // 恢复 last-session 历史（与 CLI 启动一致）
        if (m.sessionId && Array.isArray(m.messages) && m.messages.length > 0) {
          setLines(historyToLines(m.messages));
          setStatus(`已恢复会话 ${m.sessionId.slice(0, 8)}…`);
        }
        const md = await fetchModels(m.provider || undefined);
        if (cancelled) return;
        setProviders(md.providers.length ? md.providers : m.providers ?? []);
        setModels(md.models);
        await refreshSessions();
        if (cancelled) return;
        await refreshApproval();
      } catch (e) {
        if (!cancelled) {
          setStatus(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // intentional mount-only (pushMeta/refresh* are stable)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 轮询 pending 审批（normal 模式工具阻塞时）
  useEffect(() => {
    const t = setInterval(() => {
      void refreshApproval().catch(() => {});
    }, 1500);
    return () => clearInterval(t);
  }, [refreshApproval]);

  const [showBackToBottom, setShowBackToBottom] = useState(false);
  const [showJumpPrev, setShowJumpPrev] = useState(false);
  const [jumpPrevLabel, setJumpPrevLabel] = useState("↑ 上一条 user（点击）");
  const fromBottomRef = useRef(0);

  // Only auto-scroll when user is already near the bottom (don't yank history review)
  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    const onScroll = () => {
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
      fromBottomRef.current = gap;
      const stick = gap < 96;
      stickBottomRef.current = stick;
      setShowBackToBottom(!stick && el.scrollHeight > el.clientHeight + 48);
      const empty = el.scrollHeight <= el.clientHeight + 8;
      setShowJumpPrev(shouldShowJumpBar(empty, gap));
      // Label from last user bubble fully above viewport
      const nodes = el.querySelectorAll<HTMLElement>('[data-msg-role="user"]');
      let preview: string | null = null;
      for (const n of nodes) {
        if (n.offsetTop + n.offsetHeight <= el.scrollTop + 8) {
          preview = n.dataset.msgPreview || n.textContent || "";
        } else break;
      }
      setJumpPrevLabel(buildPrevUserJumpLabel(preview));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const el = logRef.current;
    if (el && stickBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      setShowBackToBottom(false);
      setShowJumpPrev(false);
    }
  }, [lines, pending]);

  // Dock log board: recent system / tool / err lines
  useEffect(() => {
    const cb = onDockLogLinesRef.current;
    if (!cb) return;
    const bag = lines
      .filter(
        (l) =>
          l.role === "system" ||
          l.role === "tool" ||
          l.role === "thinking" ||
          l.err,
      )
      .slice(-24)
      .map((l) => {
        const tag = l.err ? "err" : l.role;
        const body = (l.text || "").replace(/\s+/g, " ").trim().slice(0, 80);
        return body ? `[${tag}] ${body}` : `[${tag}]`;
      });
    cb(
      bag.length
        ? bag
        : busy
          ? ["[status] agent running…"]
          : ["[status] idle · no system lines"],
    );
  }, [lines, busy]);

  const scrollThreadToBottom = useCallback(() => {
    const el = logRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stickBottomRef.current = true;
    setShowBackToBottom(false);
    setShowJumpPrev(false);
  }, []);

  const jumpPrevUser = useCallback(() => {
    const el = logRef.current;
    if (!el) return;
    const nodes = el.querySelectorAll<HTMLElement>('[data-msg-role="user"]');
    let target: HTMLElement | null = null;
    for (const n of nodes) {
      if (n.offsetTop + n.offsetHeight <= el.scrollTop + 8) {
        target = n;
      } else break;
    }
    if (!target && nodes.length > 0) {
      target = nodes[0]!;
    }
    if (!target) return;
    el.scrollTop = Math.max(0, target.offsetTop - 12);
    stickBottomRef.current = false;
    setShowBackToBottom(true);
    setShowJumpPrev(true);
  }, []);

  const append = useCallback((line: ChatLine) => {
    setLines((prev) => [...prev, line]);
  }, []);

  /** 运行中入队到后端 MessageQueue，并显示在发送框上方 outbox */
  const enqueueToBackend = useCallback(
    async (text: string, mode: ChatSendMode, note?: string) => {
      if (outbox.filter((o) => o.status === "queued").length >= MAX_QUEUE) {
        setStatus(`队列已满（${MAX_QUEUE}）`);
        setOutbox((prev) => [
          ...prev,
          {
            localId: uid(),
            text,
            status: "failed",
            mode,
            error: `队列已满（最多 ${MAX_QUEUE} 条）`,
          },
        ]);
        return false;
      }
      const localId = uid();
      // 乐观展示在 composer 上方
      setOutbox((prev) => [
        ...prev,
        { localId, text, status: "queued", mode },
      ]);
      try {
        const r = await enqueueChat(text, mode);
        setOutbox((prev) =>
          prev.map((o) =>
            o.localId === localId ? { ...o, queueId: r.id } : o,
          ),
        );
        setStatus(
          note ||
            (mode === "insert"
              ? `已插入打断 #${r.id}`
              : `已排队 #${r.id}（本轮结束后投递）`),
        );
        return true;
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        setOutbox((prev) =>
          prev.map((o) =>
            o.localId === localId
              ? { ...o, status: "failed", error: err }
              : o,
          ),
        );
        setStatus(err);
        return false;
      }
    },
    [outbox],
  );

  const removeOutboxItem = useCallback(async (item: OutboxItem) => {
    if (item.queueId != null) {
      try {
        await removeChatQueueItem(item.queueId);
      } catch {
        /* ignore */
      }
    }
    setOutbox((prev) => prev.filter((o) => o.localId !== item.localId));
  }, []);

  const clearOutboxQueued = useCallback(async () => {
    try {
      await clearChatQueue();
    } catch {
      /* ignore */
    }
    setOutbox((prev) => prev.filter((o) => o.status !== "queued"));
    setStatus("已清空排队");
  }, []);

  const patchLastAssistant = useCallback((delta: string) => {
    setLines((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i]!.role === "assistant") {
          // 状态占位（… 调用模型…）收到正文 delta 时整段替换，避免拼进气泡
          const cur = next[i]!;
          const rawBase = /^\u2026\s/.test(cur.text.trimStart()) ? "" : (cur.raw ?? cur.text);
          const raw = rawBase + delta;
          next[i] = { ...cur, raw, text: stripTaskCompletionMarkup(raw) };
          return next;
        }
      }
      next.push({
        id: uid(),
        role: "assistant",
        text: stripTaskCompletionMarkup(delta),
        raw: delta,
      });
      return next;
    });
  }, []);

  const patchLastThinking = useCallback((delta: string) => {
    const now = Date.now();
    setLines((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i]!.role === "thinking") {
          const cur = next[i]!;
          next[i] = {
            ...cur,
            text: cur.text + delta,
            thinkStartedAt: cur.thinkStartedAt ?? now,
            // 流式中持续刷新耗时
            thinkDurationMs: now - (cur.thinkStartedAt ?? now),
          };
          return next;
        }
      }
      next.push({
        id: uid(),
        role: "thinking",
        text: delta,
        thinkStartedAt: now,
        thinkDurationMs: 0,
      });
      return next;
    });
  }, []);

  const onEvent = useCallback(
    (ev: StreamEvent) => {
      switch (ev.type) {
        case "assistant_delta":
        case "text_delta": {
          const d = String(ev.delta ?? ev.content ?? "");
          if (d) patchLastAssistant(d);
          break;
        }
        case "thinking_delta":
        case "reasoning_delta": {
          const d = String(ev.delta ?? ev.content ?? "");
          if (d) patchLastThinking(d);
          break;
        }
        case "thinking":
        case "reasoning": {
          const content = String(ev.content ?? "");
          if (content) {
            append({ id: uid(), role: "thinking", text: content });
          }
          break;
        }
        case "assistant": {
          const content = String(ev.content ?? "");
          if (!content) break;
          setLines((prev) => {
            const next = [...prev];
            // 注意：thinking / tool 可能插在 assistant 后面，不能只看 next[last]
            // 否则 final `assistant` 会再 push 一条，正文显示两次
            let idx = -1;
            for (let i = next.length - 1; i >= 0; i--) {
              if (next[i]!.role === "assistant") {
                idx = i;
                break;
              }
            }
            if (idx >= 0) {
              const cur = next[idx]!;
              // 终态 content 为权威；已有流式前缀则合并覆盖，避免重复气泡
              next[idx] = {
                ...cur,
                raw: content,
                text: stripTaskCompletionMarkup(content),
              };
              return next;
            }
            next.push({
              id: uid(),
              role: "assistant",
              text: stripTaskCompletionMarkup(content),
              raw: content,
            });
            return next;
          });
          break;
        }
        case "tool_call": {
          const tool = ev.tool as {
            id?: string;
            name?: string;
            parameters?: Record<string, unknown>;
          } | undefined;
          // 自动取 stream 上的工具名（Agent 真实调用名），不硬编码
          const name = String(
            tool?.name ??
              ev.name ??
              (ev as { tool_name?: string }).tool_name ??
              "",
          ).trim();
          const toolCallId = String(
            tool?.id ??
              (ev as { toolCallId?: string }).toolCallId ??
              (ev as { tool_call_id?: string }).tool_call_id ??
              "",
          ).trim();
          // 未知时不要写入字面量 "tool"（会污染后续正文解析）
          const displayName = name || undefined;
          const label = displayName || "tool";
          const params =
            tool?.parameters ?? (ev.parameters as Record<string, unknown>) ?? {};
          const desc =
            typeof params.description === "string"
              ? params.description.trim()
              : "";
          const tid =
            typeof params.id === "string"
              ? params.id
              : typeof params.terminal_id === "string"
                ? params.terminal_id
                : undefined;
          const isTerm =
            label === "use_terminal" || label === "bash";
          append({
            id: uid(),
            role: "tool",
            text: `▶ ${label}${desc ? ` · ${desc}` : ""}`,
            toolName: displayName,
            toolCallId: toolCallId || undefined,
            terminalId: isTerm ? tid : undefined,
            agentName: defaultAgent,
          });
          break;
        }
        case "tool_result": {
          // Agent 事件权威字段：name / tool_name；否则按 toolCallId 回填上一 tool_call
          const rawName = String(
            ev.name ?? (ev as { tool_name?: string }).tool_name ?? "",
          ).trim();
          const toolCallId = String(
            (ev as { toolCallId?: string }).toolCallId ??
              (ev as { tool_call_id?: string }).tool_call_id ??
              "",
          ).trim();
          const content = String(ev.content ?? ev.result ?? "");
          const fromContent = extractToolNameFromText(content);
          const ok = ev.ok !== false;
          const tid = extractTerminalId(ev);
          const snippet = content.slice(0, 200);
          const seedName =
            (rawName && rawName !== "tool" ? rawName : "") || fromContent || "";
          setLines((prev) => {
            // 1) 事件 name  2) 正文解析  3) 同 toolCallId 的 tool_call 行
            let name = seedName;
            if (!name && toolCallId) {
              const hit = [...prev]
                .reverse()
                .find(
                  (l) =>
                    l.role === "tool" &&
                    l.toolCallId === toolCallId &&
                    l.toolName &&
                    l.toolName !== "tool",
                );
              if (hit?.toolName) name = hit.toolName;
            }
            // 优先更新同一 toolCallId 的「进行中」卡，避免双行 + 结果行丢名
            if (toolCallId) {
              const idx = prev.findIndex(
                (l) =>
                  l.role === "tool" &&
                  l.toolCallId === toolCallId &&
                  /^▶/.test((l.text || "").trim()),
              );
              if (idx >= 0) {
                const cur = prev[idx]!;
                const finalName =
                  name ||
                  (cur.toolName && cur.toolName !== "tool"
                    ? cur.toolName
                    : "") ||
                  undefined;
                const label = finalName || "tool";
                const next = [...prev];
                next[idx] = {
                  ...cur,
                  text: `${ok ? "✓" : "✗"} ${label}${tid ? ` · ${tid}` : ""}${snippet ? `\n${snippet}` : ""}`,
                  toolName: finalName,
                  err: !ok,
                  terminalId: tid ?? cur.terminalId,
                  agentName: cur.agentName || defaultAgent,
                };
                return next;
              }
            }
            const label = name || "tool";
            return [
              ...prev,
              {
                id: uid(),
                role: "tool" as const,
                text: `${ok ? "✓" : "✗"} ${label}${tid ? ` · ${tid}` : ""}${snippet ? `\n${snippet}` : ""}`,
                toolName: name || undefined,
                toolCallId: toolCallId || undefined,
                err: !ok,
                terminalId: tid,
                agentName: defaultAgent,
              },
            ];
          });
          // 不自动弹终端：用户点工具行 / 底栏「终端」再打开
          break;
        }
        case "usage":
        case "model.usage":
        case "assistant.usage": {
          const u = (ev.usage ?? ev) as Record<string, unknown>;
          const inn = Number(
            u.prompt_tokens ?? u.input_tokens ?? u.input ?? 0,
          );
          const out = Number(
            u.completion_tokens ?? u.output_tokens ?? u.output ?? 0,
          );
          const maxCtx = Number(u.max_context ?? u.maxContext ?? 0);
          const details = (u.completion_tokens_details ??
            u.completionTokensDetails) as
            | { reasoning_tokens?: number; reasoningTokens?: number }
            | undefined;
          const reasonTok = Number(
            details?.reasoning_tokens ??
              details?.reasoningTokens ??
              u.reasoning_tokens ??
              u.reasoningTokens ??
              0,
          );
          if (inn || out) {
            setTurnUsage((prev) => ({
              in: (prev?.in ?? 0) + (Number.isFinite(inn) ? inn : 0),
              out: (prev?.out ?? 0) + (Number.isFinite(out) ? out : 0),
            }));
          }
          // 本轮 prompt tokens ≈ 当前上下文占用
          if (Number.isFinite(inn) && inn > 0) {
            patchContextUsage({
              used: inn,
              max: Number.isFinite(maxCtx) && maxCtx > 0 ? maxCtx : undefined,
            });
          } else if (Number.isFinite(maxCtx) && maxCtx > 0) {
            patchContextUsage({ max: maxCtx });
          }
          // 把 reasoning token / 收尾耗时写回最近 thinking 行
          if (
            (Number.isFinite(reasonTok) && reasonTok > 0) ||
            (Number.isFinite(out) && out > 0)
          ) {
            const now = Date.now();
            setLines((prev) => {
              const next = [...prev];
              for (let i = next.length - 1; i >= 0; i--) {
                if (next[i]!.role !== "thinking") continue;
                const cur = next[i]!;
                const started = cur.thinkStartedAt ?? now;
                next[i] = {
                  ...cur,
                  thinkDurationMs: Math.max(
                    cur.thinkDurationMs ?? 0,
                    now - started,
                  ),
                  thinkOutputTokens:
                    reasonTok > 0
                      ? reasonTok
                      : cur.thinkOutputTokens ?? (out > 0 ? out : undefined),
                };
                break;
              }
              return next;
            });
          }
          break;
        }
        case "done": {
          const u = ev.usage as Record<string, unknown> | undefined;
          if (u) {
            const inn = Number(u.prompt_tokens ?? u.input ?? 0);
            const out = Number(u.completion_tokens ?? u.output ?? 0);
            const maxCtx = Number(u.max_context ?? u.maxContext ?? 0);
            if (inn || out) setTurnUsage({ in: inn, out });
            if (Number.isFinite(inn) && inn > 0) {
              patchContextUsage({
                used: inn,
                max: Number.isFinite(maxCtx) && maxCtx > 0 ? maxCtx : undefined,
              });
            }
          }
          void refreshContextUsage();
          // 结束时冻结 thinking 耗时
          {
            const now = Date.now();
            setLines((prev) =>
              prev.map((l) => {
                if (l.role !== "thinking" || l.thinkStartedAt == null) return l;
                return {
                  ...l,
                  thinkDurationMs: Math.max(
                    l.thinkDurationMs ?? 0,
                    now - l.thinkStartedAt,
                  ),
                };
              }),
            );
          }
          break;
        }
        case "queued_user": {
          // 后端 MessageQueue 投递成功 → 从 outbox 移入 transcript
          const content = String(ev.content ?? "").trim();
          const qid = Number(ev.id);
          if (content) {
            lastUserRef.current = content;
            append({ id: uid(), role: "user", text: content });
            // 新一轮 assistant 气泡，承接插入/排队后的回复
            append({ id: uid(), role: "assistant", text: "" });
          }
          setOutbox((prev) =>
            prev.filter((o) => {
              if (Number.isFinite(qid) && o.queueId === qid) return false;
              if (content && o.text === content && o.status === "queued")
                return false;
              return true;
            }),
          );
          break;
        }
        case "queue_delivered": {
          // loop_end 批量投递：同步清 outbox
          const msgs = (ev.messages as Array<{ id?: number; content?: string }> | undefined) ?? [];
          if (msgs.length > 0) {
            setOutbox((prev) =>
              prev.filter((o) => {
                if (o.status !== "queued") return true;
                if (o.queueId != null && msgs.some((m) => m.id === o.queueId))
                  return false;
                if (msgs.some((m) => m.content === o.text)) return false;
                return true;
              }),
            );
          }
          break;
        }
        case "error": {
          const raw = String(ev.message ?? ev.error ?? "error");
          // Prefer LLM structured category from stream (Agent emits category/retryable)
          const category = String(
            (ev as { category?: string }).category ?? "",
          ).trim();
          const retryable = (ev as { retryable?: boolean }).retryable;
          const text = formatModelErrorForUi(raw, category, retryable);
          setLines((prev) =>
            prev.filter((l) => !(l.role === "assistant" && !l.text.trim())),
          );
          append({
            id: uid(),
            role: "system",
            text,
            err: true,
            retryText: lastUserRef.current || undefined,
          });
          break;
        }
        case "info": {
          const msg = String(ev.message ?? ev.text ?? "").trim();
          // 中断等关键运行时信息：以前静默吞掉，用户只看到「无回复」
          if (msg === "已中断" || /中断|abort/i.test(msg)) {
            append({
              id: uid(),
              role: "system",
              text: msg,
              err: true,
              retryText: lastUserRef.current || undefined,
            });
          }
          break;
        }
        case "model_switched": {
          // Runtime switchPreset mid-run (CLI TUI status bar parity)
          const model = String(ev.model ?? "");
          const prev = String(
            (ev as { previousModel?: string }).previousModel ?? "",
          );
          if (model) {
            append({
              id: uid(),
              role: "system",
              text: `模型切换: ${prev || "?"} → ${model}`,
            });
            setMeta((m) => {
              if (!m) return m;
              const next = { ...m, model };
              onMetaChange?.(next);
              return next;
            });
          }
          break;
        }
        case "system":
        case "system_notice":
        case "session_inject": {
          const msg = String(ev.content ?? ev.message ?? "");
          if (msg) append({ id: uid(), role: "system", text: msg });
          break;
        }
        case "status": {
          // 模型等待/重试进度：写进空 assistant 气泡，避免 wire 模式无 banner 时「只有 LIVE + …」
          const text = String(
            (ev as { text?: string; content?: string; message?: string }).text ??
              (ev as { content?: string }).content ??
              (ev as { message?: string }).message ??
              "",
          ).trim();
          if (!text) break;
          setLines((prev) => {
            const next = [...prev];
            for (let i = next.length - 1; i >= 0; i--) {
              const l = next[i]!;
              if (l.role === "assistant" && !l.text.trim()) {
                next[i] = {
                  ...l,
                  text: `… ${text}`,
                };
                return next;
              }
            }
            // 已有正文则用 system 轻提示
            next.push({
              id: uid(),
              role: "system",
              text: `⏳ ${text}`,
            });
            return next;
          });
          break;
        }
        case "log": {
          const msg = String(ev.message ?? ev.content ?? "");
          if (!msg) break;
          const level = String(ev.level ?? "info");
          if (level === "error" || level === "warning" || level === "warn") {
            append({
              id: uid(),
              role: "system",
              text: msg,
              err: level === "error",
            });
          } else if (
            // Surface context compress / model switch (CLI shows these)
            /压缩|归档|模型切换|compact|archive|summaryStage|archiveStage|调用模型|限流|额度|429|Retrying|重试/i.test(
              msg,
            )
          ) {
            append({ id: uid(), role: "system", text: msg });
          }
          break;
        }
        default:
          break;
      }
    },
    [
      append,
      patchLastAssistant,
      patchLastThinking,
      defaultAgent,
      onMetaChange,
      patchContextUsage,
      refreshContextUsage,
    ],
  );

  const handleSlash = async (raw: string): Promise<"local" | "runtime" | "none"> => {
    if (!raw.startsWith("/")) return "none";
    const body = raw.slice(1).trim();
    const [cmd, ...rest] = body.split(/\s+/);
    const c = (cmd || "").toLowerCase();

    // Runtime-handled slash: stream as user message so Agent commandRegistry runs
    if (
      RUNTIME_SLASH.has(c) &&
      c !== "stop" // stop handled locally below
    ) {
      return "runtime";
    }

    if (c === "help" || c === "?") {
      append({ id: uid(), role: "system", text: HELP_TEXT });
      return "local";
    }
    if (c === "clear") {
      await stopRun(false);
      try {
        const r = await clearSession();
        pushMeta(r.meta);
        setLines([]);
        setTurnUsage(null);
        await refreshSessions();
        append({
          id: uid(),
          role: "system",
          text: `✓ 已清空会话消息 ${r.sessionId}`,
        });
      } catch {
        setLines([]);
        setTurnUsage(null);
        append({
          id: uid(),
          role: "system",
          text: "✓ 已清空视图（无活动会话）",
        });
      }
      return "local";
    }
    if (c === "new") {
      await stopRun(false);
      const r = await createSession();
      pushMeta(r.meta);
      setLines([]);
      setTurnUsage(null);
      await refreshSessions();
      setStatus(`新会话 ${r.sessionId.slice(0, 8)}…`);
      append({ id: uid(), role: "system", text: `✓ 新会话 ${r.sessionId}` });
      return "local";
    }
    if (c === "stop" || c === "abort") {
      await stopRun(false);
      try {
        await runCommand("stop");
      } catch {
        /* ignore */
      }
      append({ id: uid(), role: "system", text: "■ 已停止（队列已清空）" });
      return "local";
    }
    if (c === "sessions") {
      const rawId =
        rest[0] === "switch" || rest[0] === "open" ? rest[1] : rest[0];
      if (rawId) {
        await stopRun(false);
        const s = await refreshSessions();
        const q = rawId.toLowerCase();
        const hit =
          s.sessions.find((x) => x.id === rawId) ||
          s.sessions.find((x) => x.id.startsWith(rawId)) ||
          s.sessions.find((x) => (x.title || "").toLowerCase().includes(q));
        if (!hit) {
          append({
            id: uid(),
            role: "system",
            text: `未找到会话: ${rawId}\n用法: /sessions 或 /sessions <id|前缀|标题片段>`,
            err: true,
          });
          return "local";
        }
        try {
          const r = await switchSession(hit.id);
          pushMeta(r.meta);
          setLines(historyToLines(r.messages));
          setTurnUsage(null);
          await refreshSessions();
          append({
            id: uid(),
            role: "system",
            text: `✓ 切换会话 ${hit.id} · ${hit.title || "Untitled"}`,
          });
        } catch (e) {
          append({
            id: uid(),
            role: "system",
            text: e instanceof Error ? e.message : String(e),
            err: true,
          });
        }
        return "local";
      }
      const s = await refreshSessions();
      const list =
        s.sessions
          .slice(0, 20)
          .map(
            (x) =>
              `${x.id === s.activeSessionId ? "→ " : "  "}${x.id.slice(0, 12)}… ${x.title} (${x.messageCount})`,
          )
          .join("\n") || "(无会话)";
      append({
        id: uid(),
        role: "system",
        text: `会话列表:\n${list}\n\n切换: /sessions <id|前缀>`,
      });
      return "local";
    }
    if (c === "model") {
      if (rest.length >= 2) {
        const provider = rest[0]!;
        const model = rest.slice(1).join(" ");
        const m = await setModel(provider, model);
        pushMeta(m);
        const md = await fetchModels(provider);
        setModels(md.models);
        append({
          id: uid(),
          role: "system",
          text: `✓ 模型 ${provider}/${model}`,
        });
      } else {
        const md = await fetchModels(meta?.provider);
        setProviders(md.providers);
        setModels(md.models);
        append({
          id: uid(),
          role: "system",
          text: `当前 ${meta?.provider}/${meta?.model}\nproviders: ${md.providers.map((p) => p.id).join(", ")}\nmodels: ${md.models.map((m) => m.id).slice(0, 12).join(", ")}`,
        });
      }
      return "local";
    }
    if (c === "approval") {
      const mode = (rest[0] || "") as ApprovalMode;
      if (["normal", "auto", "yolo"].includes(mode)) {
        const m = await setApprovalMode(mode);
        pushMeta(m);
        setApproval(mode);
        append({ id: uid(), role: "system", text: `✓ 审批模式 ${mode}` });
      } else {
        append({
          id: uid(),
          role: "system",
          text: `当前审批: ${approval}\n用法: /approval normal|auto|yolo`,
        });
      }
      return "local";
    }
    if (c === "usage" || c === "cost" || c === "analyze") {
      const r = await runCommand(c === "cost" ? "usage" : c);
      const text =
        typeof r.text === "string"
          ? r.text
          : JSON.stringify(r).slice(0, 400);
      append({ id: uid(), role: "system", text });
      return "local";
    }
    if (c === "export") {
      try {
        const text = await exportTranscript();
        await copyToClipboard(text);
        append({
          id: uid(),
          role: "system",
          text: `✓ 已复制 transcript（${text.length} 字符）`,
        });
      } catch (e) {
        append({
          id: uid(),
          role: "system",
          text: e instanceof Error ? e.message : String(e),
          err: true,
        });
      }
      return "local";
    }

    // 其它未知 slash：先试 server /api/command，失败再 runtime 透传
    try {
      const r = await runCommand(c, { args: rest });
      if (r.help && Array.isArray(r.help)) {
        append({
          id: uid(),
          role: "system",
          text: (r.help as string[]).join("\n"),
        });
        return "local";
      }
      if (r.ok !== false) {
        append({
          id: uid(),
          role: "system",
          text:
            typeof r.text === "string"
              ? r.text
              : `✓ /${c} ${JSON.stringify(r).slice(0, 200)}`,
        });
        return "local";
      }
    } catch {
      /* fall through to runtime */
    }
    return "runtime";
  };

  const markSessionRunning = useCallback((sessionId: string, on: boolean) => {
    setRunningSessionIds((prev) => {
      const has = prev.includes(sessionId);
      if (on && !has) return [...prev, sessionId];
      if (!on && has) return prev.filter((x) => x !== sessionId);
      return prev;
    });
  }, []);

  const runUserMessage = useCallback(
    async (text: string) => {
      // 绑定到发送时的会话；切走后该流仍继续，只在焦点会话时刷 UI
      let sessionId: string =
        activeSessionRef.current || meta?.sessionId || "__pending__";

      const prevRun = sessionRunsRef.current.get(sessionId);
      // 同会话再次发送：打断本会话旧流
      if (prevRun) {
        try {
          prevRun.ac.abort();
        } catch {
          /* ignore */
        }
      }
      const gen = (prevRun?.gen ?? 0) + 1;
      const ac = new AbortController();
      sessionRunsRef.current.set(sessionId, { gen, ac });
      abortRef.current = ac;
      markSessionRunning(sessionId, true);

      lastUserRef.current = text;
      stickBottomRef.current = true;

      // 仅当前焦点会话立刻画气泡
      if (
        activeSessionRef.current === sessionId ||
        sessionId === "__pending__"
      ) {
        append({ id: uid(), role: "user", text });
        append({ id: uid(), role: "assistant", text: "" });
        busyRef.current = true;
        setBusy(true);
        setTurnUsage(null);
      }
      setSlashOpen(false);

      try {
        for await (const ev of streamChat(text, ac.signal)) {
          const cur = sessionRunsRef.current.get(sessionId);
          if (!cur || cur.gen !== gen) break;

          // 首包 session：把 pending 键迁到真实 sessionId
          if (sessionId === "__pending__" && ev.type === "session") {
            const real = String(
              (ev as { sessionId?: unknown }).sessionId ?? "",
            ).trim();
            if (real) {
              sessionRunsRef.current.delete("__pending__");
              sessionRunsRef.current.set(real, { gen, ac });
              markSessionRunning("__pending__", false);
              markSessionRunning(real, true);
              sessionId = real;
              if (!activeSessionRef.current) {
                activeSessionRef.current = real;
              }
            }
          }

          // 只把事件应用到「当前正在看的会话」
          if (activeSessionRef.current === sessionId) {
            onEvent(ev);
          }
        }
        if (sessionRunsRef.current.get(sessionId)?.gen === gen) {
          void refreshApproval();
          void refreshSessions();
          // 若用户仍在本会话，结束时清空气泡；若已切走，回看时会 reload history
          if (activeSessionRef.current === sessionId) {
            setLines((prev) =>
              prev.filter((l) => !(l.role === "assistant" && !l.text.trim())),
            );
            void refreshContextUsage();
          } else {
            // 后台结束：用户切回时 history 会带上完整回复
          }
        }
      } catch (e) {
        if (
          sessionRunsRef.current.get(sessionId)?.gen === gen &&
          (e as Error)?.name !== "AbortError"
        ) {
          const raw = e instanceof Error ? e.message : String(e);
          const err = formatModelErrorForUi(raw);
          if (activeSessionRef.current === sessionId) {
            // 清掉空的「…」assistant，避免和错误行叠在一起
            setLines((prev) =>
              prev.filter((l) => !(l.role === "assistant" && !l.text.trim())),
            );
            append({
              id: uid(),
              role: "system",
              text: err,
              err: true,
              retryText: text,
            });
            setOutbox((prev) => {
              if (prev.some((o) => o.status === "failed" && o.text === text)) {
                return prev;
              }
              return [
                ...prev,
                {
                  localId: uid(),
                  text,
                  status: "failed",
                  mode: sendMode,
                  error: err,
                },
              ];
            });
          }
        }
      } finally {
        const cur = sessionRunsRef.current.get(sessionId);
        if (cur && cur.gen === gen) {
          sessionRunsRef.current.delete(sessionId);
          markSessionRunning(sessionId, false);
          if (abortRef.current === ac) abortRef.current = null;
          if (activeSessionRef.current === sessionId) {
            busyRef.current = false;
            setBusy(false);
            setLines((prev) =>
              prev.filter((l) => !(l.role === "assistant" && !l.text.trim())),
            );
          }
        }
      }
    },
    [
      append,
      onEvent,
      refreshApproval,
      refreshSessions,
      refreshContextUsage,
      sendMode,
      meta?.sessionId,
      markSessionRunning,
      setBusy,
    ],
  );

  /** 只停止「当前焦点」会话；其它会话继续跑 */
  const stopRun = useCallback(async (announce = true) => {
    const sid = activeSessionRef.current || meta?.sessionId || null;
    inFlightSendRef.current = false;
    if (sid) {
      const run = sessionRunsRef.current.get(sid);
      if (run) {
        run.gen += 1; // invalidate stream loop
        try {
          run.ac.abort();
        } catch {
          /* ignore */
        }
        sessionRunsRef.current.delete(sid);
      }
      markSessionRunning(sid, false);
    }
    abortRef.current?.abort();
    abortRef.current = null;
    try {
      await abortChat(sid);
    } catch {
      /* ignore */
    }
    setOutbox((prev) => prev.filter((o) => o.status === "failed"));
    busyRef.current = false;
    setBusy(false);
    setPending([]);
    setLines((prev) =>
      prev.filter((l) => !(l.role === "assistant" && !l.text.trim())),
    );
    void refreshApproval().catch(() => {});
    if (announce) {
      setStatus("已停止");
    }
  }, [refreshApproval, meta?.sessionId, markSessionRunning, setBusy]);

  /** modeOverride: Ctrl+Enter 强制 insert */
  const send = async (modeOverride?: ChatSendMode) => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    // Reset auto-grown textarea height after send
    if (inputRef.current) {
      inputRef.current.style.height = "";
    }

    if (text.startsWith("/")) {
      try {
        // /stop always local even while a turn is running
        const mode = await handleSlash(text);
        if (mode === "local") return;
        if (mode === "none") return;
        // mode === "runtime" → fall through as chat message
      } catch (e) {
        append({
          id: uid(),
          role: "system",
          text: e instanceof Error ? e.message : String(e),
          err: true,
        });
        return;
      }
    }

    const mode = modeOverride ?? sendMode;

    // Busy or send already in-flight: 对接后端 MessageQueue
    if (busyRef.current || inFlightSendRef.current) {
      await enqueueToBackend(text, mode);
      return;
    }

    inFlightSendRef.current = true;
    try {
      await runUserMessage(text);
    } catch (e) {
      // 未成功发送 → 放在 composer 上方 outbox
      const err = e instanceof Error ? e.message : String(e);
      setOutbox((prev) => [
        ...prev,
        {
          localId: uid(),
          text,
          status: "failed",
          mode,
          error: err,
        },
      ]);
    } finally {
      inFlightSendRef.current = false;
    }
  };

  const onSessionChange = async (id: string) => {
    if (!id) return;
    // 不 abort：同 Agent 其它会话继续跑；只切换焦点 + 加载历史
    setOutbox([]);
    setPending([]);
    try {
      const r = await switchSession(id);
      pushMeta(r.meta);
      activeSessionRef.current = r.sessionId;
      setLines(historyToLines(r.messages));
      setTurnUsage(null);
      stickBottomRef.current = true;
      const stillRunning = runningSessionIdsRef.current.includes(r.sessionId);
      busyRef.current = stillRunning;
      setBusy(stillRunning);
      abortRef.current =
        sessionRunsRef.current.get(r.sessionId)?.ac ?? null;
      await refreshSessions();
      setStatus("");
      focusComposer();
      void refreshContextUsage();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  };

  const onNewSession = async () => {
    // 不停止其它会话
    setOutbox([]);
    setPending([]);
    const r = await createSession();
    pushMeta(r.meta);
    activeSessionRef.current = r.sessionId;
    setLines([]);
    setTurnUsage(null);
    stickBottomRef.current = true;
    busyRef.current = false;
    setBusy(false);
    abortRef.current = null;
    await refreshSessions();
    setStatus("新会话");
    focusComposer();
  };

  const onDeleteSession = async (id: string) => {
    if (!id) return;
    if (!window.confirm(`删除会话 ${id.slice(0, 12)}…？`)) return;
    // 只停被删的会话
    const run = sessionRunsRef.current.get(id);
    if (run) {
      try {
        run.ac.abort();
      } catch {
        /* ignore */
      }
      sessionRunsRef.current.delete(id);
      markSessionRunning(id, false);
    }
    try {
      await abortChat(id);
    } catch {
      /* ignore */
    }
    try {
      const r = await deleteSession(id);
      pushMeta(r.meta);
      setSessions(r.sessions);
      setLines(historyToLines(r.messages));
      setTurnUsage(null);
      stickBottomRef.current = true;
      setStatus("已删除会话");
      focusComposer();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  };

  const onRenameSession = async (id: string, current: string) => {
    const next = window.prompt("会话标题", current || "");
    if (next == null) return;
    const title = next.trim();
    if (!title) return;
    try {
      const r = await renameSession(id, title);
      setSessions(r.sessions);
      setStatus(`已重命名: ${r.title}`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  };

  const retryLastUser = (text?: string) => {
    const msg =
      text ||
      [...lines].reverse().find((l) => l.role === "user")?.text ||
      lastUserRef.current;
    if (!msg) return;
    if (busyRef.current || inFlightSendRef.current) {
      void enqueueToBackend(msg, sendMode, "重试已排队");
      return;
    }
    inFlightSendRef.current = true;
    void runUserMessage(msg)
      .catch((e) => {
        const err = e instanceof Error ? e.message : String(e);
        setOutbox((prev) => [
          ...prev,
          {
            localId: uid(),
            text: msg,
            status: "failed",
            mode: sendMode,
            error: err,
          },
        ]);
      })
      .finally(() => {
        inFlightSendRef.current = false;
      });
  };

  const retryOutboxItem = (item: OutboxItem) => {
    void removeOutboxItem(item).then(() => {
      if (busyRef.current || inFlightSendRef.current) {
        void enqueueToBackend(item.text, item.mode || sendMode, "重试已排队");
        return;
      }
      inFlightSendRef.current = true;
      void runUserMessage(item.text)
        .catch((e) => {
          const err = e instanceof Error ? e.message : String(e);
          setOutbox((prev) => [
            ...prev,
            {
              localId: uid(),
              text: item.text,
              status: "failed",
              mode: item.mode || sendMode,
              error: err,
            },
          ]);
        })
        .finally(() => {
          inFlightSendRef.current = false;
        });
    });
  };

  // Global shortcuts（与 CLI 热键同类，不是完整 CLI 外壳）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const inField =
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement;

      if (mod && e.key.toLowerCase() === "n" && !e.shiftKey) {
        e.preventDefault();
        void onNewSession();
      }
      // Ctrl+M — open model cascade (CLI /model hotkey parity)
      if (mod && e.key.toLowerCase() === "m" && !e.shiftKey) {
        e.preventDefault();
        modelMenuRef.current?.open();
        modelMenuRef.current?.focus();
      }
      if (mod && e.key === ".") {
        e.preventDefault();
        void stopRun();
      }
      // Esc: close slash menu or cancel in-flight turn (CLI escape-cancel)
      if (e.key === "Escape") {
        if (slashOpen) {
          setSlashOpen(false);
          return;
        }
        if (busyRef.current) {
          e.preventDefault();
          void stopRun();
        }
      }
      // Shift+Tab: cycle approval normal → auto → yolo (CLI nav parity)
      if (e.key === "Tab" && e.shiftKey && !mod) {
        e.preventDefault();
        const order: ApprovalMode[] = ["normal", "auto", "yolo"];
        const cur = approval;
        const next = order[(order.indexOf(cur) + 1) % order.length]!;
        void setApprovalMode(next)
          .then((m) => {
            pushMeta(m);
            setApproval(next);
            setStatus(`审批 ${next}`);
          })
          .catch((err) =>
            setStatus(err instanceof Error ? err.message : String(err)),
          );
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        void exportTranscript()
          .then((t) => copyToClipboard(t))
          .then(() => setStatus("已复制 transcript"))
          .catch((err) =>
            setStatus(err instanceof Error ? err.message : String(err)),
          );
      }
      // R when not typing in input — retry last user (CLI-like)
      if (!mod && e.key.toLowerCase() === "r" && !inField) {
        e.preventDefault();
        retryLastUser();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lines, busy, stopRun, approval, slashOpen, pushMeta]);

  const onCascadeModelSelect = async (provider: string, modelId: string) => {
    if (!provider || !modelId) return;
    try {
      const m = await setModel(provider, modelId);
      pushMeta(m);
      // refresh model list for active provider
      const md = await fetchModels(provider);
      setModels(md.models);
      if (md.providers?.length) setProviders(md.providers);
      // 模型只在左侧 cascade 显示，不再写 status（避免工具栏重复）
      // 切换模型后刷新 maxContext
      void fetchLlmConfig()
        .then((cfg) => {
          const hit =
            cfg.presets.find(
              (p) => p.model === modelId || p.name === provider,
            ) ||
            cfg.presets[cfg.defaultPreset] ||
            cfg.presets[0];
          if (hit?.maxContext && hit.maxContext > 0) {
            maxContextRef.current = hit.maxContext;
            patchContextUsage({ max: hit.maxContext });
          }
        })
        .catch(() => {});
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    }
  };

  const onApprovalChange = async (mode: ApprovalMode) => {
    const m = await setApprovalMode(mode);
    pushMeta(m);
    setApproval(mode);
  };

  const isCodex = layout === "codex";

  const threadRail =
    isCodex && threadRailId ? (
      <ThreadRail
        sessions={sessions}
        activeId={meta?.sessionId ?? null}
        busy={busy}
        runningSessionIds={runningSessionIds}
        wire={isWire}
        agentLabel={meta?.agentName || defaultAgent}
        onNew={() => void onNewSession()}
        onSelect={(id) => void onSessionChange(id)}
        onDelete={(id) => void onDeleteSession(id)}
        onRename={(id, title) => void onRenameSession(id, title)}
      />
    ) : null;

  const railHost = railEl;

  const decideApproval = useCallback(
    (id: string, choice: "once" | "always" | "deny" | "blacklist") => {
      void answerApproval(id, choice)
        .then(setPending)
        .catch((err) =>
          setStatus(err instanceof Error ? err.message : String(err)),
        );
    },
    [],
  );

  /** Draft ApprovalBanner for wire; legacy multi-card for codex */
  const approvalBlock =
    pending.length > 0 && isWire ? (
      <>
        {pending.map((p) => {
          const draftAppr: DraftApproval = {
            id: p.id,
            summary: p.summary || p.label || "命令待确认",
            command: p.command,
            risk: p.risk === "high" ? "high" : "normal",
            agentName: p.agentName || defaultAgent,
          };
          return (
            <ApprovalBanner
              key={p.id}
              approval={draftAppr}
              onDecision={(d) => decideApproval(p.id, d)}
            />
          );
        })}
      </>
    ) : pending.length > 0 ? (
      <div className="approval-banner">
        {pending.map((p) => (
          <div key={p.id} className={`approval-card risk-${p.risk || "low"}`}>
            <div className="approval-head">
              {p.label || "终端审批"} · {p.agentName}
              {p.risk === "high" ? " · 高风险" : ""}
            </div>
            <div className="approval-summary">
              {p.summary || "命令待确认"}
            </div>
            <code className="approval-cmd">{p.command}</code>
            <div className="approval-actions">
              {(
                [
                  ["once", "允许一次", ""],
                  ["always", "总是允许", ""],
                  ["deny", "拒绝", "ghost"],
                  ["blacklist", "黑名单", "ghost"],
                ] as const
              ).map(([choice, label, cls]) => (
                <button
                  key={choice}
                  type="button"
                  className={cls || undefined}
                  onClick={() => decideApproval(p.id, choice)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    ) : null;

  const avatarLabel = (role: ChatLine["role"]) => {
    if (role === "user") return "You";
    if (role === "assistant") return "M";
    if (role === "tool") return "⚙";
    if (role === "thinking") return "…";
    return "·";
  };

  const roleLabel = (role: ChatLine["role"]) => {
    if (role === "user") return "You";
    if (role === "assistant") return "Maou";
    if (role === "tool") return "Tool";
    if (role === "thinking") return "Thinking";
    return "System";
  };

  const emptyTitle = isWire ? "从哪里开始？" : "What should we work on?";
  const emptySub = isWire
    ? "描述任务，或输入 /help。终端从工具卡或 Ctrl+` 打开；任务与日志在底部 dock。"
    : "Describe a task, or type /help. Tools and terminals open on the right.";

  // Wire: same groupThreadBlocks tree as draft ContextPanel
  const wireDraftMessages = isWire
    ? chatLinesToDraftMessages(lines, {
        agentBusy: busy,
        agentName: meta?.agentName || defaultAgent,
      })
    : [];

  const messageList = isWire ? (
    <WireThreadView
      messages={wireDraftMessages}
      emptyTitle={emptyTitle}
      emptySub={emptySub}
      onOpenTerminal={onOpenTerminal}
      scrollRef={logRef}
    />
  ) : (
    <div
      className={`chat-log${isCodex ? " codex-log" : ""}`}
      ref={logRef}
    >
      {lines.length === 0 && (
        <div className="bubble system empty-hint codex-bubble">
          {isCodex ? (
            <div className="msg-body">
              <div className="empty-title">{emptyTitle}</div>
              <div className="empty-sub">{emptySub}</div>
            </div>
          ) : (
            "输入消息开始，或用 /help。"
          )}
        </div>
      )}
      {lines.map((l) => (
        <div
          key={l.id}
          className={`bubble ${l.role}${l.err ? " err" : ""}${l.role === "tool" ? " tool-line" : ""}${isCodex ? " codex-bubble" : ""}`}
          data-msg-id={l.id}
          data-msg-role={l.role}
          data-msg-preview={
            l.role === "user"
              ? (l.text || "").replace(/\s+/g, " ").trim().slice(0, 64)
              : undefined
          }
        >
          {isCodex ? (
            <>
              <div className="msg-avatar" aria-hidden>
                {avatarLabel(l.role)}
              </div>
              <div className="msg-body">
                <div className="msg-role">
                  {roleLabel(l.role)}
                  {l.terminalId ? " · terminal" : ""}
                </div>
                <pre className="bubble-text">
                  {l.text || (busy && l.role === "assistant" ? "…" : "")}
                </pre>
                {l.terminalId && onOpenTerminal ? (
                  <button
                    type="button"
                    className="wire-tool-open-term"
                    onClick={() =>
                      onOpenTerminal(l.terminalId!, l.agentName)
                    }
                  >
                    打开终端
                  </button>
                ) : null}
                {l.err && l.retryText ? (
                  <button
                    type="button"
                    className="retry-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      retryLastUser(l.retryText);
                    }}
                  >
                    Retry
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <div className="tag">
                {l.role}
                {l.terminalId ? " · 终端" : ""}
              </div>
              <pre className="bubble-text">
                {l.text || (busy && l.role === "assistant" ? "…" : "")}
              </pre>
              {l.terminalId && onOpenTerminal ? (
                <button
                  type="button"
                  className="wire-tool-open-term"
                  onClick={() =>
                    onOpenTerminal(l.terminalId!, l.agentName)
                  }
                >
                  打开终端
                </button>
              ) : null}
              {l.err && l.retryText ? (
                <button
                  type="button"
                  className="retry-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    retryLastUser(l.retryText);
                  }}
                >
                  Retry
                </button>
              ) : null}
            </>
          )}
        </div>
      ))}
    </div>
  );

  const slashPrefix = input.startsWith("/")
    ? input.slice(1).split(/\s/)[0]?.toLowerCase() ?? ""
    : "";
  const slashHits = input.startsWith("/")
    ? SLASH_SUGGESTIONS.filter((s) => s.startsWith(slashPrefix)).slice(0, 8)
    : [];
  const slashSel =
    slashHits.length > 0
      ? slashHits[Math.min(slashIdx, slashHits.length - 1)]!
      : null;

  const applySlashHit = (s: string) => {
    setInput(`/${s} `);
    setSlashOpen(false);
    setSlashIdx(0);
  };

  const providerOptions = (
    providers.length
      ? providers
      : meta?.provider
        ? [{ id: meta.provider }]
        : []
  ).filter((p) => p.id);
  const modelOptions = (
    models.length ? models : meta?.model ? [{ id: meta.model }] : []
  ).filter((m) => m.id);
  const canRetry = lines.some((l) => l.role === "user");
  const canSend = Boolean(input.trim());
  /** Draft ComposerBar: stop only when busy and empty draft */
  const showStopWire = busy && !canSend && pending.length === 0;
  /** 上下文占用百分比（仅保留一处模型选择：左侧 cascade） */
  const contextPct =
    contextUsage && contextUsage.max > 0
      ? Math.min(
          100,
          Math.max(0, Math.round((contextUsage.used / contextUsage.max) * 100)),
        )
      : null;
  // 右侧 status 不再回显模型名（cascade 已显示）；仅保留运行/错误等状态
  const statusDisplay = (() => {
    if (pending.length > 0) return "等待审批";
    if (busy) return "运行中";
    const s = (status || "").trim();
    if (!s) return "";
    if (/^模型\s/i.test(s)) return "";
    return s;
  })();
  const statusError = /error|失败|不可用|HTML|JSON|后端|API\s*\d|拒绝/i.test(
    statusDisplay,
  );

  const slashMenu = slashOpen && slashHits.length > 0 && (
    <div className="slash-menu" role="listbox">
      {slashHits.map((s, i) => (
        <button
          key={s}
          type="button"
          className={`slash-item${s === slashSel || i === slashIdx ? " active" : ""}`}
          onMouseDown={(e) => {
            e.preventDefault();
            applySlashHit(s);
          }}
        >
          /{s}
        </button>
      ))}
    </div>
  );

  const onComposerKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (slashOpen && slashHits.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIdx((i) => (i + 1) % slashHits.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIdx((i) => (i - 1 + slashHits.length) % slashHits.length);
        return;
      }
      if (e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        if (slashSel) applySlashHit(slashSel);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashOpen(false);
        return;
      }
    } else if (e.key === "Escape") {
      setSlashOpen(false);
    }
    // Ctrl/Cmd+Enter：强制插入模式
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
      e.preventDefault();
      void send("insert");
      return;
    }
    // Alt+Enter：切换发送模式
    if (e.key === "Enter" && e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      cycleSendMode();
      return;
    }
    // Enter：按当前发送模式发送
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      void send();
    }
  };

  const onComposerChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setInput(v);
    const open = v.startsWith("/") && !v.includes("\n");
    setSlashOpen(open);
    if (open) setSlashIdx(0);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 56), 180)}px`;
  };

  const usageClick = () => {
    setUsageModalOpen(true);
    setUsageModalLoading(true);
    setUsageModalError(null);
    setUsageModalRaw(null);
    void fetchSessionStats()
      .then((r) => {
        setUsageModalSessionId(r.sessionId);
        if (r.stats) {
          setUsageModalStats({
            messageCount: r.stats.messageCount,
            userTurns: r.stats.userTurns,
            assistantTurns: r.stats.assistantTurns,
            toolCalls: r.stats.toolCalls,
            inputTokens: r.stats.inputTokens,
            outputTokens: r.stats.outputTokens,
            cacheRead: r.stats.cacheRead,
            file: r.stats.file,
          });
        } else {
          setUsageModalStats(null);
          setUsageModalRaw(r.text || "（无 session stats）");
        }
        // Keep chip % in sync
        if (r.stats) {
          patchContextUsage({
            used: r.stats.inputTokens,
            max: maxContextRef.current,
          });
        }
      })
      .catch((err) => {
        setUsageModalStats(null);
        setUsageModalError(
          err instanceof Error ? err.message : String(err),
        );
      })
      .finally(() => setUsageModalLoading(false));
  };

  const sendModeLabel = sendMode === "insert" ? "插入" : "队列";
  const sendModeShortcut = sendMode === "insert" ? "⌃↵" : "↵";
  const sendModeTitle =
    sendMode === "insert"
      ? "插入模式：运行中 Enter 打断当前流并优先处理（MessageQueue interrupt_immediately）· 点击切换为队列 · Alt+Enter 切换 · Ctrl+Enter 强制插入"
      : "队列模式：运行中 Enter 等本轮结束后投递（MessageQueue after_round_complete）· 点击切换为插入 · Alt+Enter 切换 · Ctrl+Enter 强制插入";

  const outboxPanel =
    outbox.length > 0 ? (
      <div className="composer-outbox" role="list" aria-label="待发送与排队">
        <div className="composer-outbox-head">
          <span className="composer-outbox-title">
            {queueLen > 0 ? `${queueLen} 条排队` : ""}
            {queueLen > 0 && outbox.some((o) => o.status === "failed")
              ? " · "
              : ""}
            {outbox.some((o) => o.status === "failed")
              ? `${outbox.filter((o) => o.status === "failed").length} 条未发送`
              : ""}
          </span>
          {queueLen > 0 ? (
            <button
              type="button"
              className="ghost composer-outbox-clear"
              onClick={() => void clearOutboxQueued()}
              title="清空排队（不停止当前生成）"
            >
              清空排队
            </button>
          ) : null}
        </div>
        <ul className="composer-outbox-list">
          {outbox.map((item) => (
            <li
              key={item.localId}
              className={`composer-outbox-item is-${item.status}`}
              role="listitem"
            >
              <span
                className="composer-outbox-mode"
                title={
                  item.mode === "insert"
                    ? "插入 · interrupt_immediately"
                    : "队列 · after_round_complete"
                }
              >
                {item.status === "failed"
                  ? "失败"
                  : item.mode === "insert"
                    ? "插入"
                    : "队列"}
              </span>
              <span className="composer-outbox-text" title={item.error || item.text}>
                {item.text}
              </span>
              <span className="composer-outbox-actions">
                {item.status === "failed" ? (
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => retryOutboxItem(item)}
                    title="重试发送"
                  >
                    重试
                  </button>
                ) : null}
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void removeOutboxItem(item)}
                  title="移除"
                >
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  const sendModeControl = (
    <div className={`send-mode-control mode-${sendMode}`}>
      <button
        type="button"
        className="send-mode-toggle"
        onClick={cycleSendMode}
        title={sendModeTitle}
        aria-label={`发送模式 ${sendModeLabel}，点击切换`}
      >
        <span className="send-mode-name">{sendModeLabel}</span>
        <kbd className="send-mode-kbd">{sendModeShortcut}</kbd>
      </button>
      {showStopWire ? (
        <button
          type="button"
          className="ghost wire-icon-btn wire-composer-stop"
          onClick={() => void stopRun()}
          title="停止并清空排队 · 输入文字可改为发送"
          aria-label="停止"
        >
          <ChromeMark kind="stop" size={14} decorative />
        </button>
      ) : (
        <button
          type="button"
          className={`send-btn wire-icon-btn wire-composer-send mode-${sendMode}`}
          disabled={!canSend}
          onClick={() => void send()}
          aria-label={
            busy
              ? sendMode === "insert"
                ? "插入发送"
                : "排队发送"
              : "发送"
          }
          title={
            busy
              ? sendMode === "insert"
                ? "插入发送 (Enter) · 打断当前流"
                : "排队发送 (Enter) · 本轮结束后投递"
              : `发送 (Enter) · 模式 ${sendModeLabel}`
          }
        >
          <ChromeMark kind="send" size={15} decorative />
        </button>
      )}
    </div>
  );

  /** Wire: draft ComposerBar card layout (textarea + toolbar icons) */
  const wireComposer = (
    <div className="composer codex-composer wire-composer">
      {outboxPanel}
      <div className="composer-row-wrap">
        {slashMenu}
        <div
          className={`composer-row wire-composer-card${
            pending.length > 0 ? " has-pending-approval" : ""
          }${busy ? " is-busy" : ""}${sendMode === "insert" ? " mode-insert" : " mode-queue"}`}
        >
          <textarea
            ref={inputRef}
            className="wire-composer-input"
            value={input}
            rows={2}
            placeholder={
              pending.length > 0
                ? "可先输入下一条… 处理审批后发送"
                : busy
                  ? sendMode === "insert"
                    ? "运行中… Enter 插入打断 · Ctrl+Enter 同 · Alt+Enter 切队列"
                    : "运行中… Enter 排队 · Ctrl+Enter 插入打断 · Alt+Enter 切模式"
                  : "输入消息… Enter 发送，Shift+Enter 换行 · / 命令 · Alt+Enter 切模式"
            }
            onChange={onComposerChange}
            onKeyDown={onComposerKeyDown}
            onBlur={() => {
              window.setTimeout(() => setSlashOpen(false), 120);
            }}
          />
          <div className="composer-toolbar wire-composer-toolbar">
            <div className="composer-toolbar-left wire-composer-tools">
              <ModelCascadeMenu
                ref={modelMenuRef}
                className="wire-composer-model-cascade"
                provider={meta?.provider ?? ""}
                model={meta?.model ?? ""}
                providers={providerOptions}
                models={modelOptions}
                onSelect={onCascadeModelSelect}
                onModelsLoaded={(pid, list) => {
                  if (pid === (meta?.provider || pid)) setModels(list);
                }}
              />
              <ApprovalPhysicsSwitch
                className="wire-composer-approval-switch"
                value={approval}
                onChange={(mode) => void onApprovalChange(mode)}
              />
              <button
                type="button"
                className="usage-chip wire-composer-usage"
                title={
                  contextUsage
                    ? `上下文 ${contextUsage.used.toLocaleString()} / ${contextUsage.max.toLocaleString()} tokens · 点击打开用量详情`
                    : "上下文占用 · 点击打开用量详情"
                }
                onClick={usageClick}
              >
                {contextPct != null ? `上下文 ${contextPct}%` : "上下文 —"}
              </button>
              <span className="wire-composer-tool-sep" aria-hidden />
              <button
                type="button"
                className="composer-tool-btn"
                disabled={!canRetry}
                onClick={() => retryLastUser()}
                title="重试上一条"
                aria-label="重试上一条"
              >
                <ChromeMark kind="retry" size={14} decorative />
              </button>
              <button
                type="button"
                className="composer-tool-btn"
                onClick={() =>
                  void exportTranscript()
                    .then((t) => copyToClipboard(t))
                    .then(() => setStatus("已复制 transcript"))
                    .catch((err) =>
                      setStatus(
                        err instanceof Error ? err.message : String(err),
                      ),
                    )
                }
                title="复制 transcript"
                aria-label="复制 transcript"
              >
                <ChromeMark kind="copy" size={14} decorative />
              </button>
            </div>
            <div className="composer-toolbar-right wire-composer-actions">
              {statusDisplay ? (
                <span
                  className={`composer-status${statusError ? " is-error" : ""}${
                    pending.length > 0 ? " is-approval" : ""
                  }${busy && !statusError ? " is-busy" : ""}`}
                  title={statusDisplay}
                >
                  {busy && !statusError ? (
                    <span className="composer-status-dot" aria-hidden />
                  ) : null}
                  <span className="composer-status-text">{statusDisplay}</span>
                </span>
              ) : null}
              {sendModeControl}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const composer = isWire ? (
    wireComposer
  ) : (
    <div className={`composer${isCodex ? " codex-composer" : ""}`}>
      {outboxPanel}
      {isCodex && (
        <div className="composer-chips">
          <ModelCascadeMenu
            ref={modelMenuRef}
            provider={meta?.provider ?? ""}
            model={meta?.model ?? ""}
            providers={providerOptions}
            models={modelOptions}
            onSelect={onCascadeModelSelect}
            onModelsLoaded={(pid, list) => {
              if (pid === (meta?.provider || pid)) setModels(list);
            }}
          />
          <ApprovalPhysicsSwitch
            value={approval}
            onChange={(mode) => void onApprovalChange(mode)}
          />
          <button
            type="button"
            className="usage-chip"
            title={
              contextUsage
                ? `上下文 ${contextUsage.used.toLocaleString()} / ${contextUsage.max.toLocaleString()} tokens · 点击查看 /usage`
                : "上下文占用 · 点击查看 /usage"
            }
            onClick={usageClick}
          >
            {contextPct != null ? `上下文 ${contextPct}%` : "上下文 —"}
          </button>
          {statusDisplay && !/^模型\s/i.test(statusDisplay) ? (
            <span
              className={`composer-status${statusError ? " is-error" : ""}`}
              title={statusDisplay}
            >
              {statusDisplay}
            </span>
          ) : null}
        </div>
      )}
      <div className="composer-row-wrap">
        {slashMenu}
        <div className="composer-row">
          <textarea
            ref={inputRef}
            value={input}
            placeholder={
              busy
                ? sendMode === "insert"
                  ? "Running… Enter inserts (interrupt) · Ctrl+Enter same · Alt+Enter toggle mode"
                  : "Running… Enter queues · Ctrl+Enter inserts · Alt+Enter toggle mode"
                : isCodex
                  ? "Message agent…  (Enter to send · Shift+Enter newline · / commands)"
                  : "消息或 /命令…（Enter 发送 · Shift+Enter 换行）"
            }
            onChange={onComposerChange}
            onKeyDown={onComposerKeyDown}
            onBlur={() => {
              window.setTimeout(() => setSlashOpen(false), 120);
            }}
            rows={isCodex ? 3 : 2}
          />
          {busy && !canSend ? (
            <button
              type="button"
              className="ghost"
              onClick={() => void stopRun()}
              title="停止并清空排队"
            >
              Stop
            </button>
          ) : null}
          <button
            type="button"
            className="send-mode-toggle"
            onClick={cycleSendMode}
            title={sendModeTitle}
          >
            {sendModeLabel}
            <kbd className="send-mode-kbd">{sendModeShortcut}</kbd>
          </button>
          <button
            type="button"
            className={`send-btn mode-${sendMode}`}
            onClick={() => void send()}
            disabled={!canSend}
            title={
              busy
                ? sendMode === "insert"
                  ? "Insert (Enter)"
                  : "Queue (Enter)"
                : "Send (Enter)"
            }
          >
            {busy
              ? sendMode === "insert"
                ? "Insert"
                : "Queue"
              : "Send"}
          </button>
        </div>
      </div>
    </div>
  );

  const rootExtra = className ? ` ${className}` : "";

  // legacy default layout
  if (!isCodex) {
    return (
      <div className={`panel chat-panel${rootExtra}`.trim()}>
        <div className="panel-header chat-toolbar">
          <span className="chat-toolbar-title">Chat</span>
          <button
            type="button"
            className="ghost tb-btn"
            onClick={() => void onNewSession()}
            title={busy ? "将停止当前生成" : "新会话"}
          >
            新会话
          </button>
          {status ? <span className="tb-status">{status}</span> : null}
        </div>
        {approvalBlock}
        {messageList}
        {composer}
      </div>
    );
  }

  const composerDock = (
    <div
      className={`codex-composer-dock${isWire ? " wire-composer-dock" : ""}`}
    >
      {/* Wire: retry/copy live in ComposerBar-style toolbar; codex keeps links */}
      {!isWire ? (
        <div className="thread-actions">
          <button
            type="button"
            className="ghost-link"
            onClick={() => retryLastUser()}
            title={busy ? "忙碌时入队重试" : "R · 重试上一条"}
          >
            Retry last
          </button>
          <button
            type="button"
            className="ghost-link"
            onClick={() =>
              void exportTranscript()
                .then((t) => copyToClipboard(t))
                .then(() => setStatus("已复制 transcript"))
                .catch((err) =>
                  setStatus(err instanceof Error ? err.message : String(err)),
                )
            }
          >
            Copy transcript
          </button>
        </div>
      ) : null}
      {composer}
    </div>
  );

  return (
    <div
      className={`chat-panel codex-chat${rootExtra}${
        busy ? " has-busy" : ""
      }${pending.length > 0 ? " has-approval" : ""}${
        showBackToBottom && isWire ? " has-jump" : ""
      }`.trim()}
      aria-label={isWire ? "上下文" : undefined}
    >
      {railHost && threadRail ? createPortal(threadRail, railHost) : null}
      {/* Draft wire: busy lives in bottom dock + composer stop — no top stream-banner */}
      {busy && !isWire ? (
        <div className="stream-banner" role="status">
          <span className="stream-dot" />
          Agent running…
          {queueLen > 0 ? (
            <span className="queue-badge">{queueLen} queued</span>
          ) : null}
          <button
            type="button"
            className="linkish"
            onClick={() => void stopRun()}
          >
            Stop
          </button>
        </div>
      ) : null}
      {/* Draft ContextPanel: jump-prev at top when scrolled */}
      {isWire && showJumpPrev ? (
        <button
          type="button"
          className="wire-jump-prev"
          onClick={jumpPrevUser}
          title="跳转到上一条用户消息"
          aria-label={jumpPrevLabel}
        >
          <span className="wire-jump-prev-text">{jumpPrevLabel}</span>
        </button>
      ) : null}
      {isWire ? (
        <SessionTreeCrumbs
          sessions={sessions}
          activeSessionId={meta?.sessionId ?? null}
          runningSessionIds={runningSessionIds}
          onSelect={(id) => {
            void onSessionChange(id);
          }}
        />
      ) : null}
      {!isWire ? approvalBlock : null}
      <div
        className={`codex-thread-scroll${
          isWire ? " wire-thread-scroll" : ""
        }`}
      >
        {messageList}
      </div>
      {isWire && showBackToBottom ? (
        <button
          type="button"
          className="wire-jump-bottom"
          onClick={scrollThreadToBottom}
          title="回到底部"
          aria-label="回到底部"
        >
          ↓ 回到底部
        </button>
      ) : null}
      {isWire ? (
        <div className="wire-float wire-float-bottom">
          {approvalBlock}
          {composerDock}
        </div>
      ) : (
        composerDock
      )}
      {createPortal(
        <SessionUsageModal
          open={usageModalOpen}
          onClose={() => setUsageModalOpen(false)}
          sessionId={usageModalSessionId}
          stats={usageModalStats}
          maxContext={maxContextRef.current}
          loading={usageModalLoading}
          error={usageModalError}
          rawText={usageModalRaw}
        />,
        document.body,
      )}
    </div>
  );
}

function relativeTime(iso?: string, wire = false): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return wire ? "刚刚" : "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}${wire ? "分前" : "m ago"}`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}${wire ? "时前" : "h ago"}`;
  if (sec < 86400 * 7)
    return `${Math.floor(sec / 86400)}${wire ? "天前" : "d ago"}`;
  return String(iso).slice(5, 10);
}

function ThreadRail(props: {
  sessions: SessionSummary[];
  activeId: string | null;
  busy: boolean;
  /** 正在生成的会话（图标着色） */
  runningSessionIds?: string[];
  wire?: boolean;
  agentLabel?: string;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
}) {
  const wire = Boolean(props.wire);
  const running = new Set(props.runningSessionIds ?? []);
  const busyHint = props.busy
    ? wire
      ? " · 当前会话运行中（其它会话可并行）"
      : " · current session running (others keep going)"
    : "";
  const untitled = wire ? "未命名" : "Untitled";
  return (
    <div
      className={`thread-rail${props.busy ? " is-busy" : ""}${
        wire ? " wire-session-list" : ""
      }${running.size > 0 ? " has-running" : ""}`}
      aria-label={
        wire
          ? props.agentLabel
            ? `${props.agentLabel} 的会话`
            : "会话列表"
          : "Sessions"
      }
    >
      <div className={wire ? "wire-new-task-wrap" : undefined}>
        <button
          type="button"
          className={wire ? "wire-new-task-btn thread-new" : "thread-new"}
          onClick={props.onNew}
          title={
            wire ? `新建会话${busyHint}` : `New task${busyHint}`
          }
        >
          {wire ? "新建会话" : "New task"}
        </button>
      </div>
      <div
        className={
          wire ? "wire-pane-title thread-list-label" : "thread-list-label"
        }
      >
        {wire ? (
          <span className="wire-pane-title-with-icon">
            会话
            {props.agentLabel ? (
              <span className="wire-session-agent-label">
                {props.agentLabel}
              </span>
            ) : null}
          </span>
        ) : (
          "Sessions"
        )}
      </div>
      <div className={wire ? "wire-session-scroll" : "thread-list"}>
        {props.sessions.length === 0 && (
          <div className={wire ? "wire-empty sm" : "thread-empty"}>
            {wire
              ? props.agentLabel
                ? `暂无 ${props.agentLabel} 的会话`
                : "暂无会话"
              : "No sessions yet"}
          </div>
        )}
        {props.sessions.map((s) => {
          const active = s.id === props.activeId;
          const isRunning = running.has(s.id);
          const title = (s.title || untitled).trim() || untitled;
          const when = relativeTime(s.lastMsgAt || s.updatedAt, wire);
          const countHint =
            s.messageCount > 0
              ? wire
                ? `${s.messageCount} 条消息`
                : `${s.messageCount} message${s.messageCount === 1 ? "" : "s"}`
              : wire
                ? "空会话"
                : "Empty session";
          // Wire = SessionList single-line row (title · time). Never mix
          // thread-item column CSS with wire-session-btn 32px row — that
          // clipped Chinese glyphs into garbage (see live shell session rail).
          if (wire) {
            return (
              <div
                key={s.id}
                className={`wire-session-row${active ? " active" : ""}${
                  isRunning ? " is-running" : ""
                }`}
              >
                <button
                  type="button"
                  className="wire-session-btn"
                  onClick={() => props.onSelect(s.id)}
                  onDoubleClick={() => props.onRename(s.id, title)}
                  title={`${title} · ${countHint}${when ? ` · ${when}` : ""}${
                    isRunning ? " · 生成中" : ""
                  }`}
                >
                  <span
                    className={`wire-session-icon${isRunning ? " is-running" : ""}`}
                    aria-hidden
                    title={isRunning ? "生成中" : undefined}
                  >
                    <ChromeMark kind="session" size={13} decorative />
                  </span>
                  <span className="wire-session-title">{title}</span>
                  <span className="wire-session-time">
                    {isRunning ? "运行中" : when || countHint}
                  </span>
                </button>
                <button
                  type="button"
                  className="wire-session-del"
                  title="删除会话"
                  aria-label="删除会话"
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onDelete(s.id);
                  }}
                >
                  ×
                </button>
              </div>
            );
          }
          return (
            <div
              key={s.id}
              className={`thread-item-row${active ? " active" : ""}${
                isRunning ? " is-running" : ""
              }`}
            >
              <button
                type="button"
                className="thread-item"
                onClick={() => props.onSelect(s.id)}
                onDoubleClick={() => props.onRename(s.id, title)}
                title={`Double-click to rename${isRunning ? " · running" : ""}`}
              >
                <span
                  className={`thread-run-dot${isRunning ? " is-on" : ""}`}
                  aria-hidden
                />
                <span className="thread-title">{title.slice(0, 40)}</span>
                <span className="thread-meta">
                  <span className="thread-meta-sub">{countHint}</span>
                  <span className="thread-meta-time">{when}</span>
                </span>
              </button>
              <button
                type="button"
                className="thread-del"
                title={`Delete session${busyHint}`}
                aria-label="Delete session"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onDelete(s.id);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
