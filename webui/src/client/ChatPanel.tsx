/**
 * ChatPanel —— CLI 工作流对齐 + Codex-desktop 布局
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
  clearSession,
  createSession,
  deleteSession,
  exportTranscript,
  fetchApproval,
  fetchMeta,
  fetchModels,
  fetchSessionStats,
  fetchSessions,
  renameSession,
  runCommand,
  setApprovalMode,
  setModel,
  streamChat,
  switchSession,
  type ApprovalMode,
  type ChatHistoryLine,
  type Meta,
  type PendingApproval,
  type SessionSummary,
  type StreamEvent,
} from "./api";
import {
  buildPrevUserJumpLabel,
  shouldShowJumpBar,
} from "./drafts/jump-prev-user";
import {
  WireThreadView,
  chatLinesToDraftMessages,
} from "./drafts/panels/WireThreadView";
import { ApprovalBanner } from "./drafts/panels/ApprovalBanner";
import { ChromeMark } from "./drafts/icons/Marks";
import type { DraftApproval } from "./drafts/types";

export type ChatLine = {
  id: string;
  role: "user" | "assistant" | "system" | "tool" | "thinking";
  text: string;
  err?: boolean;
  terminalId?: string;
  agentName?: string;
  /** 可一点重试的用户原文（error 行） */
  retryText?: string;
};

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
    return {
      id: m.id || uid(),
      role: role as ChatLine["role"],
      text: m.content || "",
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
  "/goal [任务] — 监督模式（若 Runtime 启用）",
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
  "goal",
  "help",
] as const;

/** Cap pending user messages while a turn is running */
const MAX_QUEUE = 20;

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
  const setBusy = useCallback(
    (v: boolean) => {
      setBusyState(v);
      onBusyChange?.(v);
    },
    [onBusyChange],
  );
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
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);
  const [queueLen, setQueueLen] = useState(0);
  const [railEl, setRailEl] = useState<HTMLElement | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const modelSelectRef = useRef<HTMLSelectElement>(null);
  const stickBottomRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  /** Guards double-Enter before busyRef flips inside runUserMessage */
  const inFlightSendRef = useRef(false);
  const queueRef = useRef<string[]>([]);
  const lastUserRef = useRef("");
  /** Incremented on stop / session switch to drop stale stream finally + queue drain */
  const runGenRef = useRef(0);

  const focusComposer = useCallback(() => {
    // Defer so layout/portal settle after session switch
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, []);

  // Portal target for thread list (sidebar mounts independently)
  useEffect(() => {
    if (!threadRailId) {
      setRailEl(null);
      return;
    }
    const pick = () => document.getElementById(threadRailId);
    setRailEl(pick());
    const t = window.setInterval(() => {
      const el = pick();
      setRailEl((prev) => (prev === el ? prev : el));
    }, 200);
    return () => clearInterval(t);
  }, [threadRailId]);

  const pushMeta = useCallback(
    (m: Meta) => {
      setMeta(m);
      onMetaChange?.(m);
    },
    [onMetaChange],
  );

  const refreshSessions = useCallback(async () => {
    const s = await fetchSessions();
    setSessions(s.sessions);
    return s;
  }, []);

  // Push active session title to shell topbar
  useEffect(() => {
    if (!onSessionTitleChange) return;
    const id = meta?.sessionId;
    if (!id) {
      onSessionTitleChange(null);
      return;
    }
    const hit = sessions.find((x) => x.id === id);
    onSessionTitleChange(hit?.title || null);
  }, [meta?.sessionId, sessions, onSessionTitleChange]);

  const refreshApproval = useCallback(async () => {
    const a = await fetchApproval();
    setApproval(a.mode);
    setPending(a.pending);
    return a;
  }, []);

  const bootstrap = useCallback(async () => {
    try {
      const m = await fetchMeta();
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
      setProviders(md.providers.length ? md.providers : m.providers ?? []);
      setModels(md.models);
      await refreshSessions();
      await refreshApproval();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  }, [pushMeta, refreshApproval, refreshSessions]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

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
    if (!onDockLogLines) return;
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
    onDockLogLines(
      bag.length
        ? bag
        : busy
          ? ["[status] agent running…"]
          : ["[status] idle · no system lines"],
    );
  }, [lines, busy, onDockLogLines]);

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

  const enqueueMessage = useCallback(
    (text: string, note?: string) => {
      if (queueRef.current.length >= MAX_QUEUE) {
        setStatus(`队列已满（${MAX_QUEUE}）`);
        append({
          id: uid(),
          role: "system",
          text: `队列已满（最多 ${MAX_QUEUE} 条），请等待当前回合或 Stop`,
          err: true,
        });
        return false;
      }
      queueRef.current.push(text);
      setQueueLen(queueRef.current.length);
      setStatus(note || `已排队 #${queueRef.current.length}`);
      append({
        id: uid(),
        role: "system",
        text: `… 已排队（第 ${queueRef.current.length} 条）: ${text.slice(0, 80)}${text.length > 80 ? "…" : ""}`,
      });
      return true;
    },
    [append],
  );

  const patchLastAssistant = useCallback((delta: string) => {
    setLines((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i]!.role === "assistant") {
          next[i] = { ...next[i]!, text: next[i]!.text + delta };
          return next;
        }
      }
      next.push({ id: uid(), role: "assistant", text: delta });
      return next;
    });
  }, []);

  const patchLastThinking = useCallback((delta: string) => {
    setLines((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i]!.role === "thinking") {
          next[i] = { ...next[i]!, text: next[i]!.text + delta };
          return next;
        }
      }
      next.push({ id: uid(), role: "thinking", text: delta });
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
            const last = next[next.length - 1];
            if (last?.role === "assistant" && !last.text) {
              next[next.length - 1] = { ...last, text: content };
              return next;
            }
            if (last?.role === "assistant" && content.startsWith(last.text)) {
              next[next.length - 1] = { ...last, text: content };
              return next;
            }
            next.push({ id: uid(), role: "assistant", text: content });
            return next;
          });
          break;
        }
        case "tool_call": {
          const tool = ev.tool as {
            name?: string;
            parameters?: Record<string, unknown>;
          } | undefined;
          const name =
            tool?.name ??
            String(ev.name ?? (ev as { tool_name?: string }).tool_name ?? "tool");
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
          const isTerm = name === "use_terminal" || name === "bash";
          append({
            id: uid(),
            role: "tool",
            text: `▶ ${name}${desc ? ` · ${desc}` : ""}`,
            terminalId: isTerm ? tid : undefined,
            agentName: defaultAgent,
          });
          break;
        }
        case "tool_result": {
          const name = String(
            ev.name ?? (ev as { tool_name?: string }).tool_name ?? "tool",
          );
          const ok = ev.ok !== false;
          const tid = extractTerminalId(ev);
          const snippet = String(ev.content ?? ev.result ?? "").slice(0, 200);
          append({
            id: uid(),
            role: "tool",
            text: `${ok ? "✓" : "✗"} ${name}${tid ? ` · ${tid}` : ""}${snippet ? `\n${snippet}` : ""}`,
            err: !ok,
            terminalId: tid,
            agentName: defaultAgent,
          });
          // DESIGN: use_terminal 会话可在右侧附着；有 id 时自动打开终端面板
          if (tid && onOpenTerminal) {
            onOpenTerminal(tid, defaultAgent);
          }
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
          if (inn || out) {
            setTurnUsage((prev) => ({
              in: (prev?.in ?? 0) + (Number.isFinite(inn) ? inn : 0),
              out: (prev?.out ?? 0) + (Number.isFinite(out) ? out : 0),
            }));
          }
          break;
        }
        case "done": {
          const u = ev.usage as Record<string, unknown> | undefined;
          if (u) {
            const inn = Number(u.prompt_tokens ?? u.input ?? 0);
            const out = Number(u.completion_tokens ?? u.output ?? 0);
            if (inn || out) setTurnUsage({ in: inn, out });
          }
          break;
        }
        case "error":
          append({
            id: uid(),
            role: "system",
            text: String(ev.message ?? ev.error ?? "error"),
            err: true,
            retryText: lastUserRef.current || undefined,
          });
          break;
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
        case "log": {
          const msg = String(ev.message ?? ev.content ?? "");
          if (!msg) break;
          const level = String(ev.level ?? "info");
          if (level === "error" || level === "warning") {
            append({
              id: uid(),
              role: "system",
              text: msg,
              err: level === "error",
            });
          } else if (
            // Surface context compress / model switch (CLI shows these)
            /压缩|归档|模型切换|compact|archive|summaryStage|archiveStage/i.test(
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
      onOpenTerminal,
      onMetaChange,
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
      abortRef.current?.abort();
      try {
        await abortChat();
      } catch {
        /* ignore */
      }
      try {
        await runCommand("stop");
      } catch {
        /* ignore */
      }
      queueRef.current = [];
      setQueueLen(0);
      busyRef.current = false;
      setBusy(false);
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

  const runUserMessage = useCallback(
    async (text: string) => {
      const gen = ++runGenRef.current;
      lastUserRef.current = text;
      // New turn: re-stick so stream stays in view after history review
      stickBottomRef.current = true;
      append({ id: uid(), role: "user", text });
      append({ id: uid(), role: "assistant", text: "" });
      busyRef.current = true;
      setBusy(true);
      setTurnUsage(null);
      setSlashOpen(false);
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        for await (const ev of streamChat(text, ac.signal)) {
          if (gen !== runGenRef.current) break;
          onEvent(ev);
        }
        if (gen === runGenRef.current) {
          void refreshApproval();
          void refreshSessions();
        }
      } catch (e) {
        if (gen === runGenRef.current && (e as Error)?.name !== "AbortError") {
          append({
            id: uid(),
            role: "system",
            text: e instanceof Error ? e.message : String(e),
            err: true,
            retryText: text,
          });
        }
      } finally {
        // Stale run after stop/session switch: do not touch busy or drain queue
        if (gen !== runGenRef.current) {
          return;
        }
        busyRef.current = false;
        setBusy(false);
        abortRef.current = null;
        setLines((prev) =>
          prev.filter((l) => !(l.role === "assistant" && !l.text.trim())),
        );
        // drain queue
        const next = queueRef.current.shift();
        setQueueLen(queueRef.current.length);
        if (next) void runUserMessage(next);
      }
    },
    [append, onEvent, refreshApproval, refreshSessions],
  );

  const clearQueue = useCallback(() => {
    const n = queueRef.current.length;
    if (!n) return;
    queueRef.current = [];
    setQueueLen(0);
    setStatus(`已清空 ${n} 条排队（生成继续）`);
  }, []);

  const stopRun = useCallback(async (announce = true) => {
    // Bump generation so in-flight runUserMessage finally skips queue drain
    runGenRef.current += 1;
    inFlightSendRef.current = false;
    abortRef.current?.abort();
    try {
      await abortChat();
    } catch {
      /* ignore */
    }
    queueRef.current = [];
    setQueueLen(0);
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
  }, [refreshApproval]);

  const send = async () => {
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

    // Busy or send already in-flight: queue (prevents double-Enter dual streams)
    if (busyRef.current || inFlightSendRef.current) {
      enqueueMessage(text);
      return;
    }

    inFlightSendRef.current = true;
    try {
      await runUserMessage(text);
    } finally {
      inFlightSendRef.current = false;
    }
  };

  const onSessionChange = async (id: string) => {
    if (!id) return;
    // Abort turn + drop queue so queued msgs don't land on the wrong session
    await stopRun(false);
    try {
      const r = await switchSession(id);
      pushMeta(r.meta);
      setLines(historyToLines(r.messages));
      setTurnUsage(null);
      stickBottomRef.current = true;
      await refreshSessions();
      setStatus(`切换会话 ${id.slice(0, 8)}…`);
      focusComposer();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  };

  const onNewSession = async () => {
    await stopRun(false);
    const r = await createSession();
    pushMeta(r.meta);
    setLines([]);
    setTurnUsage(null);
    stickBottomRef.current = true;
    await refreshSessions();
    setStatus("新会话");
    focusComposer();
  };

  const onDeleteSession = async (id: string) => {
    if (!id) return;
    if (!window.confirm(`删除会话 ${id.slice(0, 12)}…？`)) return;
    await stopRun(false);
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
      enqueueMessage(msg, "重试已排队");
      return;
    }
    inFlightSendRef.current = true;
    void runUserMessage(msg).finally(() => {
      inFlightSendRef.current = false;
    });
  };

  // Global shortcuts (Codex/CLI-like workflow — not full CLI chrome)
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
      // Ctrl+M — focus model select (CLI /model hotkey parity)
      if (mod && e.key.toLowerCase() === "m" && !e.shiftKey) {
        e.preventDefault();
        modelSelectRef.current?.focus();
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

  const onProviderChange = async (provider: string) => {
    const md = await fetchModels(provider);
    setModels(md.models);
    const first = md.models[0]?.id;
    if (first) {
      const m = await setModel(provider, first);
      pushMeta(m);
    }
  };

  const onModelChange = async (model: string) => {
    const provider = meta?.provider || providers[0]?.id || "";
    if (!provider || !model) return;
    const m = await setModel(provider, model);
    pushMeta(m);
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
          className={`bubble ${l.role}${l.err ? " err" : ""}${l.role === "tool" ? " tool-line" : ""}${l.terminalId ? " clickable" : ""}${isCodex ? " codex-bubble" : ""}`}
          data-msg-id={l.id}
          data-msg-role={l.role}
          data-msg-preview={
            l.role === "user"
              ? (l.text || "").replace(/\s+/g, " ").trim().slice(0, 64)
              : undefined
          }
          onClick={() => {
            if (l.terminalId && onOpenTerminal) {
              onOpenTerminal(l.terminalId, l.agentName);
            }
          }}
          title={l.terminalId ? `Open terminal ${l.terminalId}` : undefined}
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
  const statusError = /error|失败|不可用|HTML|JSON|后端|API\s*\d|拒绝/i.test(
    status,
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
    if (e.key === "Enter" && !e.shiftKey) {
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
    // Prefer dedicated stats route; fall back to /api/command usage
    void fetchSessionStats()
      .then((r) => {
        const text =
          r.text ||
          (r.stats
            ? JSON.stringify(r.stats, null, 0)
            : "（无 session stats）");
        append({ id: uid(), role: "system", text });
      })
      .catch(() =>
        runCommand("usage")
          .then((r) => {
            const text =
              typeof r.text === "string"
                ? r.text
                : JSON.stringify(r).slice(0, 400);
            append({ id: uid(), role: "system", text });
          })
          .catch((err) =>
            setStatus(err instanceof Error ? err.message : String(err)),
          ),
      );
  };

  /** Wire: draft ComposerBar card layout (textarea + toolbar icons) */
  const wireComposer = (
    <div className="composer codex-composer wire-composer">
      <div className="composer-row-wrap">
        {slashMenu}
        <div
          className={`composer-row wire-composer-card${
            pending.length > 0 ? " has-pending-approval" : ""
          }${busy ? " is-busy" : ""}`}
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
                  ? "运行中也可输入… Enter 发送（将排队）"
                  : "输入消息… Enter 发送，Shift+Enter 换行 · / 命令"
            }
            onChange={onComposerChange}
            onKeyDown={onComposerKeyDown}
            onBlur={() => {
              window.setTimeout(() => setSlashOpen(false), 120);
            }}
          />
          <div className="composer-toolbar wire-composer-toolbar">
            <div className="composer-toolbar-left wire-composer-tools">
              <label className="chip-select wire-composer-chip">
                <span className="visually-hidden">Provider</span>
                <select
                  value={meta?.provider ?? ""}
                  onChange={(e) => void onProviderChange(e.target.value)}
                  title="Provider · 下一轮生效"
                  aria-label="Provider"
                >
                  {providerOptions.length === 0 ? (
                    <option value="" disabled>
                      未连接后端
                    </option>
                  ) : (
                    providerOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name || p.id}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <label className="chip-select wire-composer-chip">
                <span className="visually-hidden">模型</span>
                <select
                  ref={modelSelectRef}
                  value={meta?.model ?? ""}
                  onChange={(e) => void onModelChange(e.target.value)}
                  title="模型 · Ctrl+M"
                  aria-label="模型"
                >
                  {modelOptions.length === 0 ? (
                    <option value="" disabled>
                      —
                    </option>
                  ) : (
                    modelOptions.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name || m.id}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <label className="chip-select wire-composer-chip">
                <span className="visually-hidden">Approval</span>
                <select
                  value={approval}
                  onChange={(e) =>
                    void onApprovalChange(e.target.value as ApprovalMode)
                  }
                  title="审批模式"
                  aria-label="Approval"
                >
                  <option value="normal">normal</option>
                  <option value="auto">auto</option>
                  <option value="yolo">yolo</option>
                </select>
              </label>
              {turnUsage ? (
                <button
                  type="button"
                  className="usage-chip wire-composer-usage"
                  title="点击查看会话 /usage"
                  onClick={usageClick}
                >
                  ↑{turnUsage.in.toLocaleString()} ↓
                  {turnUsage.out.toLocaleString()}
                </button>
              ) : (
                <span
                  className="usage-chip wire-composer-usage"
                  title="上下文用量"
                >
                  {busy ? "运行中" : meta?.model || "ready"}
                </span>
              )}
              {queueLen > 0 ? (
                <button
                  type="button"
                  className="queue-badge"
                  title="点击清空排队（不停止当前生成）"
                  onClick={() => clearQueue()}
                >
                  {queueLen} 排队
                </button>
              ) : null}
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
              <span
                className={`composer-status${statusError ? " is-error" : ""}${
                  pending.length > 0 ? " is-approval" : ""
                }`}
                title={status || undefined}
              >
                {pending.length > 0
                  ? "等待审批"
                  : busy
                    ? "运行中"
                    : status || ""}
              </span>
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
                  className="send-btn wire-icon-btn wire-composer-send"
                  disabled={!canSend}
                  onClick={() => void send()}
                  aria-label={busy ? "排队发送" : "发送"}
                  title={
                    busy
                      ? "排队发送 (Enter)"
                      : "发送 (Enter)"
                  }
                >
                  <ChromeMark kind="send" size={15} decorative />
                </button>
              )}
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
      {isCodex && (
        <div className="composer-chips">
          <label className="chip-select">
            <span>Model</span>
            <select
              value={meta?.provider ?? ""}
              onChange={(e) => void onProviderChange(e.target.value)}
              title="下一轮生效"
            >
              {providerOptions.length === 0 ? (
                <option value="" disabled>
                  未连接后端
                </option>
              ) : (
                providerOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name || p.id}
                  </option>
                ))
              )}
            </select>
          </label>
          <label className="chip-select">
            <span> </span>
            <select
              ref={modelSelectRef}
              value={meta?.model ?? ""}
              onChange={(e) => void onModelChange(e.target.value)}
              title="下一轮生效 · Ctrl+M"
            >
              {modelOptions.length === 0 ? (
                <option value="" disabled>
                  —
                </option>
              ) : (
                modelOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name || m.id}
                  </option>
                ))
              )}
            </select>
          </label>
          <label className="chip-select">
            <span>Approval</span>
            <select
              value={approval}
              onChange={(e) =>
                void onApprovalChange(e.target.value as ApprovalMode)
              }
              title="审批模式（可随时切换）"
            >
              <option value="normal">normal</option>
              <option value="auto">auto</option>
              <option value="yolo">yolo</option>
            </select>
          </label>
          {turnUsage ? (
            <button
              type="button"
              className="usage-chip"
              title="点击查看会话 /usage"
              onClick={usageClick}
            >
              ↑{turnUsage.in.toLocaleString()} ↓
              {turnUsage.out.toLocaleString()}
            </button>
          ) : null}
          {queueLen > 0 ? (
            <button
              type="button"
              className="queue-badge"
              title="点击清空排队（不停止当前生成）"
              onClick={() => clearQueue()}
            >
              {queueLen} queued · clear
            </button>
          ) : null}
          {status ? (
            <span
              className={`composer-status${statusError ? " is-error" : ""}`}
              title={status}
            >
              {status}
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
                ? isCodex
                  ? "Agent running… type to queue next message (Enter)"
                  : "生成中…输入将排队，Enter 入队"
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
          {busy ? (
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
            className="send-btn"
            onClick={() => void send()}
            disabled={!canSend}
            title={busy ? "排队发送" : "发送"}
          >
            {busy ? "Queue" : "Send"}
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
  wire?: boolean;
  agentLabel?: string;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
}) {
  const wire = Boolean(props.wire);
  const busyHint = props.busy
    ? wire
      ? " · 将停止当前生成"
      : " · stops current run"
    : "";
  const untitled = wire ? "未命名" : "Untitled";
  return (
    <div
      className={`thread-rail${props.busy ? " is-busy" : ""}${
        wire ? " wire-session-list" : ""
      }`}
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
      <div className={wire ? "wire-session-scroll thread-list" : "thread-list"}>
        {props.sessions.length === 0 && (
          <div className={wire ? "wire-empty sm thread-empty" : "thread-empty"}>
            {wire
              ? props.agentLabel
                ? `暂无 ${props.agentLabel} 的会话`
                : "暂无会话"
              : "No sessions yet"}
          </div>
        )}
        {props.sessions.map((s) => {
          const active = s.id === props.activeId;
          const sub =
            s.messageCount > 0
              ? wire
                ? `${s.messageCount} 条消息`
                : `${s.messageCount} message${s.messageCount === 1 ? "" : "s"}`
              : wire
                ? "空会话"
                : "Empty session";
          return (
            <div
              key={s.id}
              className={`thread-item-row${wire ? " wire-session-row" : ""}${
                active ? " active" : ""
              }`}
            >
              <button
                type="button"
                className={wire ? "wire-session-btn thread-item" : "thread-item"}
                onClick={() => props.onSelect(s.id)}
                onDoubleClick={() =>
                  props.onRename(s.id, s.title || untitled)
                }
                title={
                  wire
                    ? `双击重命名${busyHint}`
                    : `Double-click to rename${busyHint}`
                }
              >
                <span
                  className={
                    wire ? "wire-session-title thread-title" : "thread-title"
                  }
                >
                  {(s.title || untitled).slice(0, 40)}
                </span>
                <span
                  className={
                    wire ? "wire-session-time thread-meta" : "thread-meta"
                  }
                >
                  <span className="thread-meta-sub">{sub}</span>
                  <span className="thread-meta-time">
                    {relativeTime(s.lastMsgAt || s.updatedAt, wire)}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className={wire ? "wire-session-del thread-del" : "thread-del"}
                title={
                  wire ? `删除会话${busyHint}` : `Delete session${busyHint}`
                }
                aria-label={wire ? "删除会话" : "Delete session"}
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
