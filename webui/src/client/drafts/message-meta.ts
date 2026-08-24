/**
 * CLI MessageRow head meta — shortId / timecode / duration / usage / LIVE.
 * Port of cli/tui-ratatui messages.rs (duration_str, short_id, loop_mark, heads).
 */

import type { DraftMessage, MessageRole } from "./types";

/** compact — local copy to avoid cycle with tool-card */
function compactCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
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

/** HH:MM:SS local from epoch ms; missing → --:--:-- */
export function timecode(tsMs: number | undefined | null): string {
  if (tsMs == null || !Number.isFinite(tsMs) || tsMs <= 0) return "--:--:--";
  const d = new Date(tsMs);
  const h = d.getHours();
  const m = d.getMinutes();
  const s = d.getSeconds();
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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
  logo: string;
  text: string;
  live: boolean;
  streaming: boolean;
  isError: boolean;
  queued: boolean;
};

/**
 * Build CLI-style head line for a draft message.
 * user:   `sid | user | HH:MM:SS | ↑tok [| queued]`
 * asst:   `↺N | agent:coding | HH:MM:SS | (dur) | ↓tok` + optional LIVE
 * system: `sid | system | HH:MM:SS`
 */
export function formatMessageHead(
  message: DraftMessage,
  agentName = "coding",
): MessageHeadParts {
  const m = message.meta;
  const streaming = Boolean(m?.streaming);
  const label =
    m?.authorLabel?.trim() || defaultAuthorLabel(message.role, agentName);
  const sid = shortId(message.id);
  const tc = timecode(m?.ts);
  const queued = Boolean(m?.kind?.includes("queued_user"));

  if (message.role === "user") {
    let text = `${sid} | ${label} | ${tc}`;
    const up = m?.usageInput;
    if (up != null && up > 0) text += ` | ↑${compactCount(up)}`;
    if (queued) text += " | queued";
    return {
      logo: "◈",
      text,
      live: false,
      streaming: false,
      isError: false,
      queued,
    };
  }

  if (message.role === "assistant") {
    const parts: string[] = [];
    const lm = loopMark(m?.round);
    if (lm) parts.push(lm);
    parts.push(label);
    parts.push(tc);
    const dur = durationStr(m?.durationMs);
    if (dur) parts.push(`(${dur})`);
    const dn = m?.usageOutput;
    if (dn != null && dn > 0) parts.push(`↓${compactCount(dn)}`);
    return {
      logo: streaming ? "…" : "◈",
      text: parts.join(" | "),
      live: streaming,
      streaming,
      isError: false,
      queued: false,
    };
  }

  if (message.role === "system") {
    return {
      logo: "▣",
      text: `${sid} | ${label} | ${tc}`,
      live: false,
      streaming: false,
      isError: false,
      queued: false,
    };
  }

  if (message.role === "err") {
    return {
      logo: "✕",
      text: `${sid} | ${label} | ${tc}`,
      live: false,
      streaming: false,
      isError: true,
      queued: false,
    };
  }

  // thinking / tool fall through to simple labels (tool uses ToolCard head)
  return {
    logo: "·",
    text: `${sid} | ${label} | ${tc}`,
    live: false,
    streaming: false,
    isError: false,
    queued: false,
  };
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
