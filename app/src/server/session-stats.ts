/**
 * Lightweight session stats / analyze from project SessionStore files.
 * No CLI package import — pure fs on <project>/.maou/sessions.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

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
  /** 上下文占用 = last input + last output */
  contextUsed: number;
  file: string;
};

function sessionsDir(projectRoot: string): string {
  return join(projectRoot, ".maou", "sessions");
}

function parseUsage(raw: unknown): {
  input: number;
  output: number;
  cacheRead: number;
} {
  if (!raw || typeof raw !== "object") {
    return { input: 0, output: 0, cacheRead: 0 };
  }
  const u = raw as Record<string, unknown>;
  const input = Number(
    u.prompt_tokens ?? u.input_tokens ?? u.input ?? u.promptTotal ?? 0,
  );
  const output = Number(
    u.completion_tokens ?? u.output_tokens ?? u.output ?? 0,
  );
  const cacheRead = Number(
    u.cache_read_input_tokens ??
      u.cache_read ??
      u.prompt_cache_hit_tokens ??
      0,
  );
  return {
    input: Number.isFinite(input) ? input : 0,
    output: Number.isFinite(output) ? output : 0,
    cacheRead: Number.isFinite(cacheRead) ? cacheRead : 0,
  };
}

/** Latest session id by mtime of .jsonl files */
export function latestSessionId(projectRoot: string): string | null {
  const dir = sessionsDir(projectRoot);
  if (!existsSync(dir)) return null;
  try {
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => ({
        id: f.replace(/\.jsonl$/, ""),
        m: statSync(join(dir, f)).mtimeMs,
      }))
      .sort((a, b) => b.m - a.m);
    return files[0]?.id ?? null;
  } catch {
    return null;
  }
}

export function collectSessionStats(
  projectRoot: string,
  sessionId: string,
): SessionStats {
  const file = join(sessionsDir(projectRoot), `${sessionId}.jsonl`);
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
    contextUsed: 0,
    file,
  };
  if (!existsSync(file)) return stats;

  const lines = readFileSync(file, "utf8").split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = String(ev.type ?? "");
    const role = String(ev.role ?? "");

    if (type === "message" || role === "user" || role === "assistant") {
      stats.messageCount++;
      if (role === "user") stats.userTurns++;
      if (role === "assistant") stats.assistantTurns++;
    }
    if (
      type === "tool_call" ||
      type === "tool" ||
      (ev.name && type.includes("tool"))
    ) {
      stats.toolCalls++;
    }
    if (ev.usage) {
      const u = parseUsage(ev.usage);
      stats.inputTokens += u.input;
      stats.outputTokens += u.output;
      stats.cacheRead += u.cacheRead;
      if (u.input > 0 || u.output > 0) {
        stats.lastInputTokens = u.input;
        stats.lastOutputTokens = u.output;
        stats.contextUsed = u.input + u.output;
      }
    }
    const data = ev.data as Record<string, unknown> | undefined;
    if (data?.usage) {
      const u = parseUsage(data.usage);
      stats.inputTokens += u.input;
      stats.outputTokens += u.output;
      stats.cacheRead += u.cacheRead;
      if (u.input > 0 || u.output > 0) {
        stats.lastInputTokens = u.input;
        stats.lastOutputTokens = u.output;
        stats.contextUsed = u.input + u.output;
      }
    }
    if (
      type === "compact" ||
      type.startsWith("compact/") ||
      role === "compact" ||
      (typeof ev.content === "string" && /上下文已压缩/.test(ev.content))
    ) {
      stats.lastInputTokens = 0;
      stats.lastOutputTokens = 0;
      stats.contextUsed = 0;
    }
  }
  return stats;
}

export function formatSessionStats(s: SessionStats): string {
  const hit =
    s.inputTokens > 0
      ? `${((s.cacheRead / s.inputTokens) * 100).toFixed(1)}%`
      : "n/a";
  return [
    `Session ${s.sessionId}`,
    `  Messages:   ${s.messageCount} (user ${s.userTurns} · assistant ${s.assistantTurns})`,
    `  Tool calls: ${s.toolCalls}`,
    `  Tokens:     in ${s.inputTokens.toLocaleString()} · out ${s.outputTokens.toLocaleString()} · cache_read ${s.cacheRead.toLocaleString()}`,
    `  Context:    ${s.contextUsed.toLocaleString()} (last in ${s.lastInputTokens.toLocaleString()} + out ${s.lastOutputTokens.toLocaleString()})`,
    `  Cache hit:  ${hit} (from logged usage)`,
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
