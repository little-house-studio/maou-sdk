/**
 * UIState → Ratatui 全量语义快照。
 */

import { stripTaskCompletionMarkup } from "@little-house-studio/types";
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
import { tipsForContext } from "../config/cli-tips.js";
import { HISTORY_BASE_ROUNDS } from "../config/ui-constants.js";
import { uncachedInputTokens } from "@little-house-studio/agent";
import { occupancyFromState } from "../lib/context-occupancy.js";
import { buildPerfHudPayload } from "./perf-hud-lines.js";

/**
 * 协议侧 duration 用整数 ms。
 *
 * `undefined` = **未知**（UI 留空）；`0` 是合法的「快到测不出」，会显示成 1ms —— 两者
 * 不能混同，否则瞬时完成的工具看起来像丢了数据。负数视为坏数据 → 未知。
 */
function msInt(v: number | undefined | null): number | undefined {
  if (v == null || !Number.isFinite(v) || v < 0) return undefined;
  return Math.max(1, Math.round(v));
}

/**
 * 耗时口径：**已完成的一律封口，只有进行中才跟 now() 走**。
 *
 * 否则一条早已结束、但 duration 没落库的记录，每帧都会 `now() - startTs` 重算，
 * 屏幕上的耗时便一直往上涨（历史工具卡显示几分钟就是这么来的）。
 *
 * @param settled  是否已结束（工具 done / thinking !streaming / 消息 !streaming）
 * @param stored   已落库耗时（权威）
 * @param startTs  开始时刻
 * @param endTs    结束时刻（有则用于封口，替代 now()）
 */
function resolveDuration(
  settled: boolean,
  stored: number | undefined,
  startTs: number | undefined,
  endTs?: number,
): number | undefined {
  if (stored != null && Number.isFinite(stored) && stored >= 0) return stored;
  if (startTs == null) return undefined;
  if (settled) {
    // 已结束但没落库：只能用真实结束时刻封口；没有就认「未知」，绝不用 now()
    return endTs != null ? Math.max(0, endTs - startTs) : undefined;
  }
  return Math.max(0, Date.now() - startTs);
}

export function toProtoTool(
  t: NonNullable<ChatMessage["toolCalls"]>[number],
  expandedIds: Set<string>,
): ProtoToolCard {
  // 默认折叠：仅用户点开 expandedIds 才展开（执行中也不自动撑开）
  const duration = resolveDuration(t.done === true, t.callDuration, t.callStartTs);
  return {
    id: t.id,
    name: t.name,
    args: t.args ?? "",
    result: t.result,
    is_error: t.isError,
    done: t.done,
    duration_ms: msInt(duration),
    expanded: expandedIds.has(t.id),
  };
}

export function toProtoThinking(
  t: NonNullable<ChatMessage["thinkingBlocks"]>[number],
  expandedIds: Set<string>,
): ProtoThinking {
  // 流式中展开看过程；结束后默认收成一行标识（仅用户点开才 expandedIds）
  const collapsed = !t.streaming && !expandedIds.has(t.id);
  const duration = resolveDuration(!t.streaming, t.duration, t.startTs);
  return {
    id: t.id,
    content: t.content,
    streaming: t.streaming,
    duration_ms: msInt(duration),
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
  // 消息耗时：已落库 duration 优先；流式中才跟 now() 走，已结束用 doneTs 封口
  const msgDur = resolveDuration(m.streaming !== true, m.duration, m.ts, m.doneTs);
  return {
    id: m.id,
    role: m.role,
    content: stripTaskCompletionMarkup(m.content),
    ts: m.ts,
    streaming: m.streaming,
    tools: toolCards.map((t) => t.name),
    tool_cards: toolCards,
    thinking: (m.thinkingBlocks ?? []).map((t) => toProtoThinking(t, expandedThinking)),
    duration_ms: msInt(msgDur),
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
    action: e.action,
  };
}

/**
 * 目标一句话：取 plan 首个非空行，去掉 markdown 标题/列表符号。
 * chip 和详情标题共用同一来源，两处文案不会打架。
 */
function goalObjective(plan: string | undefined): string | undefined {
  const line = (plan ?? "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return undefined;
  const cleaned = line
    .replace(/^#{1,6}\s*/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/^\*\*|\*\*$/g, "")
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 160) : undefined;
}

export function toProtoChrome(s: UIState): ProtoChrome {
  // 占用 = 上一条回报的 input + output。无 usage 则为 0。
  const ctxTokens = occupancyFromState(s);
  // 镜像历史 + 本轮未封印的 currentRoundUsage，避免流式中/首轮永远 c—
  const cacheHistLive = [...(s.cacheHistory ?? [])];
  if (
    s.currentRoundUsage &&
    (s.currentRoundUsage.cacheEligible ||
      (s.currentRoundUsage.cacheRead ?? 0) > 0) &&
    ((s.currentRoundUsage.input ?? 0) > 0 ||
      (s.currentRoundUsage.cacheRead ?? 0) > 0)
  ) {
    cacheHistLive.push({
      cacheRead: s.currentRoundUsage.cacheRead ?? 0,
      input: s.currentRoundUsage.input ?? 0,
      cacheWrite: s.currentRoundUsage.cacheWrite ?? 0,
      model: s.model || undefined,
    });
  }
  const {
    label: cacheLabel,
    pct: cachePct,
    eligible: cacheEligible,
  } = formatCacheLabel(s.model, s.provider, cacheHistLive, 10);
  const mode = s.approvalMode;
  const approvalLabel = APPROVAL_LABELS[mode]?.short ?? mode;
  const lite = isLiteMode();
  let supervisor: ProtoSupervisor | null = null;
  if (s.supervisor?.active) {
    const baseline = s.supervisor.tokenBaseline ?? 0;
    const goalTokens = Math.max(0, ctxTokens - baseline);
    supervisor = {
      active: true,
      state: s.supervisor.state,
      plan: s.supervisor.plan,
      verify_rounds: s.supervisor.verifyRounds,
      last_verdict: s.supervisor.lastVerdict,
      objective: goalObjective(s.supervisor.plan),
      started_at_ms: s.supervisor.startedAtMs,
      tokens_used: goalTokens,
      token_budget: s.maxContext && s.maxContext > 0 ? s.maxContext : undefined,
    };
  }
  // ↑ 只认上一条真实 usage 的未缓存 input；idle 不再估算正文。
  let up = s.lastOccupancy?.input ?? 0;
  const liveMode = s.eventBlock.mode ?? "idle";
  if (s.streaming || ((s.currentRoundUsage?.input ?? 0) > 0 && liveMode !== "idle")) {
    up = uncachedInputTokens({
      input_tokens: s.lastOccupancy?.input ?? s.currentRoundUsage?.input ?? 0,
      cache_read_input_tokens: s.currentRoundUsage?.cacheRead ?? 0,
      cache_creation_input_tokens: s.currentRoundUsage?.cacheWrite ?? 0,
    });
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
    down_tokens: s.lastOccupancy?.output ?? s.eventBlock.downTokens ?? s.currentRoundUsage?.output ?? 0,
    detail: s.eventBlock.detail,
    approval_mode: mode,
    approval_label: approvalLabel,
    tips: tipsForContext({
      streaming: s.streaming,
      aborting: s.aborting,
      hasApproval: !!s.terminalApproval,
      overlay: (s.overlay as string | null) ?? null,
    }),
    agent: s.agentName,
    provider: s.provider,
    model: s.model,
    max_context: s.maxContext,
    used_tokens: ctxTokens,
    cache_label: cacheLabel,
    // color cache by hit rate when eligible + sample present
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
        s.agentBusy ||
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
    // EventBlockExpanded body
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
