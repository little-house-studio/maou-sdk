/**
 * CLI MessageRow head meta — shortId / timecode / duration / usage / LIVE.
 * Port of cli/tui-ratatui messages.rs (duration_str, short_id, loop_mark, heads).
 */

import type { DraftMessage, MessageRole } from "../types";

/** compact — local copy to avoid cycle with tool-card */
function compactCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** input / output / 占用（占用 = 二者之和）。轮次圆标 InfoHover 用，不进正文。 */
export function formatUsageLine(
  input?: number | null,
  output?: number | null,
): string {
  const inn = input != null && Number.isFinite(input) && input > 0 ? input : 0;
  const out = output != null && Number.isFinite(output) && output > 0 ? output : 0;
  if (inn <= 0 && out <= 0) return "";
  const parts: string[] = [];
  if (inn > 0) parts.push(`↑${compactCount(inn)}`);
  if (out > 0) parts.push(`↓${compactCount(out)}`);
  parts.push(`占用 ${compactCount(inn + out)}`);
  return parts.join(" · ");
}

/**
 * 缓存命中率 = cacheRead / promptTotal（口径见 core/llm cache-usage.ts）。
 * 模型不上报 cache 字段时返回 null —— 显示 “—”，不能写成假 0%。
 */
export function cacheHitRate(input: {
  promptTotal?: number | null;
  cacheRead?: number | null;
  reported?: boolean;
}): number | null {
  if (input.reported === false) return null;
  const total = input.promptTotal ?? 0;
  const read = input.cacheRead ?? 0;
  if (!Number.isFinite(total) || total <= 0) return null;
  if (!Number.isFinite(read) || read < 0) return null;
  return Math.min(1, read / total);
}

/** 0.6234 → "62.3%"；无口径 → "—" */
export function formatCacheRate(rate: number | null): string {
  if (rate == null) return "—";
  const pct = Math.round(rate * 1000) / 10;
  return `${pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(1)}%`;
}

/** 缓存行的值：命中率 + 命中量，例如 "62.3% · 8.1k" */
export function formatCacheCell(input: {
  promptTotal?: number | null;
  cacheRead?: number | null;
  reported?: boolean;
}): string {
  const rate = formatCacheRate(cacheHitRate(input));
  const read = input.cacheRead ?? 0;
  if (rate === "—") return "—";
  return read > 0 ? `${rate} · ${compactCount(read)}` : rate;
}

/** None → ""; 0 → "0ms" (must not look like missing). */
export function durationStr(ms: number | undefined | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "";
  const d = Math.round(ms);
  if (d < 1000) return `${d}ms`;
  if (d < 60_000) {
    const s = d / 1000;
    const rounded = Math.round(s);
    if (rounded >= 60) return "1m00s";
    if (Math.abs(s - rounded) < 0.05) return `${rounded}s`;
    return `${s.toFixed(1)}s`;
  }
  if (d < 3_600_000) {
    const m = Math.floor(d / 60_000);
    const s = Math.floor((d % 60_000) / 1000);
    return `${m}m${String(s).padStart(2, "0")}s`;
  }
  const h = Math.floor(d / 3_600_000);
  const m = Math.floor((d % 3_600_000) / 60_000);
  const s = Math.floor((d % 60_000) / 1000);
  return `${h}h${String(m).padStart(2, "0")}m${String(s).padStart(2, "0")}s`;
}

/** shortId: strip leading m/u then first 6 chars */
export function shortId(id: string): string {
  let s = id;
  if (s.startsWith("m")) s = s.slice(1);
  if (s.startsWith("u")) s = s.slice(1);
  // also strip draft showcase prefixes like n1-fc-
  const last = s.includes("-") ? s.split("-").pop()! : s;
  return last.slice(0, 6);
}

/** loopMark → ↺N */
export function loopMark(round: number | undefined | null): string {
  if (round == null || round <= 0) return "";
  return `↺${round}`;
}

/** HH:MM:SS local from epoch ms; missing → "" */
export function timecode(tsMs: number | undefined | null): string {
  if (tsMs == null || !Number.isFinite(tsMs) || tsMs <= 0) return "";
  const d = new Date(tsMs);
  const h = d.getHours();
  const m = d.getMinutes();
  const s = d.getSeconds();
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** `agent:ops` → `ops` */
export function displayAgentName(label: string): string {
  const t = label.trim();
  if (t.toLowerCase().startsWith("agent:")) return t.slice(6).trim() || t;
  return t;
}

export function defaultAuthorLabel(role: MessageRole, agentName = "coding"): string {
  switch (role) {
    case "user":
      return "user";
    case "assistant":
      return `agent:${agentName}`;
    case "system":
      return "system";
    case "tool":
      return "tool";
    case "thinking":
      return "think";
    case "err":
      return "error";
    default:
      return role;
  }
}

export type MessageHeadParts = {
  who: string;
  time: string;
  duration: string;
  live: boolean;
  streaming: boolean;
  isError: boolean;
  queued: boolean;
};

export function messageHeadEmpty(head: MessageHeadParts): boolean {
  return (
    !head.who &&
    !head.time &&
    !head.duration &&
    !head.live &&
    !head.queued &&
    !head.isError
  );
}

/**
 * Visible thread head. Id / logo / fake clock / token counts stay off the line.
 */
export function formatMessageHead(
  message: DraftMessage,
  agentName = "coding",
): MessageHeadParts {
  const m = message.meta;
  const streaming = Boolean(m?.streaming);
  const queued = Boolean(m?.kind?.includes("queued_user"));
  const blank = {
    who: "",
    time: "",
    duration: "",
    live: false,
    streaming: false,
    isError: false,
    queued: false,
  };

  if (message.role === "user") {
    return { ...blank, queued };
  }

  if (message.role === "assistant") {
    return {
      ...blank,
      live: streaming,
      streaming,
    };
  }

  if (message.role === "system") {
    return { ...blank, who: "系统" };
  }

  if (message.role === "err") {
    return { ...blank, who: "错误", isError: true };
  }

  return blank;
}

/**
 * Thinking 行头（纯文本回退 / 测试）：
 * streaming: `Thought... · 1.2s · 41 tok`
 * done:      `Thought · 1.2s · 41 tok ▶|▼`
 */
export function formatThinkingHead(
  body: string,
  opts: {
    durationMs?: number;
    streaming?: boolean;
    collapsed?: boolean;
    spinnerFrame?: number;
    outputTokens?: number;
  } = {},
): string {
  const label = opts.streaming ? "Thought..." : "Thought";
  const parts: string[] = [label];
  const dur = durationStr(opts.durationMs);
  if (dur) parts.push(dur);
  if (opts.outputTokens != null && opts.outputTokens > 0) {
    parts.push(`${compactCount(opts.outputTokens)} tok`);
  } else if (!opts.streaming && body) {
    // 无 token 时回退字数，避免空信息
    parts.push(`${[...body].length} 字`);
  }
  if (!opts.streaming) {
    parts.push(opts.collapsed === false ? "▼" : "▶");
  }
  return parts.join(" · ");
}

export type RoundTipInput = {
  round: number;
  startedAt?: number;
  durationMs?: number;
  toolCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  /** 本轮 prompt 里命中缓存的部分 */
  cacheRead?: number;
  cacheWrite?: number;
  /** usage 是否报了 cache 字段；false → 缓存行显示 “—” */
  cacheReported?: boolean;
  live?: boolean;
};

export type InfoHoverRow = { label: string; value: string };

export function formatInfoHoverLabel(rows: readonly InfoHoverRow[]): string {
  return rows.map((r) => `${r.label} ${r.value}`).join("\n");
}

/** Label/value rows for the round-chip InfoHover. */
export function roundTipRows(input: RoundTipInput): InfoHoverRow[] {
  const n = Math.max(1, Math.floor(input.round) || 1);
  const rows: InfoHoverRow[] = [{ label: "轮次", value: String(n) }];
  const start = timecode(input.startedAt);
  if (start) rows.push({ label: "开始", value: start });
  const dur = durationStr(input.durationMs);
  if (dur) rows.push({ label: "用时", value: dur });
  else if (input.live) rows.push({ label: "用时", value: "…" });
  if (input.toolCount != null && input.toolCount >= 0) {
    rows.push({ label: "工具", value: String(input.toolCount) });
  }
  if (input.inputTokens != null && input.inputTokens > 0) {
    rows.push({ label: "输入", value: `${compactCount(input.inputTokens)} tok` });
  }
  if (input.outputTokens != null && input.outputTokens > 0) {
    rows.push({ label: "输出", value: `${compactCount(input.outputTokens)} tok` });
  }
  if (
    (input.inputTokens != null && input.inputTokens > 0) ||
    (input.outputTokens != null && input.outputTokens > 0)
  ) {
    rows.push({
      label: "占用",
      value: `${compactCount((input.inputTokens ?? 0) + (input.outputTokens ?? 0))} tok`,
    });
  }
  if (input.cacheReported !== undefined || (input.cacheRead ?? 0) > 0) {
    rows.push({
      label: "缓存",
      value: formatCacheCell({
        promptTotal: input.inputTokens,
        cacheRead: input.cacheRead,
        reported: input.cacheReported,
      }),
    });
  }
  return rows;
}

/** Hover text for the round chip (round / start / duration / tools / output tok). */
export function formatRoundTip(input: RoundTipInput): string {
  const n = Math.max(1, Math.floor(input.round) || 1);
  const lines = [`第 ${n} 轮`];
  const start = timecode(input.startedAt);
  if (start) lines.push(`开始 ${start}`);
  const dur = durationStr(input.durationMs);
  if (dur) lines.push(`用时 ${dur}`);
  else if (input.live) lines.push("用时 …");
  if (input.toolCount != null && input.toolCount >= 0) {
    lines.push(`工具 ${input.toolCount}`);
  }
  if (input.inputTokens != null && input.inputTokens > 0) {
    lines.push(`输入 ${compactCount(input.inputTokens)} tok`);
  }
  if (input.outputTokens != null && input.outputTokens > 0) {
    lines.push(`输出 ${compactCount(input.outputTokens)} tok`);
  }
  if (
    (input.inputTokens != null && input.inputTokens > 0) ||
    (input.outputTokens != null && input.outputTokens > 0)
  ) {
    lines.push(
      `占用 ${compactCount((input.inputTokens ?? 0) + (input.outputTokens ?? 0))} tok`,
    );
  }
  if (input.cacheReported !== undefined || (input.cacheRead ?? 0) > 0) {
    lines.push(
      `缓存 ${formatCacheCell({
        promptTotal: input.inputTokens,
        cacheRead: input.cacheRead,
        reported: input.cacheReported,
      })}`,
    );
  }
  return lines.join("\n");
}

export type LoopReplyInput = {
  assistant: {
    meta?: {
      ts?: number;
      durationMs?: number;
      usageInput?: number;
      usageOutput?: number;
      cacheRead?: number;
      cacheWrite?: number;
      cacheReported?: boolean;
    };
  } | null;
  internals: Array<{
    role: string;
    tool?: { durationMs?: number };
    meta?: { durationMs?: number; ts?: number };
    thinking?: { durationMs?: number; startedAt?: number };
  }>;
};

/** 用户发出这条提问 → loop 终止。ChatPanel / LoopFoot 读写。 */
export type SummarizeLoopOpts = {
  sentAt?: number;
  /** 已落住的墙钟（用户行 durationMs / 账本 loopDurationMs） */
  durationMs?: number;
  endedAt?: number;
};

export type LoopSummary = {
  roundCount: number;
  startedAt?: number;
  durationMs?: number;
  toolCount: number;
  outputTokens: number;
  /** 本轮所有 round 的 prompt 总量（缓存命中率的分母） */
  inputTokens: number;
  lastInputTokens: number;
  lastOutputTokens: number;
  occupancy: number;
  /** 本轮所有 round 的缓存命中读取总量 */
  cacheRead: number;
  cacheWrite: number;
  /** 任一 round 报过 cache 字段才为 true；否则命中率显示 “—” */
  cacheReported: boolean;
};

function finitePositive(n: number | undefined | null): n is number {
  return n != null && Number.isFinite(n) && n > 0;
}

function finiteMs(n: number | undefined | null): n is number {
  return n != null && Number.isFinite(n);
}

/** 发出 → 终止的墙钟。缺一端或 end < start 则无值。 */
export function loopWallMs(
  sentAt?: number | null,
  endedAt?: number | null,
): number | undefined {
  if (!finiteMs(sentAt) || !finiteMs(endedAt)) return undefined;
  if (endedAt < sentAt) return undefined;
  return endedAt - sentAt;
}

function bumpEnd(cur: number | undefined, next: number | undefined): number | undefined {
  if (!finiteMs(next)) return cur;
  return cur == null ? next : Math.max(cur, next);
}

function markEnd(ts?: number, dur?: number): number | undefined {
  if (!finitePositive(ts)) return undefined;
  return ts + (finiteMs(dur) && dur >= 0 ? dur : 0);
}

/**
 * Loop 用时 = 用户发出 → 本 loop 终止的墙钟。
 * 起点优先 sentAt（用户行 ts）；终点是最后一条回复的 ts[+duration] 或 endedAt。
 */
export function summarizeLoop(
  replies: LoopReplyInput[],
  opts?: SummarizeLoopOpts,
): LoopSummary {
  let toolCount = 0;
  let outputTokens = 0;
  let inputTokens = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let cacheReported = false;
  let lastInputTokens = 0;
  let lastOutputTokens = 0;
  let replyStart: number | undefined;
  let lastEnd: number | undefined;

  for (const block of replies) {
    const meta = block.assistant?.meta;
    const ts = meta?.ts;
    const dur = meta?.durationMs;
    if (finitePositive(ts)) {
      replyStart = replyStart == null ? ts : Math.min(replyStart, ts);
    }
    lastEnd = bumpEnd(lastEnd, markEnd(ts, dur));
    const inTok = meta?.usageInput;
    const outTok = meta?.usageOutput;
    if (finitePositive(inTok)) {
      inputTokens += inTok;
      lastInputTokens = inTok;
    }
    if (finitePositive(outTok)) {
      outputTokens += outTok;
      lastOutputTokens = outTok;
    }
    if (meta?.cacheReported) cacheReported = true;
    if (finitePositive(meta?.cacheRead)) cacheRead += meta!.cacheRead!;
    if (finitePositive(meta?.cacheWrite)) cacheWrite += meta!.cacheWrite!;
    for (const part of block.internals) {
      if (part.role === "tool") toolCount += 1;
      const partTs = part.meta?.ts ?? part.thinking?.startedAt;
      const partDur =
        part.tool?.durationMs ?? part.meta?.durationMs ?? part.thinking?.durationMs;
      lastEnd = bumpEnd(lastEnd, markEnd(partTs, partDur));
    }
  }

  lastEnd = bumpEnd(lastEnd, opts?.endedAt);
  const startedAt = finitePositive(opts?.sentAt) ? opts.sentAt : replyStart;
  const stamped =
    opts?.durationMs != null && Number.isFinite(opts.durationMs) && opts.durationMs >= 0
      ? opts.durationMs
      : undefined;
  const wall = stamped ?? loopWallMs(startedAt, lastEnd);
  const durationMs =
    wall == null
      ? undefined
      : wall > 0
        ? wall
        : stamped != null || opts?.sentAt != null || opts?.endedAt != null
          ? wall
          : undefined;

  return {
    roundCount: replies.length,
    startedAt,
    durationMs,
    toolCount,
    outputTokens,
    inputTokens,
    lastInputTokens,
    lastOutputTokens,
    occupancy: lastInputTokens + lastOutputTokens,
    cacheRead,
    cacheWrite,
    cacheReported,
  };
}

export type UserTurnTipInput = LoopSummary & {
  /** 本会话第几条用户消息（1 基） */
  ordinal: number;
  /** 该轮仍在跑 */
  live?: boolean;
  /** 落盘账本里能取到完整 POST 请求 */
  hasRequest?: boolean;
};

/**
 * 用户方块 InfoHover：这条提问带出来的整轮账单。
 * 工作时间 = 用户发出 → loop 终止（summarizeLoop 已算好）。
 */
export function userTurnTipRows(input: UserTurnTipInput): InfoHoverRow[] {
  const rows: InfoHoverRow[] = [
    { label: "提问", value: `#${Math.max(1, Math.floor(input.ordinal) || 1)}` },
  ];
  const start = timecode(input.startedAt);
  if (start) rows.push({ label: "开始", value: start });
  const dur = durationStr(input.durationMs);
  rows.push({ label: "工作时间", value: input.live ? "…" : dur || "—" });
  rows.push({
    label: "轮次",
    value: `${Math.max(0, Math.floor(input.roundCount) || 0)}${input.live ? " …" : ""}`,
  });
  rows.push({ label: "工具", value: String(input.toolCount) });
  rows.push({
    label: "总输入",
    value: input.inputTokens > 0 ? `${compactCount(input.inputTokens)} tok` : "—",
  });
  rows.push({
    label: "总输出",
    value: input.outputTokens > 0 ? `${compactCount(input.outputTokens)} tok` : "—",
  });
  rows.push({
    label: "平均缓存率",
    value: formatCacheCell({
      promptTotal: input.inputTokens,
      cacheRead: input.cacheRead,
      reported: input.cacheReported || input.cacheRead > 0,
    }),
  });
  if (input.occupancy > 0) {
    rows.push({ label: "占用", value: `${compactCount(input.occupancy)} tok` });
  }
  rows.push({
    label: "请求体",
    value: input.hasRequest ? "点击查看" : input.live ? "待落盘" : "不可用",
  });
  return rows;
}

/** 纯文本回退（aria-label / 测试）。 */
export function formatUserTurnTip(input: UserTurnTipInput): string {
  return formatInfoHoverLabel(userTurnTipRows(input));
}

/** Label/value rows for the loop-footer InfoHover. */
export function loopTipRows(input: LoopSummary): InfoHoverRow[] {
  const n = Math.max(0, Math.floor(input.roundCount) || 0);
  const rows: InfoHoverRow[] = [{ label: "轮次", value: `共 ${n}` }];
  const start = timecode(input.startedAt);
  if (start) rows.push({ label: "开始", value: start });
  rows.push({ label: "工具", value: String(input.toolCount) });
  rows.push({
    label: "输出",
    value: `${compactCount(input.outputTokens)} tok`,
  });
  if (input.occupancy > 0) {
    rows.push({
      label: "占用",
      value: `${compactCount(input.occupancy)} tok`,
    });
  }
  if (input.cacheReported || input.cacheRead > 0) {
    rows.push({
      label: "缓存",
      value: formatCacheCell({
        promptTotal: input.inputTokens,
        cacheRead: input.cacheRead,
        reported: input.cacheReported,
      }),
    });
  }
  return rows;
}

/** Hover text for the loop footer (rounds / start / tools / output tok). */
export function formatLoopTip(input: LoopSummary): string {
  const n = Math.max(0, Math.floor(input.roundCount) || 0);
  const lines = [`共 ${n} 轮`];
  const start = timecode(input.startedAt);
  if (start) lines.push(`开始 ${start}`);
  lines.push(`共工具 ${input.toolCount}`);
  lines.push(`共输出 ${compactCount(input.outputTokens)} tok`);
  if (input.occupancy > 0) {
    lines.push(`占用 ${compactCount(input.occupancy)} tok`);
  }
  return lines.join("\n");
}
