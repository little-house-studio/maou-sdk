/**
 * UIState → Ratatui 全量语义快照。
 */

import type { ChatMessage, SystemEvent, UIState, MessageAuthor } from "../state/types.js";
import { APPROVAL_LABELS } from "../state/types.js";
import { formatCacheLabel } from "../lib/prompt-cache.js";
import type {
  ProtoChrome,
  ProtoMessage,
  ProtoSystemEvent,
  ProtoThinking,
  ProtoToolCard,
  ProtoTheme,
  ProtoSupervisor,
} from "./protocol-types.js";
import type { ThemeTokens } from "../theme/tokens.js";
import { getActiveTheme } from "../theme/load-theme.js";
import { getNavAction } from "../config/nav-actions.js";
import type { ProtoNavItem } from "./protocol-types.js";
import { isLiteMode, LITE_HISTORY_BASE } from "../config/lite-mode.js";
import { HISTORY_BASE_ROUNDS } from "../config/ui-constants.js";
import { estimateTokens, estimateContextTokens } from "@little-house-studio/llm";
import { uncachedInputTokens } from "@little-house-studio/agent";
import { previewCurrentSystemPrompt } from "../lib/preview-system.js";
import { buildPerfHudPayload } from "./perf-hud-lines.js";

/** Cache system prompt text for idle ↑ estimate (Ink EventBlock useMemo on agentName). */
let cachedSystemPromptAgent = "";
let cachedSystemPromptText = "";
function systemPromptForAgent(agentName: string | undefined): string {
  const name = agentName ?? "";
  if (name === cachedSystemPromptAgent) return cachedSystemPromptText;
  try {
    const r = previewCurrentSystemPrompt(name || "coding");
    cachedSystemPromptText = r.ok ? r.text : "";
  } catch {
    cachedSystemPromptText = "";
  }
  cachedSystemPromptAgent = name;
  return cachedSystemPromptText;
}

export function toProtoTool(
  t: NonNullable<ChatMessage["toolCalls"]>[number],
  expandedIds: Set<string>,
): ProtoToolCard {
  // 默认折叠：仅用户点开 expandedIds 才展开（执行中也不自动撑开）
  return {
    id: t.id,
    name: t.name,
    args: t.args ?? "",
    result: t.result,
    is_error: t.isError,
    done: t.done,
    duration_ms: t.callDuration,
    expanded: expandedIds.has(t.id),
  };
}

export function toProtoThinking(
  t: NonNullable<ChatMessage["thinkingBlocks"]>[number],
  expandedIds: Set<string>,
): ProtoThinking {
  // 流式中展开看过程；结束后默认收成一行标识（仅用户点开才 expandedIds）
  const collapsed = !t.streaming && !expandedIds.has(t.id);
  return {
    id: t.id,
    content: t.content,
    streaming: t.streaming,
    duration_ms: t.duration,
    collapsed,
  };
}

function authorLabel(author: MessageAuthor | undefined, role: string): string {
  if (!author?.type) return role;
  const name = author.displayName || author.id;
  switch (author.type) {
    case "human":
      return name && name !== "user" ? `user:${name}` : "user";
    case "agent":
      return name ? `agent:${name}` : "agent";
    case "system":
      return name ? `system:${name}` : "system";
    case "tool":
      return name ? `tool:${name}` : "tool";
    default:
      return role;
  }
}

export function toProtoMessage(
  m: ChatMessage,
  expandedTools: Set<string>,
  expandedThinking: Set<string>,
  expandedMsgs: Set<string>,
  /** 用户强制收纳（最新轮默认开时点一下） */
  collapsedMsgs?: Set<string>,
  /** 是否在最新一轮（默认开） */
  inLatestRound?: boolean,
): ProtoMessage {
  const toolCards = (m.toolCalls ?? []).map((t) => toProtoTool(t, expandedTools));
  // 展开态：强制开 > 强制关 > 最新轮默认开 > 历史默认关
  let open = false;
  if (m.streaming) open = true;
  else if (collapsedMsgs?.has(m.id)) open = false;
  else if (expandedMsgs.has(m.id)) open = true;
  else open = inLatestRound === true;
  const baseKind = (m.kind ?? "").replace(/\|expanded/g, "");
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    ts: m.ts,
    streaming: m.streaming,
    tools: toolCards.map((t) => t.name),
    tool_cards: toolCards,
    thinking: (m.thinkingBlocks ?? []).map((t) => toProtoThinking(t, expandedThinking)),
    duration_ms: m.duration,
    round: m.round,
    kind: open ? `${baseKind}|expanded` : baseKind || undefined,
    author_label: authorLabel(m.author, m.role),
    usage_input: m.usage?.input,
    usage_output: m.usage?.output,
  };
}

export function toProtoSystemEvent(e: SystemEvent): ProtoSystemEvent {
  return {
    id: e.id,
    kind: e.kind,
    content: e.content,
    ts: e.ts,
    detail: e.detail,
  };
}

export function toProtoChrome(s: UIState): ProtoChrome {
  // 会话累计 token；InfoBar 优先用最近一轮上下文窗口占用（input/total），否则累计
  const used =
    s.rounds.reduce((a, r) => a + (r.input ?? 0) + (r.output ?? 0), 0) +
    (s.currentRoundUsage?.input ?? 0) +
    (s.currentRoundUsage?.output ?? 0);
  const lastRound = s.rounds[s.rounds.length - 1];
  // 最近一轮 prompt/input；0 时回退累计 used（避免恢复会话后显示 0/max）
  const lastCtx = lastRound
    ? (lastRound.total ?? lastRound.input ?? 0)
    : (s.currentRoundUsage?.input ?? 0);
  const ctxTokens = lastCtx > 0 ? lastCtx : used;
  const {
    label: cacheLabel,
    pct: cachePct,
    eligible: cacheEligible,
  } = formatCacheLabel(s.model, s.provider, s.cacheHistory, 10);
  const mode = s.approvalMode;
  const approvalLabel = APPROVAL_LABELS[mode]?.short ?? mode;
  const lite = isLiteMode();
  let supervisor: ProtoSupervisor | null = null;
  if (s.supervisor?.active) {
    supervisor = {
      active: true,
      state: s.supervisor.state,
      plan: s.supervisor.plan,
      verify_rounds: s.supervisor.verifyRounds,
      last_verdict: s.supervisor.lastVerdict,
    };
  }
  // Ink EventBlock: busy = uncachedInputTokens(usage); idle = estimateContextTokens + draft − cache
  const draft = (s as UIState & { inputDraft?: string }).inputDraft ?? "";
  let up = s.eventBlock.upTokens ?? s.currentRoundUsage?.input ?? 0;
  const liveMode = s.eventBlock.mode ?? "idle";
  if (s.streaming || ((s.currentRoundUsage?.input ?? 0) > 0 && liveMode !== "idle")) {
    up = uncachedInputTokens({
      input_tokens: s.currentRoundUsage?.input ?? 0,
      cache_read_input_tokens: s.currentRoundUsage?.cacheRead ?? 0,
    });
  } else {
    const historyMsgs = s.messages.map((m) => {
      const parts: string[] = [];
      if (m.content) parts.push(m.content);
      for (const b of m.thinkingBlocks ?? []) {
        if (b.content) parts.push(b.content);
      }
      for (const tc of m.toolCalls ?? []) {
        parts.push(`${tc.name} ${tc.args ?? ""}`);
        if (tc.result) parts.push(tc.result);
      }
      return { content: parts.join("\n") };
    });
    if (draft.trim()) historyMsgs.push({ content: draft });
    // Ink EventBlock: system + session messages + draft − last cache_read
    const sys = systemPromptForAgent(s.agentName);
    const totalEst = estimateContextTokens({
      systemPrompt: sys || undefined,
      messages: historyMsgs,
    });
    const lastIdleRound = s.rounds.length > 0 ? s.rounds[s.rounds.length - 1] : null;
    const lastCache = lastIdleRound?.cacheRead ?? 0;
    const draftTok = draft.trim() ? estimateTokens(draft) : 0;
    if (lastCache > 0 && totalEst > 0) {
      up = Math.max(draftTok, totalEst - lastCache);
    } else {
      // first round / no cache: whole package is new input (Ink: totalEst, may be 0)
      up = totalEst > 0 ? totalEst : draftTok;
    }
  }

  return {
    status: s.streaming
      ? s.aborting
        ? "ABORTING"
        : s.eventBlock.mode === "tool_pending"
          ? "TOOL"
          : s.eventBlock.mode === "thinking"
            ? "THINKING"
            : "STREAMING"
      : s.eventBlock.mode === "error"
        ? "ERROR"
        : "IDLE",
    streaming: s.streaming,
    aborting: s.aborting,
    event_mode: s.eventBlock.mode,
    up_tokens: up,
    down_tokens: s.eventBlock.downTokens ?? s.currentRoundUsage?.output ?? 0,
    detail: s.eventBlock.detail,
    approval_mode: mode,
    approval_label: approvalLabel,
    agent: s.agentName,
    provider: s.provider,
    model: s.model,
    max_context: s.maxContext,
    used_tokens: ctxTokens || used,
    cache_label: cacheLabel,
    // Ink InfoBar: color cache by hit rate when eligible + sample present
    cache_pct: cacheEligible && cachePct != null ? cachePct : undefined,
    cache_eligible: cacheEligible && cachePct != null,
    session_id: s.sessionId,
    toast: s.toast ? { text: s.toast.text, kind: s.toast.kind } : null,
    overlay: s.overlay,
    pending_count: (s as UIState & { pendingMessages?: string[] }).pendingMessages?.length ?? 0,
    empty_hint:
      s.messages.length === 0
        ? "输入消息开始对话 · Ctrl+K 命令 · Ctrl+C 退出"
        : undefined,
    back_to_bottom: !s.autoFollow && s.chatScrollOffset > 0,
    input_placeholder: s.streaming
      ? "生成中… 可继续输入（Enter 排队）"
      : "输入文字…（/ 命令 · Ctrl+E 全屏）",
    lite,
    history_base: lite ? LITE_HISTORY_BASE : HISTORY_BASE_ROUNDS,
    perf_hud: s.perfHud !== false,
    ...(() => {
      if (s.perfHud === false) {
        return {
          perf_lines: undefined as string[] | undefined,
          perf_heat: undefined as string | undefined,
        };
      }
      const agentBusy =
        s.streaming ||
        s.eventBlock.mode === "tool_pending" ||
        s.eventBlock.mode === "thinking" ||
        s.eventBlock.mode === "generating" ||
        s.eventBlock.mode === "retrying";
      const hud = buildPerfHudPayload(s.messages.length, agentBusy);
      return hud
        ? { perf_lines: hud.lines, perf_heat: hud.heat }
        : { perf_lines: undefined as string[] | undefined, perf_heat: undefined as string | undefined };
    })(),
    supervisor,
    event_block_expanded: s.eventBlockExpanded,
    // Ink EventBlockExpanded body
    supervisor_messages: (s.supervisorMessages ?? [])
      .map((m) => m.content ?? "")
      .filter((c) => c.length > 0)
      .slice(-80),
  };
}

/**
 * ThemeTokens → ProtoTheme。
 * Nav 段：主题 order/items 色+文案 + nav-actions 动作；无写死配色/标签。
 */
export function toProtoTheme(t: ThemeTokens): ProtoTheme {
  const loaded = getActiveTheme();
  const navCfg = loaded.nav;
  const itemsMap = navCfg?.items ?? {};
  const order =
    navCfg?.order?.length > 0
      ? navCfg.order
      : Object.keys(itemsMap);

  const nav_items: ProtoNavItem[] = [];
  for (const id of order) {
    const it = itemsMap[id];
    if (!it) continue;
    const act = getNavAction(id);
    nav_items.push({
      id,
      label: it.label || id,
      short: it.short || it.label || id,
      bg: it.bg,
      bg_hover: it.bgHover,
      fg: it.fg,
      fg_hover: it.fgHover,
      action_kind: act?.kind ?? "noop",
      action_value: act?.value,
    });
  }

  // 兼容旧字段：按 id 填 legacy nav_*（若 Rust 未升级仍能上色）
  const byId = Object.fromEntries(nav_items.map((n) => [n.id, n]));
  const leg = (id: string) => byId[id];

  return {
    bg: t.bg,
    panel_bg: t.panelBg,
    fg: t.fg,
    muted: t.muted,
    dim: t.dim,
    accent: t.accent,
    accent2: t.accent2,
    ok: t.ok,
    warn: t.warn,
    err: t.err,
    info: t.info,
    user: t.user,
    assistant: t.assistant,
    system: t.system,
    tool: t.tool,
    tool_result: t.toolResult,
    user_bg: t.userBg,
    system_bg: t.systemBg,
    footer_bg: t.footerBg,
    input_field_bg: t.inputFieldBg,
    border: t.border,
    selected_bg: t.selectedBg,
    assistant_md_bg: t.assistantMdBg,
    md_heading: t.mdHeading,
    md_heading2: t.mdHeading2,
    md_heading3: t.mdHeading3,
    md_code: t.mdCode,
    md_code_block: t.mdCodeBlock,
    md_quote: t.mdQuote,
    md_quote_border: t.mdQuoteBorder,
    md_list_bullet: t.mdListBullet,
    md_link: t.mdLink,
    md_hr: t.mdHr,
    tool_diff_added: t.toolDiffAdded,
    tool_diff_removed: t.toolDiffRemoved,
    tool_diff_context: t.toolDiffContext,
    nav_agent: leg("agent")?.bg,
    nav_sessions: leg("sessions")?.bg,
    nav_terminal: leg("terminal")?.bg,
    nav_todo: leg("todo")?.bg,
    nav_inbox: leg("inbox")?.bg,
    nav_notice: leg("notice")?.bg,
    nav_settings: leg("settings")?.bg,
    nav_agent_hover: leg("agent")?.bg_hover,
    nav_sessions_hover: leg("sessions")?.bg_hover,
    nav_terminal_hover: leg("terminal")?.bg_hover,
    nav_todo_hover: leg("todo")?.bg_hover,
    nav_inbox_hover: leg("inbox")?.bg_hover,
    nav_notice_hover: leg("notice")?.bg_hover,
    nav_settings_hover: leg("settings")?.bg_hover,
    nav_items,
    // 选区：跟主题 info / frost 协调
    sel_bg: t.info ?? t.accent,
    sel_fg: t.fg ?? t.user,
  };
}

export interface SnapshotOpts {
  expandedTools?: Set<string>;
  expandedThinking?: Set<string>;
  expandedMsgs?: Set<string>;
  /** 用户强制收纳的消息 id（最新轮默认开时点收） */
  collapsedMsgs?: Set<string>;
  theme?: ThemeTokens | null;
  overlay?: {
    kind: string;
    title: string;
    footer: string;
    items: Array<{ value: string; label: string; description?: string }>;
    lines?: string[];
    selected?: number;
  } | null;
  completions?: {
    items: Array<{ value: string; label: string; description?: string }>;
    sel: number;
    prefix: string;
    range: { start: number; end: number };
  } | null;
  terminalApproval?: {
    id: string;
    command: string;
    agent_name?: string;
    hint?: string;
  } | null;
  input?: string;
  gallery_lines?: string[];
  /** Force Ratatui hard full paint (after /new, clear, layout blow-up) */
  full_paint?: boolean;
}

/** 统一 state 推送（Rust 主入口） */
export function buildFullState(s: UIState, opts: SnapshotOpts = {}): Record<string, unknown> {
  const et = opts.expandedTools ?? new Set<string>();
  const eth = opts.expandedThinking ?? new Set<string>();
  const em = opts.expandedMsgs ?? new Set<string>();
  const cm = opts.collapsedMsgs ?? new Set<string>();
  // 最后一条真人 user 及其后 = 最新一轮
  let lastHuman = -1;
  for (let i = s.messages.length - 1; i >= 0; i--) {
    const m = s.messages[i]!;
    if (m.role !== "user") continue;
    const kind = m.kind ?? "human_user";
    if (
      kind === "system_notice" ||
      kind === "runtime_control" ||
      kind === "agent_message" ||
      kind === "compact" ||
      kind === "unknown"
    ) {
      continue;
    }
    lastHuman = i;
    break;
  }
  return {
    type: "state",
    messages: s.messages.map((m, idx) =>
      toProtoMessage(m, et, eth, em, cm, lastHuman < 0 || idx >= lastHuman),
    ),
    system_events: s.systemEvents.map(toProtoSystemEvent),
    streaming: s.streaming,
    status: toProtoChrome(s).status,
    chrome: toProtoChrome(s),
    theme: opts.theme ? toProtoTheme(opts.theme) : undefined,
    overlay: opts.overlay ?? null,
    completions: opts.completions ?? null,
    terminal_approval: opts.terminalApproval
      ?? (s.terminalApproval
        ? {
            id: s.terminalApproval.id,
            command: s.terminalApproval.command,
            agent_name: s.terminalApproval.agentName,
            hint: s.terminalApproval.summary || s.terminalApproval.hint,
            risk: s.terminalApproval.risk,
            summary: s.terminalApproval.summary,
            label: s.terminalApproval.label,
            rule_id: s.terminalApproval.ruleId,
            reason: s.terminalApproval.reason,
          }
        : null),
    input: opts.input,
    gallery_lines: opts.gallery_lines,
    full_paint: opts.full_paint === true ? true : undefined,
  };
}

export function buildStateMessage(s: UIState, opts?: SnapshotOpts): Record<string, unknown> {
  return buildFullState(s, opts);
}
