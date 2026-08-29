/**
 * 上下文分区：占用/命中用厂商 usage，条上各段用本地启发式。
 *
 * 占用锚在上一条 promptTotal + output；system / tools / messages 用
 * estimateTokensFromText（CJK 1:1，拉丁约 4 字 1 token）+ 角色开销。
 * 三段加起来对不齐官方总量时，多出的归 overhead，超出则按比例缩到 used。
 */

import { estimateTokensFromText } from "@little-house-studio/types";

export const MSG_ROLE_OVERHEAD = 4;
export const TOOL_BLOCK_OVERHEAD = 4;
export const IMAGE_TOKEN_ESTIMATE = 765;

export type ContextBarKey =
  | "system"
  | "tools"
  | "messages"
  | "overhead"
  | "free";

export type ContextBreakdown = {
  window: number;
  used: number;
  /** used 里含本地估算（厂商锚点缺失或锚点之后又加了消息） */
  usedIsEstimate: boolean;
  promptTotal: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  occupancyPct: number;
  /** 上一条 prompt 命中率；usage 未报 cache 字段时为 null */
  cacheHitPct: number | null;
  system: number;
  tools: number;
  messages: number;
  overhead: number;
  free: number;
  toolCount: number;
  skillCount: number;
  mcpCount: number;
  imageCount: number;
};

export type ContextBarShare = {
  key: ContextBarKey;
  tokens: number;
  widthPct: number;
};

export type SessionMessageLike = {
  role?: string;
  content?: unknown;
  toolCalls?: unknown;
  tool_calls?: unknown;
  images?: unknown;
  reasoningContent?: unknown;
  visibility?: string;
};

export type ComposeContextBreakdownInput = {
  window: number;
  used: number;
  usedIsEstimate?: boolean;
  promptTotal?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cacheReported?: boolean;
  systemText?: string;
  systemTokens?: number;
  toolSchemas?: unknown;
  toolsTokens?: number;
  messages?: readonly SessionMessageLike[];
  messageTokens?: number;
  imageCount?: number;
  toolCount?: number;
  skillCount?: number;
  mcpCount?: number;
};

function trunc(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.trunc(n);
}

export function textFromUnknown(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map(textFromUnknown).filter(Boolean).join("\n");
  }
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.text === "string") {
      const mc = o.microCompact as { enabled?: boolean; summary?: string } | undefined;
      if (mc?.enabled && mc.summary) return mc.summary;
      return o.text;
    }
    if (typeof o.content === "string") return o.content;
    if (o.content != null) return textFromUnknown(o.content);
    if (Array.isArray(o.contents)) return textFromUnknown(o.contents);
    if (o.arguments != null) {
      try {
        return typeof o.arguments === "string"
          ? o.arguments
          : JSON.stringify(o.arguments);
      } catch {
        return "";
      }
    }
  }
  return "";
}

export function countImages(value: unknown): number {
  if (Array.isArray(value)) {
    let n = 0;
    for (const item of value) {
      if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        const t = String(o.type ?? o.mimeType ?? "");
        if (
          t.startsWith("image/") ||
          t === "image" ||
          t === "image_url" ||
          typeof o.data === "string" ||
          o.image_url != null
        ) {
          n++;
        } else {
          n += countImages(o.content ?? o.parts);
        }
      }
    }
    return n;
  }
  return 0;
}

export function estimateToolsTokens(schemas: unknown): number {
  if (schemas == null) return 0;
  try {
    const s = JSON.stringify(schemas);
    if (!s || s === "[]" || s === "{}" || s === "null") return 0;
    return estimateTokensFromText(s) + TOOL_BLOCK_OVERHEAD;
  } catch {
    return 2048;
  }
}

export function estimateSystemTokens(text: string | undefined): number {
  if (!text) return 0;
  return estimateTokensFromText(text) + MSG_ROLE_OVERHEAD;
}

export function estimateSessionMessageTokens(m: SessionMessageLike): {
  tokens: number;
  images: number;
} {
  const images = countImages(m.images) + countImages(m.content);
  let tokens = MSG_ROLE_OVERHEAD;
  tokens += estimateTokensFromText(textFromUnknown(m.content));
  const reasoning = textFromUnknown(m.reasoningContent);
  if (reasoning) tokens += estimateTokensFromText(reasoning);
  const calls = m.toolCalls ?? m.tool_calls;
  if (Array.isArray(calls)) {
    for (const tc of calls) {
      tokens += 8;
      if (tc && typeof tc === "object") {
        const o = tc as Record<string, unknown>;
        tokens += estimateTokensFromText(String(o.name ?? o.id ?? ""));
        tokens += estimateTokensFromText(textFromUnknown(o.arguments ?? o.function));
      }
    }
  }
  tokens += images * IMAGE_TOKEN_ESTIMATE;
  return { tokens, images };
}

function scaleParts(
  parts: { system: number; tools: number; messages: number },
  used: number,
): { system: number; tools: number; messages: number; overhead: number } {
  const composed = parts.system + parts.tools + parts.messages;
  if (used <= 0) {
    return { ...parts, overhead: 0 };
  }
  if (composed <= used) {
    return { ...parts, overhead: used - composed };
  }
  const s = used / composed;
  const system = Math.round(parts.system * s);
  const tools = Math.round(parts.tools * s);
  const messages = Math.round(parts.messages * s);
  const sum = system + tools + messages;
  return {
    system,
    tools,
    messages,
    overhead: Math.max(0, used - sum),
  };
}

export function composeContextBreakdown(
  input: ComposeContextBreakdownInput,
): ContextBreakdown {
  const window = trunc(input.window);
  const used = trunc(input.used);
  const promptTotal = trunc(input.promptTotal ?? 0);
  const output = trunc(input.output ?? 0);
  const cacheRead = trunc(input.cacheRead ?? 0);
  const cacheWrite = trunc(input.cacheWrite ?? 0);

  let messageTokens = trunc(input.messageTokens ?? 0);
  let imageCount = trunc(input.imageCount ?? 0);
  if (input.messages) {
    for (const m of input.messages) {
      if (String(m.role ?? "") === "system") continue;
      if (m.visibility === "ui") continue;
      const est = estimateSessionMessageTokens(m);
      messageTokens += est.tokens;
      imageCount += est.images;
    }
  }

  const rawSystem =
    input.systemTokens != null
      ? trunc(input.systemTokens)
      : estimateSystemTokens(input.systemText);
  const rawTools =
    input.toolsTokens != null
      ? trunc(input.toolsTokens)
      : estimateToolsTokens(input.toolSchemas);
  const scaled = scaleParts(
    { system: rawSystem, tools: rawTools, messages: messageTokens },
    used,
  );

  const occupancyPct =
    window > 0 ? Math.min(100, Math.max(0, Math.round((used / window) * 100))) : 0;
  const reported = input.cacheReported ?? (cacheRead > 0 || cacheWrite > 0);
  const cacheHitPct =
    reported && promptTotal > 0
      ? Math.min(100, Math.round((cacheRead / promptTotal) * 1000) / 10)
      : null;

  return {
    window,
    used,
    usedIsEstimate: input.usedIsEstimate ?? false,
    promptTotal,
    output,
    cacheRead,
    cacheWrite,
    occupancyPct,
    cacheHitPct,
    system: scaled.system,
    tools: scaled.tools,
    messages: scaled.messages,
    overhead: scaled.overhead,
    free: Math.max(0, window - used),
    toolCount: trunc(input.toolCount ?? (Array.isArray(input.toolSchemas) ? input.toolSchemas.length : 0)),
    skillCount: trunc(input.skillCount ?? 0),
    mcpCount: trunc(input.mcpCount ?? 0),
    imageCount,
  };
}

export function contextBarShares(b: ContextBreakdown): ContextBarShare[] {
  const keys: ContextBarKey[] = ["system", "tools", "messages", "overhead", "free"];
  const tokens = [b.system, b.tools, b.messages, b.overhead, b.free];
  if (b.used <= 0) {
    return keys.map((key, i) => ({
      key,
      tokens: tokens[i] ?? 0,
      widthPct: key === "free" ? 100 : 0,
    }));
  }
  const denom = b.window > 0 ? b.window : tokens.reduce((a, n) => a + n, 0);
  return keys.map((key, i) => ({
    key,
    tokens: tokens[i] ?? 0,
    widthPct: denom > 0 ? ((tokens[i] ?? 0) / denom) * 100 : 0,
  }));
}

export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}m`;
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(1)}k`;
  return `${sign}${Math.round(abs)}`;
}

export function formatContextBreakdownBlock(b: ContextBreakdown): string {
  const row = (label: string, tokens: number, extra = ""): string => {
    const pct =
      b.window > 0 ? `${((tokens / b.window) * 100).toFixed(1)}%` : "—";
    const n = b.usedIsEstimate ? `~${formatTokenCount(tokens)}` : formatTokenCount(tokens);
    return `  ${label.padEnd(10)} ${n.padStart(6)}  ${pct.padStart(7)}${extra}`;
  };
  const lines = [
    row("System", b.system),
    row("Tools", b.tools, b.toolCount > 0 ? `  · ${b.toolCount}` : ""),
    row("Messages", b.messages, b.imageCount > 0 ? `  · ${b.imageCount} img` : ""),
    row("Overhead", b.overhead),
    row("Free", b.free),
  ];
  if (b.cacheHitPct != null) {
    lines.push(
      `  Cache hit  ${String(b.cacheHitPct).padStart(6)}%  · cached ${formatTokenCount(b.cacheRead)} ⊂ prompt`,
    );
  }
  const info: string[] = [];
  if (b.skillCount > 0) info.push(`Skills ${b.skillCount}`);
  if (b.mcpCount > 0) info.push(`MCP ${b.mcpCount}`);
  if (info.length) lines.push(`  ${info.join(" · ")}`);
  return lines.join("\n");
}
