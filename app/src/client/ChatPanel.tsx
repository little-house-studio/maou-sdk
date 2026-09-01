/**
 * ChatPanel —— CLI 工作流 + 桌面聊天布局
 * wire chrome reuses draft DraftMarkdown / RoleAvatar / ToolCard for shell parity.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { useAppPorts } from "./ports";
import type {
  ApprovalMode,
  ChatHistoryLine,
  ChatImage,
  ChatSendMode,
  Meta,
  PendingApproval,
  PendingAsk,
  SessionMessagePage,
  SessionSummary,
  StreamEvent,
} from "./api";
import { searchSessions, type SessionSearchHit } from "./api";
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
import {
  isModelCallProgressText,
  isPlaceholderAssistantBody,
} from "./drafts/thread-blocks";
import type { PayloadRequest } from "./drafts/panels/WireThreadView";
import {
  asToolParams,
  extractToolCallIntent,
  readToolIntent,
} from "./drafts/tool-card";
import {
  applySessionPayloadIndex,
  fetchSessionPayloadDetail,
  fetchSessionPayloadIndex,
} from "./session-payloads";
import type { PayloadDetail } from "./session-payloads";
import { PayloadInspector } from "./PayloadInspector";
import {
  applySessionToolMeta,
  fetchSessionToolMeta,
} from "./session-intents";
import { ApprovalBanner } from "./drafts/panels/ApprovalBanner";
import { PlanReviewCard } from "./drafts/panels/PlanReviewCard";
import type { PlanDecision } from "./drafts/panels/PlanReviewCard";
import {
  pickPlanAsk,
  resolvePlanReview,
  isPlanWriteTool,
  type PlanReviewSettled,
  type SessionPlanView,
} from "./session-plan-review";
import { ApprovalPhysicsSwitch } from "./drafts/panels/ApprovalPhysicsSwitch";
import {
  ModelCascadeMenu,
  type ModelCascadeMenuHandle,
} from "./drafts/panels/ModelCascadeMenu";
import { ChromeMark } from "./drafts/icons/Marks";
import { SessionTreeCrumbs } from "./drafts/layout/SessionTreeCrumbs";
import { SessionList } from "./drafts/panels/SessionList";
import { flattenSessionForest } from "./drafts/session-ancestry";
import type { DraftApproval, DraftSession } from "./drafts/types";
import { Composer, type ComposerProps, type ContextBreakdown } from "./composer";
import {
  applyMentionPick,
  commandByName,
  composeCommandInput,
  filterCommandHits,
  filterMentionHits,
  filterPaletteHits,
  filterSlashHits,
  mergeCommandCatalog,
  mentionQuery,
  overlayIdxAfterPrefix,
  overlayKeyAction,
  slashPrefixAtCursor,
  stripSlashToken,
} from "./composer/commands";
import type { AppCommand } from "./composer/commands";
import {
  clipboardToComposerImages,
  mergeComposerImages,
  type ComposerImage,
} from "./composer/images";
import { OptionalOutlet } from "./composer/OptionalOutlet";
import { isPermissionPresetId } from "./live/settings-adapters";
import {
  ConversationPane,
  followStickBottom,
  gapFromBottom,
  isStickBottom,
} from "./conversation";
import { AskScrollRail } from "./drafts/AskScrollRail";

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
  /** tool_call 参数 description：这一步在做什么 */
  toolDescription?: string;
  /** 可一点重试的用户原文（error 行） */
  retryText?: string;
  /** thinking 行元数据（耗时 / token） */
  thinkStartedAt?: number;
  thinkDurationMs?: number;
  thinkOutputTokens?: number;
  images?: ChatImage[];
  /** 本轮助手气泡开始（epoch ms） */
  startedAt?: number;
  durationMs?: number;
  /** 账本「发出 → 终止」墙钟；hydrate 时回填到用户行 */
  loopDurationMs?: number;
  usageInput?: number;
  usageOutput?: number;
  round?: number;
  /** prompt 里命中缓存的部分（落盘账本回填） */
  cacheRead?: number;
  cacheWrite?: number;
  /** usage 是否报过 cache 字段；false → 命中率显示 “—” */
  cacheReported?: boolean;
  /** 落盘 entry id —— 调试面板据此拉本轮 POST */
  payloadId?: string;
  /** id 缺失时的定位口径：同类消息里的 0 基下标 */
  payloadIndex?: number;
  /** 该会话里的第几条（用户消息 / 助手轮），1 基 */
  ordinal?: number;
  /** SessionStore 绝对 seq，往上翻旧消息用 */
  seq?: number;
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

function historyTsMs(ts?: string): number | undefined {
  if (!ts) return undefined;
  const n = Date.parse(ts);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function historyToLines(msgs: ChatHistoryLine[]): ChatLine[] {
  const intents = new Map<string, string>();
  for (const m of msgs) {
    if (!Array.isArray(m.toolCalls)) continue;
    for (const tc of m.toolCalls) {
      const id = (tc.id || "").trim();
      const d = (tc.description || "").trim();
      if (id && d) intents.set(id, d);
    }
  }
  let round = 0;
  const lines = msgs.map((m) => {
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
    const fromMeta = (m.toolName || "").trim();
    const fromBody = role === "tool" ? extractToolNameFromText(text) : undefined;
    const toolName =
      role === "tool"
        ? fromMeta && fromMeta !== "tool"
          ? fromMeta
          : fromBody
        : undefined;
    const startedAt = historyTsMs(m.ts);
    const asstRound = role === "assistant" ? ++round : undefined;
    const callId = (m.toolCallId || "").trim();
    const toolDescription =
      role === "tool"
        ? (m.toolDescription || "").trim() ||
          (callId ? intents.get(callId) : undefined) ||
          extractToolCallIntent(text) ||
          undefined
        : undefined;
    const durationMs =
      m.durationMs != null && Number.isFinite(m.durationMs) && m.durationMs >= 0
        ? m.durationMs
        : undefined;
    const loopDurationMs =
      m.loopDurationMs != null &&
      Number.isFinite(m.loopDurationMs) &&
      m.loopDurationMs >= 0
        ? m.loopDurationMs
        : undefined;
    return {
      id: m.id || uid(),
      role: role as ChatLine["role"],
      text,
      toolName,
      toolCallId: callId || undefined,
      ...(toolDescription ? { toolDescription } : {}),
      ...(durationMs != null ? { durationMs } : {}),
      ...(loopDurationMs != null ? { loopDurationMs } : {}),
      ...(m.images?.length ? { images: m.images } : {}),
      ...(startedAt ? { startedAt } : {}),
      ...(asstRound ? { round: asstRound } : {}),
      ...(m.usageInput && m.usageInput > 0 ? { usageInput: m.usageInput } : {}),
      ...(m.usageOutput && m.usageOutput > 0 ? { usageOutput: m.usageOutput } : {}),
      ...(typeof m.seq === "number" && Number.isFinite(m.seq) ? { seq: m.seq } : {}),
      err:
        role === "tool" &&
        (/^✗|❌|缺少必填|失败/i.test(text.trim()) ||
          m.toolOk === false ||
          Boolean((m as { ok?: boolean }).ok === false)),
    };
  });
  inferToolDurationsFromStartGaps(lines);
  backfillUserLoopDuration(lines);
  return lines;
}

export function mergeOlderChatLines(
  current: ChatLine[],
  older: ChatLine[],
): ChatLine[] {
  if (!older.length) return current;
  const seen = new Set<string>();
  for (const line of current) {
    if (line.seq != null) seen.add(`s:${line.seq}`);
    seen.add(`i:${line.id}`);
  }
  const prepend: ChatLine[] = [];
  for (const line of older) {
    if (line.seq != null && seen.has(`s:${line.seq}`)) continue;
    if (seen.has(`i:${line.id}`)) continue;
    prepend.push(line);
    if (line.seq != null) seen.add(`s:${line.seq}`);
    seen.add(`i:${line.id}`);
  }
  return prepend.length ? [...prepend, ...current] : current;
}

export function oldestSeqFromLines(lines: ChatLine[]): number | null {
  for (const line of lines) {
    if (line.seq != null && Number.isFinite(line.seq)) return line.seq;
  }
  return null;
}

/** Page cursor, or first finite seq in the page lines when the server omits it. */
export function resolveOldestSeq(
  pageOldest: number | null | undefined,
  lines: ChatLine[],
): number | null {
  return pageOldest ?? oldestSeqFromLines(lines);
}

/** 把本 loop 最后一条 loopDurationMs 写到对应用户行。historyToLines 调用。 */
export function backfillUserLoopDuration(lines: ChatLine[]): void {
  let user: ChatLine | undefined;
  let lastLoop: number | undefined;
  const apply = () => {
    if (!user || lastLoop == null || user.durationMs != null) return;
    user.durationMs = lastLoop;
  };
  for (const line of lines) {
    if (line.role === "user") {
      apply();
      user = line;
      lastLoop = line.loopDurationMs;
    } else if (line.loopDurationMs != null && Number.isFinite(line.loopDurationMs)) {
      lastLoop = line.loopDurationMs;
    }
  }
  apply();
}

/** 把「发出 → 现在」写到本 loop 最后一条用户行。完成 / 中断时 ChatPanel 调用。 */
export function stampLoopWallClock(
  lines: ChatLine[],
  now = Date.now(),
): ChatLine[] {
  let userIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.role === "user") {
      userIdx = i;
      break;
    }
  }
  if (userIdx < 0) return lines;
  const user = lines[userIdx]!;
  const start = user.startedAt;
  if (start == null || !Number.isFinite(start) || start <= 0) return lines;
  const wall = Math.max(0, now - start);
  const next = lines.slice();
  next[userIdx] = { ...user, durationMs: wall };
  for (let i = next.length - 1; i > userIdx; i--) {
    const cur = next[i]!;
    if (cur.role !== "assistant") continue;
    if (cur.durationMs != null && Number.isFinite(cur.durationMs) && cur.durationMs >= 0) {
      break;
    }
    next[i] = {
      ...cur,
      durationMs:
        cur.startedAt != null && Number.isFinite(cur.startedAt)
          ? Math.max(0, now - cur.startedAt)
          : wall,
    };
    break;
  }
  return next;
}

export function lastIndexOfRole(
  lines: ChatLine[],
  role: ChatLine["role"],
): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.role === role) return i;
  }
  return -1;
}

/** 上一轮已有 tool 之后再出 thinking/正文，要开新的 assistant 行。onEvent 读写。 */
export function shouldOpenNewAssistantTurn(lines: ChatLine[]): boolean {
  const lastAsst = lastIndexOfRole(lines, "assistant");
  if (lastAsst < 0) return true;
  for (let i = lastAsst + 1; i < lines.length; i++) {
    const r = lines[i]!.role;
    if (r === "tool" || r === "user" || r === "system") return true;
  }
  return false;
}

export function applyAssistantDelta(
  lines: ChatLine[],
  delta: string,
  now = Date.now(),
  newId?: string,
): ChatLine[] {
  const next = [...lines];
  if (!shouldOpenNewAssistantTurn(next)) {
    for (let i = next.length - 1; i >= 0; i--) {
      if (next[i]!.role !== "assistant") continue;
      const cur = next[i]!;
      const rawBase = isPlaceholderAssistantBody(cur.text)
        ? ""
        : (cur.raw ?? cur.text);
      const raw = rawBase + delta;
      next[i] = { ...cur, raw, text: stripTaskCompletionMarkup(raw) };
      return next;
    }
  }
  next.push({
    id: newId ?? uid(),
    role: "assistant",
    text: stripTaskCompletionMarkup(delta),
    raw: delta,
    startedAt: now,
  });
  return next;
}

export function applyAssistantContent(
  lines: ChatLine[],
  content: string,
  now = Date.now(),
  newId?: string,
): ChatLine[] {
  const next = [...lines];
  if (!shouldOpenNewAssistantTurn(next)) {
    for (let i = next.length - 1; i >= 0; i--) {
      if (next[i]!.role !== "assistant") continue;
      const cur = next[i]!;
      next[i] = {
        ...cur,
        raw: content,
        text: stripTaskCompletionMarkup(content),
      };
      return next;
    }
  }
  next.push({
    id: newId ?? uid(),
    role: "assistant",
    text: stripTaskCompletionMarkup(content),
    raw: content,
    startedAt: now,
  });
  return next;
}

export function applyThinkingDelta(
  lines: ChatLine[],
  delta: string,
  now = Date.now(),
  ids?: { assistant?: string; thinking?: string },
): ChatLine[] {
  const next = [...lines];
  if (shouldOpenNewAssistantTurn(next)) {
    next.push({
      id: ids?.assistant ?? uid(),
      role: "assistant",
      text: "",
      startedAt: now,
    });
  }
  const lastAsst = lastIndexOfRole(next, "assistant");
  for (let i = next.length - 1; i > lastAsst; i--) {
    if (next[i]!.role !== "thinking") continue;
    const cur = next[i]!;
    next[i] = {
      ...cur,
      text: cur.text + delta,
      thinkStartedAt: cur.thinkStartedAt ?? now,
      thinkDurationMs: now - (cur.thinkStartedAt ?? now),
    };
    return next;
  }
  next.push({
    id: ids?.thinking ?? uid(),
    role: "thinking",
    text: delta,
    thinkStartedAt: now,
    thinkDurationMs: 0,
  });
  return next;
}

export function applyThinkingContent(
  lines: ChatLine[],
  content: string,
  now = Date.now(),
  ids?: { assistant?: string; thinking?: string },
): ChatLine[] {
  const next = [...lines];
  if (shouldOpenNewAssistantTurn(next)) {
    next.push({
      id: ids?.assistant ?? uid(),
      role: "assistant",
      text: "",
      startedAt: now,
    });
  }
  const lastAsst = lastIndexOfRole(next, "assistant");
  for (let i = next.length - 1; i > lastAsst; i--) {
    if (next[i]!.role !== "thinking") continue;
    const cur = next[i]!;
    next[i] = {
      ...cur,
      text: content,
      thinkStartedAt: cur.thinkStartedAt ?? now,
      thinkDurationMs: now - (cur.thinkStartedAt ?? now),
    };
    return next;
  }
  next.push({
    id: ids?.thinking ?? uid(),
    role: "thinking",
    text: content,
    thinkStartedAt: now,
    thinkDurationMs: 0,
  });
  return next;
}

/** 去掉尾部空助手；中间空助手若后面有 thinking/tool 则保留。完成/中断时 ChatPanel 调用。 */
export function dropIdleAssistantPlaceholders(lines: ChatLine[]): ChatLine[] {
  return lines.filter((l, i) => {
    if (l.role !== "assistant") return true;
    if (l.text.trim() && !isPlaceholderAssistantBody(l.text)) return true;
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j]!;
      // 错误行不是独立 role：它是 role="system" + err=true（见 append 的用法）
      if (next.err) return true;
      const r = next.role;
      if (r === "thinking" || r === "tool") return true;
      if (r === "user" || r === "assistant" || r === "system") return false;
    }
    return false;
  });
}

/** Start-to-start gap is the earlier tool's duration. */
export function inferToolDurationsFromStartGaps(lines: ChatLine[]): void {
  let prev: ChatLine | undefined;
  for (const line of lines) {
    if (line.role === "assistant" || line.role === "user") {
      prev = undefined;
      continue;
    }
    if (line.role !== "tool") continue;
    if (
      prev?.durationMs == null &&
      prev?.startedAt != null &&
      line.startedAt != null
    ) {
      const gap = line.startedAt - prev.startedAt;
      if (gap >= 80 && gap < 30 * 60 * 1000) prev.durationMs = gap;
    }
    if (line.startedAt != null) prev = line;
  }
}

function hydrateToolLines(
  setLines: (fn: (prev: ChatLine[]) => ChatLine[]) => void,
  sessionId?: string | null,
  projectRoot?: string,
) {
  const sid = (sessionId || "").trim();
  const root = (projectRoot || "").trim();
  if (!sid || !root) return;
  void fetchSessionToolMeta(sid, root).then((extra) => {
    if (
      Object.keys(extra.intents).length === 0 &&
      Object.keys(extra.durations).length === 0
    ) {
      return;
    }
    setLines((prev) => applySessionToolMeta(prev, extra));
  });
}

/**
 * 每轮跑完拉一次落盘索引：直播行没有 entry id，靠尾对齐补上定位坐标与缓存分桶。
 * 拉不到就什么都不做 —— 编号仍然渲染，只是不可点、缓存显示 “—”。
 */
function hydratePayloadLines(
  setLines: (fn: (prev: ChatLine[]) => ChatLine[]) => void,
  sessionId?: string | null,
  projectRoot?: string,
) {
  const sid = (sessionId || "").trim();
  if (!sid) return;
  void fetchSessionPayloadIndex(sid, projectRoot || "").then((index) => {
    if (!index.ok) return;
    setLines((prev) => applySessionPayloadIndex(prev, index));
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
  "热键: Enter 发送（忙碌时入队） · / 补全 ↑↓ Tab/Enter · Ctrl+N 新会话 · Ctrl+M 模型 · Ctrl+. / Esc 停止 · Shift+Tab 审批 · Ctrl+Shift+C 复制 · R 重试",
].join("\n");

/** Cap pending user messages while a turn is running */
const MAX_QUEUE = 20;

const SEND_MODE_KEY = "maou.app.sendMode";

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
const CONTEXT_PAGE = 40;

const RUNTIME_SLASH = new Set([
  "compact",
  "context",
  "init",
  "plan",
  "goal",
  "ultragoal",
  "agent",
]);

export type ChatPanelProps = {
  onOpenTerminal?: (id: string, agentName?: string) => void;
  defaultAgent?: string;
  onMetaChange?: (meta: Meta) => void;
  /** codex = 侧栏线程 + 居中对话 + 底部 composer (also used inside draft-aligned live shell) */
  layout?: "default" | "codex";
  /** 将线程列表 portal 到侧栏容器 */
  threadRailId?: string;
  /** Shell topbar busy chip */
  onBusyChange?: (busy: boolean) => void;
  /** 顶栏今日 in/out：refreshContextUsage / fetchSessionStats 回写 */
  onTodayUsageChange?: (t: { date?: string; inputTokens: number; outputTokens: number }) => void;
  /** Extra class on root (e.g. wire-context for draft-aligned live shell) */
  className?: string;
  /**
   * wire = draft-shell chrome labels/classes (Chinese SessionList-like rail,
   * wire composer dock). Default keeps legacy English codex chrome.
   */
  chrome?: "default" | "wire";
  /** Push recent system/tool/err lines for bottom dock log board */
  onDockLogLines?: (lines: string[]) => void;
  /** 名册就绪后再拉会话 / 上下文。默认 true（draft / 单测） */
  bootReady?: boolean;
};

export function ChatPanel({
  onOpenTerminal,
  defaultAgent = "coding",
  onMetaChange,
  layout = "default",
  threadRailId,
  onBusyChange,
  onTodayUsageChange,
  className,
  chrome = "default",
  onDockLogLines,
  bootReady = true,
}: ChatPanelProps) {
  const {
    abortChat,
    answerApproval,
    clearChatQueue,
    clearSession,
    createSession,
    deleteSession,
    enqueueChat,
    exportTranscript,
    fetchApproval,
    fetchPendingAsk,
    answerAsk,
    fetchSessionPlan,
    fetchMeta,
    togglePlan,
    fetchModels,
    fetchLlmConfig,
    fetchSessionStats,
    fetchSessions,
    fetchSessionMessages,
    loadOlderMessages,
    removeChatQueueItem,
    renameSession,
    fetchCommandCatalog,
    runCommand,
    setApprovalMode,
    setPermissionPreset,
    setModel,
    streamChat,
    switchSession,
  } = useAppPorts().chat;
  const { fetchProjectTree, fetchMdTree } = useAppPorts().files;
  const isWire =
    chrome === "wire" ||
    (typeof className === "string" && className.includes("wire-context"));
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [contextHydrated, setContextHydrated] = useState(false);
  const oldestSeqRef = useRef<number | null>(null);
  const hasMoreRef = useRef(false);
  const loadingOlderRef = useRef(false);
  const [input, setInput] = useState("");
  const [inputEpoch, setInputEpoch] = useState(0);
  const replaceInput = useCallback((v: string) => {
    setInput(v);
    setInputEpoch((n) => n + 1);
  }, []);
  const [busy, setBusyState] = useState(false);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [providers, setProviders] = useState<{ id: string; name?: string }[]>(
    [],
  );
  const [models, setModels] = useState<{ id: string; name?: string }[]>([]);
  const [approval, setApproval] = useState<ApprovalMode>("yolo");
  const [pending, setPending] = useState<PendingApproval[]>([]);
  /** submit_plan 阻塞在这里等人选：批准 / 拒绝 / 补充意见 */
  const [pendingAsk, setPendingAsk] = useState<PendingAsk | null>(null);
  const [sessionPlanView, setSessionPlanView] = useState<SessionPlanView | null>(
    null,
  );
  const [planDismissedRevision, setPlanDismissedRevision] = useState<
    number | null
  >(null);
  const [planSettled, setPlanSettled] = useState<PlanReviewSettled | null>(
    null,
  );
  const [planLaunching, setPlanLaunching] = useState(false);
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
  const [contextBreakdown, setContextBreakdown] =
    useState<ContextBreakdown | null>(null);
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
  // 轮次调试面板：本轮 POST 请求 / 本轮返回内容
  const [payloadOpen, setPayloadOpen] = useState(false);
  const [payloadView, setPayloadView] = useState<"request" | "response">(
    "request",
  );
  const [payloadTitle, setPayloadTitle] = useState("");
  const [payloadDetail, setPayloadDetail] = useState<PayloadDetail | null>(null);
  const [payloadLoading, setPayloadLoading] = useState(false);
  const [payloadError, setPayloadError] = useState<string | null>(null);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteIdx, setPaletteIdx] = useState(0);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [overlayDismissed, setOverlayDismissed] = useState(false);
  const [commandBlock, setCommandBlock] = useState<string | null>(null);
  const [commandBlockSelected, setCommandBlockSelected] = useState(false);
  const cursorRef = useRef(0);
  const slashPrefixRef = useRef<string | null>(null);
  const [filePaths, setFilePaths] = useState<string[]>([]);
  const [attachImages, setAttachImages] = useState<ComposerImage[]>([]);
  const [extraCommands, setExtraCommands] = useState<AppCommand[]>([]);
  /** 发送模式：队列（等本轮）/ 插入（打断当前流）—— 对接到 MessageQueue */
  const [sendMode, setSendModeState] = useState<ChatSendMode>(() => loadSendMode());
  /** 发送框上方：未成功发送 / 已排队待投递 */
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [railEl, setRailEl] = useState<HTMLElement | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const modelMenuRef = useRef<ModelCascadeMenuHandle | null>(null);
  const stickBottomRef = useRef(true);
  /** followStickBottom 正在写 scrollTop 时，onScroll 不改 stick。 */
  const stickPinningRef = useRef(false);
  /** 当前焦点会话的客户端 AbortController（Stop 用） */
  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  /** Guards double-Enter before busyRef flips inside runUserMessage */
  const inFlightSendRef = useRef(false);
  const lastUserRef = useRef("");
  const lastImagesRef = useRef<ChatImage[]>([]);
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
  /** 流回调里读当前工程根（meta 会变，闭包不能捕死） */
  const projectRootRef = useRef<string>("");

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
  const onTodayUsageChangeRef = useRef(onTodayUsageChange);
  onTodayUsageChangeRef.current = onTodayUsageChange;
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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        let tree;
        try {
          ({ tree } = await fetchProjectTree());
        } catch {
          ({ tree } = await fetchMdTree());
        }
        const acc: string[] = [];
        const walk = (nodes: typeof tree) => {
          for (const n of nodes) {
            if (n.type === "file") acc.push(n.path);
            if (n.children?.length) walk(n.children);
          }
        };
        walk(tree);
        if (!cancelled) setFilePaths(acc);
      } catch {
        if (!cancelled) setFilePaths([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchProjectTree, fetchMdTree]);

  useEffect(() => {
    let cancelled = false;
    void fetchCommandCatalog()
      .then((list) => {
        if (cancelled) return;
        setExtraCommands(
          list.map((c) => {
            const name = c.name.replace(/^\//, "").trim().toLowerCase();
            const desc = (c.description || name).replace(/^\//, "").trim();
            return {
              name,
              label: desc,
              description: desc,
              runtime: true,
              palette: false,
              slash: true,
            };
          }),
        );
      })
      .catch(() => {
        if (!cancelled) setExtraCommands([]);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchCommandCatalog, meta?.agentName]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "k") {
        ev.preventDefault();
        setPaletteOpen((v) => !v);
        setPaletteIdx(0);
        setSlashOpen(false);
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
            x.userTurns === next[i]?.userTurns &&
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

  const applyHistoryPage = useCallback(
    (
      page: SessionMessagePage,
      sessionId?: string | null,
      projectRoot?: string,
    ) => {
      const next = historyToLines(page.messages);
      setLines(next);
      oldestSeqRef.current = resolveOldestSeq(page.oldestSeq, next);
      hasMoreRef.current = page.hasMore;
      setHasMoreHistory(page.hasMore);
      stickBottomRef.current = true;
      setContextHydrated(true);
      if (sessionId && page.messages.length) {
        hydrateToolLines(setLines, sessionId, projectRoot);
        hydratePayloadLines(setLines, sessionId, projectRoot);
      }
    },
    [],
  );

  const loadOlderHistory = useCallback(async (mode: "anchor" | "bottom") => {
    const before = oldestSeqRef.current;
    if (!hasMoreRef.current || before == null || loadingOlderRef.current) return;
    loadingOlderRef.current = true;
    try {
      const page = await loadOlderMessages(before, CONTEXT_PAGE);
      const el = logRef.current;
      const prevH = el?.scrollHeight ?? 0;
      const prevTop = el?.scrollTop ?? 0;
      const older = historyToLines(page.messages);
      oldestSeqRef.current = resolveOldestSeq(page.oldestSeq, older);
      hasMoreRef.current = page.hasMore;
      setHasMoreHistory(page.hasMore);
      setLines((prev) => mergeOlderChatLines(prev, older));
      if (mode === "anchor" && el) {
        requestAnimationFrame(() => {
          el.scrollTop = prevTop + (el.scrollHeight - prevH);
        });
      }
    } catch {
      hasMoreRef.current = false;
      setHasMoreHistory(false);
    } finally {
      loadingOlderRef.current = false;
    }
  }, [loadOlderMessages]);

  const loadOlderRef = useRef(loadOlderHistory);
  loadOlderRef.current = loadOlderHistory;

  // 焦点会话 ref + busy 仅反映「当前会话」是否在跑
  useEffect(() => {
    activeSessionRef.current = meta?.sessionId ?? null;
    projectRootRef.current = meta?.projectRoot ?? "";
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
      if (r.today) {
        onTodayUsageChangeRef.current?.(r.today);
      }
      if (r.stats) {
        const used =
          (r.stats.contextUsed != null && r.stats.contextUsed > 0
            ? r.stats.contextUsed
            : (r.stats.lastInputTokens ?? 0) + (r.stats.lastOutputTokens ?? 0));
        patchContextUsage({
          used,
          max: maxContextRef.current,
        });
        if (r.stats.contextBreakdown) {
          setContextBreakdown(r.stats.contextBreakdown);
        }
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

  const refreshPlan = useCallback(async () => {
    try {
      const view = await fetchSessionPlan();
      setSessionPlanView(view);
      setMeta((m) => (m ? { ...m, plan: view.plan } : m));
      return view;
    } catch {
      return null;
    }
  }, []);

  const refreshAsk = useCallback(async () => {
    const sid = activeSessionRef.current;
    try {
      const list = await fetchPendingAsk();
      const mine = pickPlanAsk(list, sid);
      setPendingAsk((prev) => {
        if (prev?.sessionId === mine?.sessionId && prev?.kind === mine?.kind &&
            prev?.planRevision === mine?.planRevision) {
          return prev;
        }
        return mine;
      });
    } catch {
      /* 轮询失败不清状态：网络抖一下不该让审阅卡闪掉 */
    }
  }, [fetchPendingAsk]);

  const decidePlan = useCallback(
    (decision: PlanDecision, note?: string) => {
      const ask = pendingAsk;
      if (!ask) return;
      setPlanSettled({
        revision: ask.planRevision ?? sessionPlanView?.plan?.revision ?? 0,
        outcome: decision,
        ...(note ? { note } : {}),
      });
      setPendingAsk(null); // 乐观收起：后端已经拿到答案，别让用户对着卡重复点
      void answerAsk(ask.sessionId, {
        kind: "plan_review",
        decision,
        ...(note ? { note } : {}),
      })
        .then(() => {
          void refreshPlan();
        })
        .catch((err) => {
          setStatus(err instanceof Error ? err.message : String(err));
          void refreshAsk();
        });
    },
    [answerAsk, pendingAsk, refreshAsk, refreshPlan, sessionPlanView],
  );


  // Mount-only bootstrap — bootReady 后：会话列表 → 最新一页往上
  useEffect(() => {
    if (!bootReady) return;
    let cancelled = false;
    void (async () => {
      try {
        await refreshSessions();
        if (cancelled) return;
        const m = await fetchMeta();
        if (cancelled) return;
        pushMeta(m);
        setApproval(
          (m.approvalMode as ApprovalMode) ||
            (m.sandboxMode as ApprovalMode) ||
            "yolo",
        );
        const page = await fetchSessionMessages({ limit: CONTEXT_PAGE });
        if (cancelled) return;
        applyHistoryPage(page, m.sessionId, m.projectRoot);
        requestAnimationFrame(() => {
          if (cancelled) return;
          const el = logRef.current;
          if (
            el &&
            el.scrollHeight <= el.clientHeight + 24 &&
            hasMoreRef.current
          ) {
            void loadOlderRef.current("bottom");
          }
        });
        const md = await fetchModels(m.provider || undefined);
        if (cancelled) return;
        setProviders(md.providers.length ? md.providers : m.providers ?? []);
        setModels(md.models);
        await refreshApproval();
        if (cancelled) return;
        await refreshPlan();
        if (cancelled) return;
        await refreshAsk();
      } catch (e) {
        if (!cancelled) {
          setContextHydrated(true);
          setStatus(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // bootReady 从 false→true 才开跑；其余回调走 ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootReady]);

  // 轮询 pending 审批 / 待审计划（工具阻塞在宿主上时才有东西）
  useEffect(() => {
    const t = setInterval(() => {
      void refreshApproval().catch(() => {});
      void refreshAsk();
    }, 1500);
    return () => clearInterval(t);
  }, [refreshApproval, refreshAsk]);

  const [showBackToBottom, setShowBackToBottom] = useState(false);
  const [showJumpPrev, setShowJumpPrev] = useState(false);
  const [jumpPrevLabel, setJumpPrevLabel] = useState("↑ 上一条 user（点击）");
  const fromBottomRef = useRef(0);

  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    const onScroll = () => {
      if (stickPinningRef.current) return;
      const gap = gapFromBottom(el);
      fromBottomRef.current = gap;
      const stick = isStickBottom(gap);
      stickBottomRef.current = stick;
      setShowBackToBottom(!stick && el.scrollHeight > el.clientHeight + 48);
      const empty = el.scrollHeight <= el.clientHeight + 8;
      setShowJumpPrev(shouldShowJumpBar(empty, gap));
      const nodes = el.querySelectorAll<HTMLElement>('[data-msg-role="user"]');
      let preview: string | null = null;
      for (const n of nodes) {
        if (n.offsetTop + n.offsetHeight <= el.scrollTop + 8) {
          preview = n.dataset.msgPreview || n.textContent || "";
        } else break;
      }
      setJumpPrevLabel(buildPrevUserJumpLabel(preview));
      if (el.scrollTop < 80) void loadOlderRef.current("anchor");
    };
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) stickBottomRef.current = false;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    onScroll();
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
    };
  }, []);

  useLayoutEffect(() => {
    const el = logRef.current;
    if (!el) return;
    if (!stickBottomRef.current) return;
    stickPinningRef.current = true;
    followStickBottom(el, true);
    stickPinningRef.current = false;
    setShowBackToBottom(false);
    setShowJumpPrev(false);
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

  const steerAllQueued = useCallback(async () => {
    const items = outbox.filter((o) => o.status === "queued");
    for (const item of items) {
      await removeOutboxItem(item);
      await enqueueToBackend(item.text, "insert", "已插入打断");
    }
  }, [outbox, removeOutboxItem, enqueueToBackend]);

  const steerOutboxItem = useCallback(
    async (item: OutboxItem) => {
      await removeOutboxItem(item);
      await enqueueToBackend(item.text, "insert", "已插入打断");
    },
    [removeOutboxItem, enqueueToBackend],
  );

  const onCommandLaunch = useCallback(() => {
    setPaletteOpen((v) => !v);
    setPaletteIdx(0);
    setSlashOpen(false);
    focusComposer();
  }, [focusComposer]);

  const onOverlayDismiss = useCallback(() => {
    setSlashOpen(false);
    setPaletteOpen(false);
    setOverlayDismissed(true);
  }, []);

  const patchLastAssistant = useCallback((delta: string) => {
    setLines((prev) => applyAssistantDelta(prev, delta));
  }, []);

  const patchLastThinking = useCallback((delta: string) => {
    setLines((prev) => applyThinkingDelta(prev, delta));
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
            setLines((prev) => applyThinkingContent(prev, content));
          }
          break;
        }
        case "assistant": {
          const content = String(ev.content ?? "");
          if (!content) break;
          setLines((prev) => applyAssistantContent(prev, content));
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
          const paramsRaw =
            tool?.parameters ??
            (tool as { arguments?: unknown } | undefined)?.arguments ??
            ev.parameters ??
            ev.arguments;
          const desc =
            readToolIntent(paramsRaw) ||
            (typeof ev.description === "string" ? ev.description.trim() : "");
          const params = asToolParams(paramsRaw);
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
            toolDescription: desc || undefined,
            startedAt: Date.now(),
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
          const evDur = Number(
            ev.durationMs ?? (ev as { elapsed?: unknown }).elapsed,
          );
          const resultDuration =
            Number.isFinite(evDur) && evDur > 0 ? evDur : undefined;
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
                  toolDescription: cur.toolDescription,
                  durationMs:
                    resultDuration ??
                    (cur.startedAt != null
                      ? Date.now() - cur.startedAt
                      : cur.durationMs),
                };
                return next;
              }
            }
            const label = name || "tool";
            const call = toolCallId
              ? [...prev]
                  .reverse()
                  .find(
                    (l) =>
                      l.role === "tool" && l.toolCallId === toolCallId,
                  )
              : undefined;
            return [
              ...prev,
              {
                id: uid(),
                role: "tool" as const,
                text: `${ok ? "✓" : "✗"} ${label}${tid ? ` · ${tid}` : ""}${snippet ? `\n${snippet}` : ""}`,
                toolName: name || undefined,
                toolCallId: toolCallId || undefined,
                toolDescription: call?.toolDescription,
                durationMs:
                  resultDuration ??
                  (call?.startedAt != null
                    ? Date.now() - call.startedAt
                    : undefined),
                err: !ok,
                terminalId: tid,
                agentName: defaultAgent,
              },
            ];
          });
          // 不自动弹终端：用户点工具行 / 底栏「终端」再打开
          if (ok && isPlanWriteTool(seedName || rawName)) {
            void refreshPlan();
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
            setTurnUsage({
              in: Number.isFinite(inn) ? inn : 0,
              out: Number.isFinite(out) ? out : 0,
            });
          }
          const today = (ev as { today?: { date?: string; inputTokens?: number; outputTokens?: number } }).today;
          if (today) {
            onTodayUsageChangeRef.current?.({
              date: today.date,
              inputTokens: Number(today.inputTokens ?? 0) || 0,
              outputTokens: Number(today.outputTokens ?? 0) || 0,
            });
          }
          if ((Number.isFinite(inn) && inn > 0) || (Number.isFinite(out) && out > 0)) {
            const now = Date.now();
            setLines((prev) => {
              const next = [...prev];
              for (let i = next.length - 1; i >= 0; i--) {
                if (next[i]!.role !== "assistant") continue;
                const cur = next[i]!;
                next[i] = {
                  ...cur,
                  usageInput: Number.isFinite(inn) && inn > 0 ? inn : cur.usageInput,
                  usageOutput: Number.isFinite(out) && out > 0 ? out : cur.usageOutput,
                  durationMs:
                    cur.startedAt != null
                      ? Math.max(cur.durationMs ?? 0, now - cur.startedAt)
                      : cur.durationMs,
                };
                break;
              }
              return next;
            });
          }
          const occ =
            (Number.isFinite(inn) ? inn : 0) + (Number.isFinite(out) ? out : 0);
          if (occ > 0) {
            patchContextUsage({
              used: occ,
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
          const inn = Number(u?.prompt_tokens ?? u?.input ?? 0);
          const out = Number(u?.completion_tokens ?? u?.output ?? 0);
          const maxCtx = Number(u?.max_context ?? u?.maxContext ?? 0);
          if (u && (inn || out)) setTurnUsage({ in: inn, out });
          const occ =
            (Number.isFinite(inn) ? inn : 0) + (Number.isFinite(out) ? out : 0);
          if (occ > 0) {
            patchContextUsage({
              used: occ,
              max: Number.isFinite(maxCtx) && maxCtx > 0 ? maxCtx : undefined,
            });
          }
          void refreshContextUsage();
          void refreshPlan();
          {
            const now = Date.now();
            setLines((prev) => {
              const next = prev.map((l) => {
                if (l.role === "thinking" && l.thinkStartedAt != null) {
                  return {
                    ...l,
                    thinkDurationMs: Math.max(
                      l.thinkDurationMs ?? 0,
                      now - l.thinkStartedAt,
                    ),
                  };
                }
                return l;
              });
              for (let i = next.length - 1; i >= 0; i--) {
                if (next[i]!.role !== "assistant") continue;
                const cur = next[i]!;
                next[i] = {
                  ...cur,
                  durationMs:
                    cur.startedAt != null
                      ? Math.max(cur.durationMs ?? 0, now - cur.startedAt)
                      : cur.durationMs,
                  usageInput:
                    Number.isFinite(inn) && inn > 0 ? inn : cur.usageInput,
                  usageOutput:
                    Number.isFinite(out) && out > 0 ? out : cur.usageOutput,
                };
                break;
              }
              return stampLoopWallClock(next, now);
            });
          }
          break;
        }
        case "queued_user": {
          // 后端 MessageQueue 投递成功 → 从 outbox 移入 transcript
          const content = String(ev.content ?? "").trim();
          const qid = Number(ev.id);
          if (content) {
            lastUserRef.current = content;
            append({
              id: uid(),
              role: "user",
              text: content,
              startedAt: Date.now(),
            });
            // 新一轮 assistant 气泡，承接插入/排队后的回复
            append({ id: uid(), role: "assistant", text: "", startedAt: Date.now() });
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
            stampLoopWallClock(dropIdleAssistantPlaceholders(prev)),
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
            setLines((prev) => [
              ...stampLoopWallClock(prev),
              {
                id: uid(),
                role: "system" as const,
                text: msg,
                err: true,
                retryText: lastUserRef.current || undefined,
              },
            ]);
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
          const text = String(
            (ev as { text?: string; content?: string; message?: string }).text ??
              (ev as { content?: string }).content ??
              (ev as { message?: string }).message ??
              "",
          ).trim();
          if (!text || isModelCallProgressText(text)) break;
          append({
            id: uid(),
            role: "system",
            text: `⏳ ${text}`,
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
            /压缩|归档|模型切换|compact|archive|summaryStage|archiveStage|限流|额度|429|Retrying|重试/i.test(
              msg,
            )
          ) {
            append({ id: uid(), role: "system", text: msg });
            if (/压缩|compact|archive|summaryStage|archiveStage/i.test(msg)) {
              patchContextUsage({ used: 0 });
              void refreshContextUsage();
            }
          }
          break;
        }
        case "context_refresh": {
          void refreshContextUsage();
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
      refreshPlan,
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
        applyHistoryPage(r, r.sessionId, r.meta.projectRoot);
        setTurnUsage(null);
        await refreshSessions();
        append({
          id: uid(),
          role: "system",
          text: `✓ 已清空会话消息 ${r.sessionId}`,
        });
      } catch {
        applyHistoryPage({ messages: [], oldestSeq: null, hasMore: false });
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
      applyHistoryPage(r, r.sessionId, r.meta.projectRoot);
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
          applyHistoryPage(r, r.sessionId, r.meta.projectRoot);
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
              `${x.id === s.activeSessionId ? "→ " : "  "}${x.id.slice(0, 12)}… ${x.title} (${x.userTurns})`,
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
    async (text: string, images?: ChatImage[]) => {
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
      lastImagesRef.current = images ?? [];
      stickBottomRef.current = true;

      // 仅当前焦点会话立刻画气泡
      if (
        activeSessionRef.current === sessionId ||
        sessionId === "__pending__"
      ) {
        append({
          id: uid(),
          role: "user",
          text,
          startedAt: Date.now(),
          ...(images?.length ? { images } : {}),
        });
        append({ id: uid(), role: "assistant", text: "", startedAt: Date.now() });
        busyRef.current = true;
        setBusy(true);
        setTurnUsage(null);
      }
      setSlashOpen(false);

      try {
        for await (const ev of streamChat(text, ac.signal, images)) {
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
            setLines((prev) => dropIdleAssistantPlaceholders(prev));
            void refreshContextUsage();
            hydratePayloadLines(setLines, sessionId, projectRootRef.current);
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
            setLines((prev) => dropIdleAssistantPlaceholders(prev));
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
            setLines((prev) => dropIdleAssistantPlaceholders(prev));
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
      streamChat,
    ],
  );

  const sendPlanApprove = useCallback(async () => {
    if (busyRef.current || inFlightSendRef.current || planLaunching) return;
    setPlanLaunching(true);
    try {
      await runUserMessage("/plan approve");
      setPlanSettled({
        revision: sessionPlanView?.plan?.revision ?? 0,
        outcome: "approve",
      });
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      await refreshPlan();
      setPlanLaunching(false);
    }
  }, [planLaunching, refreshPlan, runUserMessage, sessionPlanView]);

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
      dropIdleAssistantPlaceholders(stampLoopWallClock(prev)),
    );
    void refreshApproval().catch(() => {});
    if (announce) {
      setStatus("已停止");
    }
  }, [refreshApproval, meta?.sessionId, markSessionRunning, setBusy]);

  /** modeOverride: Ctrl+Enter 强制 insert */
  const send = async (modeOverride?: ChatSendMode) => {
    const live = inputRef.current?.value ?? input;
    const text = composeCommandInput(commandBlock, live).trim();
    const images = attachImages.slice();
    if (!text && !images.length) return;
    replaceInput("");
    setCommandBlock(null);
    setCommandBlockSelected(false);
    setAttachImages([]);
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

    // 附图走 runChat；队列只收文本
    if ((busyRef.current || inFlightSendRef.current) && !images.length) {
      await enqueueToBackend(text, mode);
      return;
    }

    inFlightSendRef.current = true;
    try {
      await runUserMessage(text, images);
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
      applyHistoryPage(r, r.sessionId, r.meta.projectRoot);
      setTurnUsage(null);
      setPendingAsk(null);
      void refreshAsk();
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
      setPlanDismissedRevision(null);
      setPlanSettled(null);
      setPlanLaunching(false);
      void refreshPlan();
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
    applyHistoryPage(r, r.sessionId, r.meta.projectRoot);
    setTurnUsage(null);
    stickBottomRef.current = true;
    busyRef.current = false;
    setBusy(false);
    abortRef.current = null;
    await refreshSessions();
    setStatus("新会话");
    focusComposer();
    setPlanDismissedRevision(null);
    setPlanSettled(null);
    setPlanLaunching(false);
    setSessionPlanView(null);
  };

  const adoptSession = async (
    r: Awaited<ReturnType<typeof createSession>>,
    statusText: string,
  ) => {
    pushMeta(r.meta);
    activeSessionRef.current = r.sessionId;
    applyHistoryPage(r, r.sessionId, r.meta.projectRoot);
    setTurnUsage(null);
    stickBottomRef.current = true;
    busyRef.current = false;
    setBusy(false);
    abortRef.current = null;
    await refreshSessions();
    setStatus(statusText);
    focusComposer();
    setPlanDismissedRevision(null);
    setPlanSettled(null);
    setPlanLaunching(false);
    void refreshPlan();
  };

  const onForkSession = async (parentId: string) => {
    setOutbox([]);
    setPending([]);
    const r = await createSession(undefined, {
      parentSessionId: parentId,
      fork: true,
    });
    await adoptSession(r, "已派生会话");
  };

  const onNewChildSession = async (parentId: string) => {
    setOutbox([]);
    setPending([]);
    const r = await createSession(undefined, {
      parentSessionId: parentId,
      fork: false,
    });
    await adoptSession(r, "新子会话");
  };

  const onDeleteSession = async (id: string) => {
    if (!id) return;
    const label = sessions.find((s) => s.id === id)?.title?.trim() || "这条对话";
    if (!window.confirm(`删除「${label}」？`)) return;
    const wasActive = (meta?.sessionId ?? activeSessionRef.current) === id;
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (wasActive) activeSessionRef.current = null;
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
      const nextSessions = (r.sessions ?? []).filter((s) => s.id !== id);
      const nextId =
        r.sessionId && r.sessionId !== id
          ? r.sessionId
          : (nextSessions[0]?.id ?? null);
      if (nextSessions.length > 0) setSessions(nextSessions);
      else await refreshSessions();
      if (nextId) {
        activeSessionRef.current = nextId;
        pushMeta({ ...r.meta, sessionId: nextId });
      } else {
        pushMeta(r.meta);
      }
      if (wasActive) {
        applyHistoryPage(r, nextId, r.meta.projectRoot);
        setTurnUsage(null);
        stickBottomRef.current = true;
      }
      setStatus("已删除会话");
      focusComposer();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
      try {
        await refreshSessions();
      } catch {
        /* ignore */
      }
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
    const lastLine = [...lines].reverse().find((l) => l.role === "user");
    const msg = text || lastLine?.text || lastUserRef.current;
    const images = lastLine?.images ?? lastImagesRef.current;
    if (!msg && !images?.length) return;
    if ((busyRef.current || inFlightSendRef.current) && !images?.length) {
      void enqueueToBackend(msg, sendMode, "重试已排队");
      return;
    }
    inFlightSendRef.current = true;
    void runUserMessage(msg, images)
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
        if (slashOpen || paletteOpen) {
          setSlashOpen(false);
          setPaletteOpen(false);
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
  }, [lines, busy, stopRun, approval, slashOpen, paletteOpen, pushMeta]);

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

  const onApprovalChange = async (mode: string) => {
    try {
      if (isPermissionPresetId(mode)) {
        if (
          mode === "open+yolo" &&
          !window.confirm("/yolo 放开。确认「我已了解风险」？")
        ) {
          return;
        }
        const confirm = mode === "open+yolo" ? "我已了解风险" : undefined;
        const m = await setPermissionPreset(mode, confirm, "session");
        pushMeta(m);
        const next = (m.approvalMode || m.sandboxMode) as ApprovalMode | undefined;
        if (next) setApproval(next);
        return;
      }
      if (mode !== "normal" && mode !== "auto" && mode !== "yolo") return;
      const m = await setApprovalMode(mode);
      pushMeta(m);
      setApproval(mode);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    }
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
        onFork={(id) => void onForkSession(id)}
        onNewChild={(id) => void onNewChildSession(id)}
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

  const planReview = resolvePlanReview(sessionPlanView, pendingAsk, {
    dismissedRevision: planDismissedRevision,
    planLaunching,
    settled: planSettled,
  });
  const showPlanReview = planReview.show;
  const planReviewProps = {
    markdown: planReview.markdown,
    objective: planReview.objective,
    revision: planReview.revision,
    blocking: planReview.blocking,
    settled: planReview.settled,
    note: planReview.note,
    ...(planReview.blocking
      ? {
          busy: false,
          onStart: () => decidePlan("approve"),
          onReject: () => decidePlan("reject"),
          onChat: (note?: string) => decidePlan("chat", note),
          onHold: () => decidePlan("chat"),
        }
      : {
          busy: busy || planLaunching,
          onStart: () => void sendPlanApprove(),
          onHold: () => {
            const rev = sessionPlanView?.plan?.revision ?? 0;
            setPlanSettled({ revision: rev, outcome: "hold" });
            setPlanDismissedRevision(rev);
          },
        }),
  };
  const planReviewCard = showPlanReview ? (
    <PlanReviewCard {...planReviewProps} />
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
    ? "输入任务，或 /help。工具和终端在两侧。"
    : "Describe a task, or type /help. Tools and terminals open on the right.";

  /** 编号点击 → 拉那一轮的落盘账本，开调试面板 */
  const onInspectPayload = useCallback(
    (req: PayloadRequest) => {
      setPayloadView(req.view);
      setPayloadTitle(req.title);
      setPayloadDetail(null);
      setPayloadError(null);
      setPayloadLoading(true);
      setPayloadOpen(true);
      const sid = activeSessionRef.current || meta?.sessionId || "";
      void fetchSessionPayloadDetail(sid, projectRootRef.current, "assistant", {
        ...(req.payloadId ? { id: req.payloadId } : {}),
        ...(req.payloadIndex != null ? { index: req.payloadIndex } : {}),
      })
        .then((detail) => setPayloadDetail(detail))
        .catch((err) =>
          setPayloadError(err instanceof Error ? err.message : String(err)),
        )
        .finally(() => setPayloadLoading(false));
    },
    [meta?.sessionId],
  );

  // Wire: same groupThreadBlocks tree as draft ContextPanel
  const wireDraftMessages = useMemo(
    () =>
      isWire
        ? chatLinesToDraftMessages(lines, {
            agentBusy: busy,
            agentName: meta?.agentName || defaultAgent,
          })
        : [],
    [isWire, lines, busy, meta?.agentName, defaultAgent],
  );

  const messageList = isWire ? (
    <>
      {hasMoreHistory ? (
        <div className="empty-sub" style={{ textAlign: "center", padding: "8px 0" }}>
          向上滚动加载更早
        </div>
      ) : null}
      <WireThreadView
        messages={wireDraftMessages}
        emptyTitle={contextHydrated ? emptyTitle : ""}
        emptySub={contextHydrated ? emptySub : ""}
        onOpenTerminal={onOpenTerminal}
        agentBusy={busy}
        onInspectPayload={onInspectPayload}
      />
      {planReviewCard}
    </>
  ) : (
    <div
      className={`chat-log${isCodex ? " codex-log" : ""}`}
      ref={logRef}
    >
      {hasMoreHistory ? (
        <div className="empty-sub" style={{ textAlign: "center", padding: "8px 0" }}>
          向上滚动加载更早
        </div>
      ) : null}
      {lines.length === 0 && contextHydrated && (
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
      {planReviewCard}
    </div>
  );

  const commandCatalog = useMemo(
    () => mergeCommandCatalog(extraCommands),
    [extraCommands],
  );
  const slashPrefix = commandBlock
    ? null
    : slashPrefixAtCursor(
        inputRef.current?.value ?? input,
        inputRef.current?.selectionStart ?? cursorRef.current,
      );
  const typingSlash = slashPrefix != null;
  const commandHits = filterCommandHits(
    paletteOpen && !typingSlash ? "" : (slashPrefix ?? ""),
    commandCatalog,
    24,
    { surface: paletteOpen && !typingSlash ? "all" : "slash" },
  );
  const slashHits = commandHits.map((c) => c.name);
  const mentionQ = mentionQuery(input);
  const mentionHits = mentionQ != null ? filterMentionHits(mentionQ, filePaths) : [];
  const paletteHits = paletteOpen
    ? commandHits
    : filterPaletteHits(input, commandCatalog);
  const mentionOpen =
    !overlayDismissed &&
    !paletteOpen &&
    !typingSlash &&
    mentionQ != null;
  const slashSel =
    slashHits.length > 0
      ? slashHits[Math.min(slashIdx, slashHits.length - 1)]!
      : null;

  const commitCommandBlock = (s: string) => {
    const name = commandByName(s, commandCatalog)?.name ?? s;
    setCommandBlock(name);
    setCommandBlockSelected(false);
    replaceInput(
      stripSlashToken(inputRef.current?.value ?? input, cursorRef.current),
    );
    setSlashOpen(false);
    setSlashIdx(0);
    setPaletteOpen(false);
    setOverlayDismissed(true);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const applySlashHit = (s: string) => {
    commitCommandBlock(s);
  };

  const applyPaletteHit = (s: string) => {
    setPaletteOpen(false);
    if (s === "new") {
      void onNewSession();
      return;
    }
    if (s === "fork") {
      const id = meta?.sessionId;
      if (id) void onForkSession(id);
      return;
    }
    if (s === "model") {
      modelMenuRef.current?.open();
      return;
    }
    if (s === "usage" || s === "cost") {
      usageClick();
      return;
    }
    if (s === "stop") {
      void stopRun();
      return;
    }
    commitCommandBlock(s);
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
  const canSend =
    Boolean(composeCommandInput(commandBlock, input).trim()) ||
    attachImages.length > 0;
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
  const statusFull = (() => {
    if (pending.length > 0) return "等待审批";
    if (busy) return "运行中";
    const s = (status || "").trim();
    if (!s) return "";
    if (/^模型\s/i.test(s)) return "";
    if (/已恢复|已删除/.test(s)) return "";
    return s;
  })();
  const statusError = /error|失败|不可用|HTML|JSON|后端|API\s*\d|拒绝|离线/i.test(
    statusFull,
  );
  const statusDisplay = (() => {
    if (!statusFull) return "";
    if (statusFull.length <= 8) return statusFull;
    if (statusError) {
      if (/HTML|host 未就绪|桌面|Unexpected token/i.test(statusFull)) {
        return "离线";
      }
      return "错误";
    }
    return statusFull.length > 12 ? `${statusFull.slice(0, 10)}…` : statusFull;
  })();

  const slashMenu = typingSlash && !overlayDismissed && slashHits.length > 0 && (
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
    const liveSlashNow =
      !commandBlock &&
      slashPrefixAtCursor(
        e.currentTarget.value,
        e.currentTarget.selectionStart ?? 0,
      ) != null;
    const overlayHits = paletteOpen
      ? paletteHits.map((c) => c.name)
      : mentionOpen
        ? mentionHits
        : slashHits;
    const overlayIdx = paletteOpen
      ? paletteIdx
      : mentionOpen
        ? mentionIdx
        : slashIdx;
    const setOverlayIdx = paletteOpen
      ? setPaletteIdx
      : mentionOpen
        ? setMentionIdx
        : setSlashIdx;
    const overlayOpen =
      paletteOpen ||
      mentionOpen ||
      (liveSlashNow && !overlayDismissed && !commandBlock);
    const overlayAct = overlayKeyAction(e, overlayOpen, overlayHits.length);
    if (overlayAct === "nav-down") {
      e.preventDefault();
      setOverlayIdx((i) => (i + 1) % overlayHits.length);
      return;
    }
    if (overlayAct === "nav-up") {
      e.preventDefault();
      setOverlayIdx((i) => (i - 1 + overlayHits.length) % overlayHits.length);
      return;
    }
    if (overlayAct === "pick") {
      e.preventDefault();
      const pick = overlayHits[Math.min(overlayIdx, overlayHits.length - 1)];
      if (pick) {
        if (mentionOpen) {
          replaceInput(
            applyMentionPick(inputRef.current?.value ?? input, pick),
          );
        } else if (paletteOpen) applyPaletteHit(pick);
        else applySlashHit(pick);
      }
      return;
    }
    if (overlayAct === "close") {
      e.preventDefault();
      setSlashOpen(false);
      setPaletteOpen(false);
      setOverlayDismissed(true);
      return;
    }
    if (e.key === "Escape") {
      setSlashOpen(false);
      setPaletteOpen(false);
    }
    // Ctrl/Cmd+Enter：强制插入模式
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
      e.preventDefault();
      if (!input.trim() && busy && queueLen > 0) {
        void steerAllQueued();
        return;
      }
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

  const onComposerInput = (v: string) => {
    setInput(v);
    setOverlayDismissed(false);
    const at = inputRef.current?.selectionStart ?? cursorRef.current;
    cursorRef.current = at;
    const prefix = slashPrefixAtCursor(v, at);
    const open = prefix != null;
    setSlashOpen(open && !paletteOpen);
    setSlashIdx((idx) =>
      overlayIdxAfterPrefix(slashPrefixRef.current, prefix, idx),
    );
    slashPrefixRef.current = prefix;
    setMentionIdx(0);
    if (paletteOpen && !open) setPaletteOpen(false);
  };

  const onComposerChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    onComposerInput(e.target.value);
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
            lastInputTokens: r.stats.lastInputTokens,
            lastOutputTokens: r.stats.lastOutputTokens,
            contextUsed: r.stats.contextUsed,
            file: r.stats.file,
          });
        } else {
          setUsageModalStats(null);
          setUsageModalRaw(r.text || "（无 session stats）");
        }
        // Keep chip % in sync
        if (r.stats) {
          const used =
            r.stats.contextUsed != null && r.stats.contextUsed > 0
              ? r.stats.contextUsed
              : (r.stats.lastInputTokens ?? 0) + (r.stats.lastOutputTokens ?? 0);
          patchContextUsage({
            used,
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
      ) : null}
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
          !canSend
            ? "输入文字后发送"
            : busy
              ? sendMode === "insert"
                ? "插入发送 (Enter) · 打断当前流"
                : "排队发送 (Enter) · 本轮结束后投递"
              : `发送 (Enter) · 模式 ${sendModeLabel}`
        }
      >
        <ChromeMark kind="send" size={15} decorative />
      </button>
    </div>
  );

  const composerProps: ComposerProps = {
    variant: "live",
    input,
    inputEpoch,
    busy,
    pendingApproval: pending.length > 0,
    sendMode,
    placeholder:
      pending.length > 0
        ? "可先输入下一条… 处理审批后发送"
        : busy && !input.trim() && queueLen > 0
          ? "空稿 ⌃↵ 将排队全部插入当前轮"
          : busy
            ? sendMode === "insert"
              ? "运行中… Enter 插入打断 · Ctrl+Enter 同 · Alt+Enter 切队列"
              : "运行中… Enter 排队 · Ctrl+Enter 插入打断 · Alt+Enter 切模式"
            : "输入消息… Enter 发送，Shift+Enter 换行",
    statusDisplay,
    statusTitle: statusFull,
    statusError,
    slashHits,
    slashIdx,
    slashOpen: !commandBlock && !overlayDismissed && typingSlash,
    paletteOpen,
    paletteHits: commandHits,
    paletteIdx,
    mentionOpen,
    mentionHits,
    mentionIdx,
    filePaths,
    images: attachImages,
    outbox,
    provider: meta?.provider ?? "",
    model: meta?.model ?? "",
    providers: providerOptions,
    models: modelOptions,
    approval,
    permissionPreset: meta?.permissionPreset,
    planStatus: meta?.plan?.status ?? sessionPlanView?.plan?.status,
    planActive: meta?.plan?.active ?? sessionPlanView?.plan?.active,
    onPlanToggle: () => {
      void togglePlan()
        .then((m) => {
          pushMeta(m);
          return refreshPlan();
        })
        .catch((e) => setStatus(e instanceof Error ? e.message : String(e)));
    },
    contextPct,
    contextBreakdown,
    canRetry,
    canSteerQueue: Boolean(busy && queueLen > 0 && !input.trim()),
    inputRef,
    modelMenuRef,
    agentName: meta?.agentName,
    onInputChange: onComposerInput,
    onCursorChange: (n) => {
      cursorRef.current = n;
      const live = inputRef.current?.value ?? input;
      const open = slashPrefixAtCursor(live, n) != null;
      setSlashOpen(open && !paletteOpen && !commandBlock && !overlayDismissed);
    },
    commandBlock,
    commandBlockSelected,
    onCommandBlockChange: setCommandBlock,
    onCommandBlockSelect: setCommandBlockSelected,
    onInputPaste: (e: ClipboardEvent<HTMLTextAreaElement>) => {
      const dt = e.clipboardData;
      const hasImg = Boolean(
        dt &&
          ([...dt.files].some((f) => f.type.startsWith("image/")) ||
            [...dt.items].some(
              (it) => it.kind === "file" && it.type.startsWith("image/"),
            )),
      );
      if (!hasImg) return;
      e.preventDefault();
      void clipboardToComposerImages(dt, attachImages.length).then((extra) => {
        if (!extra.length) return;
        setAttachImages((prev) => mergeComposerImages(prev, extra));
      });
    },
    onImagesChange: setAttachImages,
    onInputBlur: () => {
      window.setTimeout(() => setSlashOpen(false), 120);
    },
    onInputKeyDown: onComposerKeyDown,
    onSend: () => void send(),
    onStop: () => void stopRun(),
    onCycleSendMode: cycleSendMode,
    onSlashPick: applySlashHit,
    onSlashHighlight: setSlashIdx,
    onPalettePick: applyPaletteHit,
    onPaletteHighlight: setPaletteIdx,
    commandCatalog,
    onMentionPick: (path) =>
      replaceInput(applyMentionPick(inputRef.current?.value ?? input, path)),
    onCommandLaunch,
    onOverlayDismiss,
    onModelSelect: onCascadeModelSelect,
    onModelsLoaded: (pid, list) => {
      if (pid === (meta?.provider || pid)) setModels(list);
    },
    onApprovalChange: (mode) => void onApprovalChange(mode),
    onUsageClick: usageClick,
    onRetryLast: () => retryLastUser(),
    onCopyTranscript: () => {
      void exportTranscript()
        .then((t) => copyToClipboard(t))
        .then(() => setStatus("已复制 transcript"))
        .catch((err) =>
          setStatus(err instanceof Error ? err.message : String(err)),
        );
    },
    onRemoveOutbox: (item) => void removeOutboxItem(item),
    onClearOutbox: () => void clearOutboxQueued(),
    onRetryOutbox: retryOutboxItem,
    onSteerOutbox: (item) => void steerOutboxItem(item),
  };

  const wireComposer = (
    <OptionalOutlet
      name="conversation.composer"
      props={composerProps}
      fallback={<Composer {...composerProps} />}
    />
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

  const composerDock = isWire ? (
    composer
  ) : (
    <div className="codex-composer-dock">
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
      {composer}
    </div>
  );

  return (
    <div
      className={`chat-panel codex-chat${rootExtra}${
        busy ? " has-busy" : ""
      }${pending.length > 0 ? " has-approval" : ""}${
        showPlanReview ? " has-plan-review" : ""
      }${
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
      {isWire ? (
        <ConversationPane
          trail={
            <SessionTreeCrumbs
              sessions={sessions}
              activeSessionId={meta?.sessionId ?? null}
              runningSessionIds={runningSessionIds}
              onSelect={(id) => {
                void onSessionChange(id);
              }}
              onFork={(id) => void onForkSession(id)}
              onNewChild={(id) => void onNewChildSession(id)}
            />
          }
          jumpPrev={null}
          scrollRef={logRef}
          empty={lines.length === 0 && contextHydrated}
          rail={
            lines.length === 0 ? null : (
              <AskScrollRail
                scrollRef={logRef}
                revision={`${lines.length}:${lines[lines.length - 1]?.id ?? ""}`}
              />
            )
          }
          messages={messageList}
          jumpBottom={
            showBackToBottom ? (
              <button
                type="button"
                className="wire-jump-bottom"
                onClick={scrollThreadToBottom}
                title="回到底部"
                aria-label="回到底部"
              >
                ↓ 回到底部
              </button>
            ) : null
          }
          permit={
            <>
              {approvalBlock}
            </>
          }
          composer={composerDock}
        />
      ) : (
        <>
          {approvalBlock}
          <div className="codex-thread-scroll">{messageList}</div>
          {composerDock}
        </>
      )}
      {createPortal(
        <PayloadInspector
          open={payloadOpen}
          onClose={() => setPayloadOpen(false)}
          view={payloadView}
          title={payloadTitle}
          detail={payloadDetail}
          loading={payloadLoading}
          error={payloadError}
        />,
        document.body,
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

function renderSearchHighlight(text: string): React.ReactNode {
  const parts = text.split(/(\[[^\]]+\])/g);
  return parts.map((p, i) =>
    p.startsWith("[") && p.endsWith("]") && p.length > 2 ? (
      <mark key={i}>{p.slice(1, -1)}</mark>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
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
  onFork?: (id: string) => void;
  onNewChild?: (id: string) => void;
}) {
  const wire = Boolean(props.wire);
  const running = new Set(props.runningSessionIds ?? []);
  const [searchQ, setSearchQ] = useState("");
  const [hits, setHits] = useState<SessionSearchHit[]>([]);
  useEffect(() => {
    const q = searchQ.trim();
    if (!q) {
      setHits([]);
      return;
    }
    const t = window.setTimeout(() => {
      void searchSessions(q, { limit: 20 })
        .then((r) => setHits(r.items))
        .catch(() => setHits([]));
    }, 200);
    return () => window.clearTimeout(t);
  }, [searchQ]);
  const busyHint = props.busy
    ? wire
      ? " · 当前会话运行中（其它会话可并行）"
      : " · current session running (others keep going)"
    : "";
  const untitled = wire ? "未命名" : "Untitled";
  const forest = flattenSessionForest(props.sessions);
  // Wire = SessionList single-line rows (title · count · time). Never mix
  // thread-item column CSS with wire-session-btn 32px row — that
  // clipped Chinese glyphs into garbage (see live shell session rail).
  if (wire) {
    const mapped: DraftSession[] = props.sessions.map((s) => ({
      id: s.id,
      title: (s.title || untitled).trim() || untitled,
      agent: props.agentLabel || "",
      timeLabel: relativeTime(s.lastMsgAt || s.updatedAt, true),
      messageCount: s.userTurns,
      parentSessionId: s.parentSessionId,
      lamp: s.lamp,
      helperCount: s.helperCount,
    }));
    return (
      <SessionList
        className="thread-rail"
        sessions={mapped}
        activeId={props.activeId ?? ""}
        agentLabel={props.agentLabel}
        busy={props.busy}
        runningSessionIds={props.runningSessionIds}
        onSelect={props.onSelect}
        onNew={props.onNew}
        onDelete={props.onDelete}
        onFork={props.onFork}
        onNewChild={props.onNewChild}
        onRename={props.onRename}
        query={searchQ}
        onQueryChange={setSearchQ}
        searchHits={hits.map((h) => ({
          key: `${h.sessionId}:${h.absSeq}:${h.seq}`,
          sessionId: h.sessionId,
          snippet: h.snippet,
        }))}
      />
    );
  }
  return (
    <div
      className={`thread-rail${props.busy ? " is-busy" : ""}${
        running.size > 0 ? " has-running" : ""
      }`}
      aria-label="Sessions"
    >
      <div>
        <button
          type="button"
          className="thread-new"
          onClick={props.onNew}
          title={`New task${busyHint}`}
        >
          New task
        </button>
      </div>
      <div className="thread-list-label">Sessions</div>
      <div className="thread-search">
        <input
          type="search"
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
          placeholder="Search sessions"
          aria-label="Search sessions"
        />
      </div>
      {hits.length > 0 ? (
        <div className="thread-search-hits">
          {hits.map((h) => (
            <button
              key={`${h.sessionId}:${h.absSeq}:${h.seq}`}
              type="button"
              className="thread-search-hit"
              onClick={() => props.onSelect(h.sessionId)}
            >
              {renderSearchHighlight(h.snippet)}
            </button>
          ))}
        </div>
      ) : null}
      <div className="thread-list">
        {props.sessions.length === 0 && (
          <div className="thread-empty">No sessions yet</div>
        )}
        {forest.map(({ node: s }) => {
          const active = s.id === props.activeId;
          const isRunning = running.has(s.id);
          const title = (s.title || untitled).trim() || untitled;
          const when = relativeTime(s.lastMsgAt || s.updatedAt, false);
          const countHint =
            s.userTurns > 0
              ? `${s.userTurns} message${s.userTurns === 1 ? "" : "s"}`
              : "Empty session";
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
