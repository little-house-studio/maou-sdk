/**
 * Lightweight session stats / analyze from project SessionStore files.
 * No CLI package import — pure fs on <project>/.maou/sessions.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { normalizeCacheUsage } from "@little-house-studio/llm";
import {
  composeContextBreakdown,
  estimateSessionMessageTokens,
  formatContextBreakdownBlock,
  type ContextBreakdown,
} from "@little-house-studio/context";

export type { ContextBreakdown };

export type SessionLifetimeStats = {
  userTurns: number;
  assistantTurns: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  modelMs: number;
  toolMs: number;
  ttftMs: number;
};

export type SessionStats = {
  sessionId: string;
  messageCount: number;
  userTurns: number;
  assistantTurns: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  /** 上一条回报的 input */
  lastInputTokens: number;
  /** 上一条回报的 output */
  lastOutputTokens: number;
  lastCacheRead: number;
  lastCacheWrite: number;
  lastCacheReported: boolean;
  /** 上下文占用 = last input + last output */
  contextUsed: number;
  contextBreakdown: ContextBreakdown;
  file: string;
  lifetime: SessionLifetimeStats;
};

function emptyLifetime(): SessionLifetimeStats {
  return {
    userTurns: 0,
    assistantTurns: 0,
    toolCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    modelMs: 0,
    toolMs: 0,
    ttftMs: 0,
  };
}

function addLifetime(a: SessionLifetimeStats, b: Partial<SessionLifetimeStats>): SessionLifetimeStats {
  return {
    userTurns: a.userTurns + (b.userTurns ?? 0),
    assistantTurns: a.assistantTurns + (b.assistantTurns ?? 0),
    toolCalls: a.toolCalls + (b.toolCalls ?? 0),
    inputTokens: a.inputTokens + (b.inputTokens ?? 0),
    outputTokens: a.outputTokens + (b.outputTokens ?? 0),
    modelMs: a.modelMs + (b.modelMs ?? 0),
    toolMs: a.toolMs + (b.toolMs ?? 0),
    ttftMs: a.ttftMs || (b.ttftMs ?? 0),
  };
}

function readSessionMeta(projectRoot: string, sessionId: string): Record<string, unknown> | null {
  const p = join(sessionsDir(projectRoot), sessionId, "session.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function sessionsDir(projectRoot: string): string {
  return join(projectRoot, ".maou", "sessions");
}

function parseUsage(raw: unknown): {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reported: boolean;
} {
  if (!raw || typeof raw !== "object") {
    return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reported: false };
  }
  const n = normalizeCacheUsage(raw as Record<string, unknown>);
  return {
    input: n.promptTotal,
    output: n.output,
    cacheRead: n.cacheRead,
    cacheWrite: n.cacheWrite,
    reported: n.reported,
  };
}

function applyUsage(
  stats: SessionStats,
  raw: unknown,
): void {
  const u = parseUsage(raw);
  stats.inputTokens += u.input;
  stats.outputTokens += u.output;
  stats.cacheRead += u.cacheRead;
  if (u.input > 0 || u.output > 0) {
    stats.lastInputTokens = u.input;
    stats.lastOutputTokens = u.output;
    stats.lastCacheRead = u.cacheRead;
    stats.lastCacheWrite = u.cacheWrite;
    stats.lastCacheReported = u.reported;
    stats.contextUsed = u.input + u.output;
  }
}

/** Latest session id by mtime of session.json */
export function latestSessionId(projectRoot: string): string | null {
  const dir = sessionsDir(projectRoot);
  if (!existsSync(dir)) return null;
  try {
    const files = readdirSync(dir)
      .map((id) => {
        const header = join(dir, id, "session.json");
        if (!existsSync(header)) return null;
        return { id, m: statSync(header).mtimeMs };
      })
      .filter((x): x is { id: string; m: number } => x != null)
      .sort((a, b) => b.m - a.m);
    return files[0]?.id ?? null;
  } catch {
    return null;
  }
}

function emptyBreakdown(): ContextBreakdown {
  return composeContextBreakdown({ window: 0, used: 0 });
}

export function collectSessionStats(
  projectRoot: string,
  sessionId: string,
  opts?: { window?: number },
): SessionStats {
  const file = join(sessionsDir(projectRoot), sessionId, "events.jsonl");
  const stats: SessionStats = {
    sessionId,
    messageCount: 0,
    userTurns: 0,
    assistantTurns: 0,
    toolCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheRead: 0,
    lastInputTokens: 0,
    lastOutputTokens: 0,
    lastCacheRead: 0,
    lastCacheWrite: 0,
    lastCacheReported: false,
    contextUsed: 0,
    contextBreakdown: emptyBreakdown(),
    file,
    lifetime: collectLifetime(projectRoot, sessionId),
  };
  if (!existsSync(file)) {
    applyLifetimeToCounts(stats);
    return stats;
  }

  let messageTokens = 0;
  let imageCount = 0;
  let systemTokens = 0;
  const lines = readFileSync(file, "utf8").split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const data = (ev.data && typeof ev.data === "object" ? ev.data : ev) as Record<string, unknown>;
    const type = String(ev.type ?? "");
    const role = String(data.role ?? ev.role ?? "");
    const usage = ev.usage ?? data.usage;

    if (
      type === "message" ||
      type === "user/message" ||
      type === "assistant/message" ||
      role === "user" ||
      role === "assistant"
    ) {
      stats.messageCount++;
      if (role === "user" || type === "user/message") stats.userTurns++;
      if (role === "assistant" || type === "assistant/message") stats.assistantTurns++;
    }
    if (
      type === "tool_call" ||
      type === "tool/call" ||
      type === "tool" ||
      (ev.name && type.includes("tool"))
    ) {
      stats.toolCalls++;
    }
    if (usage) applyUsage(stats, usage);

    const isCompact =
      type === "compact" ||
      type.startsWith("compact/") ||
      role === "compact" ||
      (typeof ev.content === "string" && /上下文已压缩/.test(ev.content)) ||
      (typeof data.content === "string" && /上下文已压缩/.test(data.content));
    if (isCompact && type !== "compact/start" && type !== "compact/summary") {
      stats.lastInputTokens = 0;
      stats.lastOutputTokens = 0;
      stats.lastCacheRead = 0;
      stats.lastCacheWrite = 0;
      stats.lastCacheReported = false;
      stats.contextUsed = 0;
      messageTokens = 0;
      imageCount = 0;
      systemTokens = 0;
      continue;
    }

    if (type === "trace" || type === "session/trace" || type === "info") continue;
    if (role === "system") {
      const est = estimateSessionMessageTokens(data);
      systemTokens += est.tokens;
      continue;
    }
    if (
      type === "message" ||
      type === "user/message" ||
      type === "assistant/message" ||
      type === "tool/call" ||
      type === "tool/result" ||
      role === "user" ||
      role === "assistant" ||
      role === "tool" ||
      type === "tool_call" ||
      type === "tool_result" ||
      type === "tool"
    ) {
      const est = estimateSessionMessageTokens({ ...data, role, content: data.content ?? ev.content });
      messageTokens += est.tokens;
      imageCount += est.images;
    }
  }
  stats.contextBreakdown = composeContextBreakdown({
    window: opts?.window ?? 0,
    used: stats.contextUsed,
    promptTotal: stats.lastInputTokens,
    output: stats.lastOutputTokens,
    cacheRead: stats.lastCacheRead,
    cacheWrite: stats.lastCacheWrite,
    cacheReported: stats.lastCacheReported,
    systemTokens,
    messageTokens,
    imageCount,
  });
  if (stats.lifetime.userTurns + stats.lifetime.assistantTurns > 0) {
    applyLifetimeToCounts(stats);
  } else {
    stats.lifetime = {
      ...stats.lifetime,
      userTurns: stats.userTurns,
      assistantTurns: stats.assistantTurns,
      toolCalls: stats.toolCalls,
      inputTokens: stats.inputTokens,
      outputTokens: stats.outputTokens,
    };
  }
  return stats;
}

function applyLifetimeToCounts(stats: SessionStats): void {
  stats.userTurns = stats.lifetime.userTurns;
  stats.assistantTurns = stats.lifetime.assistantTurns;
  stats.toolCalls = stats.lifetime.toolCalls;
  stats.inputTokens = stats.lifetime.inputTokens;
  stats.outputTokens = stats.lifetime.outputTokens;
  stats.messageCount = stats.lifetime.userTurns + stats.lifetime.assistantTurns;
}

function collectLifetime(projectRoot: string, sessionId: string): SessionLifetimeStats {
  let acc = emptyLifetime();
  const seen = new Set<string>();
  let cur: string | undefined = sessionId;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const meta = readSessionMeta(projectRoot, cur);
    const life = meta?.lifetime;
    if (life && typeof life === "object") {
      acc = addLifetime(acc, life as SessionLifetimeStats);
    }
    const prefix = meta?.prefix_ref;
    if (prefix && typeof prefix === "object" && typeof (prefix as { sessionId?: string }).sessionId === "string") {
      cur = (prefix as { sessionId: string }).sessionId;
    } else {
      cur = undefined;
    }
  }
  return acc;
}

export function formatSessionStats(s: SessionStats): string {
  const hit =
    s.inputTokens > 0
      ? `${((s.cacheRead / s.inputTokens) * 100).toFixed(1)}%`
      : "n/a";
  return [
    `Session ${s.sessionId}`,
    `  Messages:   ${s.messageCount} (user ${s.userTurns} · assistant ${s.assistantTurns})`,
    `  Lifetime:   turns ${s.lifetime.userTurns + s.lifetime.assistantTurns} · tools ${s.lifetime.toolCalls} · in ${s.lifetime.inputTokens.toLocaleString()} · out ${s.lifetime.outputTokens.toLocaleString()}`,
    `  Tool calls: ${s.toolCalls}`,
    `  Tokens:     in ${s.inputTokens.toLocaleString()} · out ${s.outputTokens.toLocaleString()} · cache_read ${s.cacheRead.toLocaleString()}`,
    `  Context:    ${s.contextUsed.toLocaleString()} (last in ${s.lastInputTokens.toLocaleString()} + out ${s.lastOutputTokens.toLocaleString()})`,
    `  Cache hit:  ${hit} (from logged usage)`,
    "",
    "Composition (heuristic)",
    formatContextBreakdownBlock(s.contextBreakdown),
    `  File:       ${s.file}`,
  ].join("\n");
}

export function formatSessionAnalyze(s: SessionStats): string {
  return (
    formatSessionStats(s) +
    "\n\nHeuristics:\n" +
    (s.toolCalls === 0 && s.assistantTurns > 3
      ? "  · p: many assistant turns without tools\n"
      : "  · n: tool activity looks normal\n") +
    (s.cacheRead === 0 && s.inputTokens > 5000
      ? "  · p: large prompt tokens with no cache_read logged\n"
      : "")
  );
}
