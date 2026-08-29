/**
 * CLI ToolCard logic port (cli/tui-ratatui messages.rs render_tool_card).
 * Pure helpers — UI state (expanded) lives in the React component.
 */

import { resolveToolCardDress } from "@little-house-studio/types/tool-card";
import { estimateTokensFromText } from "@little-house-studio/types/token-estimate";
import type { DraftMessage, DraftToolCard } from "./types";
import { durationStr } from "./message-meta";

export { durationStr };

/** compact: 200000 → 200.0k */
export function compactCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** CLI tool_result_size_label */
export function toolResultSizeLabel(result: string | undefined | null): string {
  if (result == null) return "";
  if (result.length === 0) return "· 0 字";
  const chars = [...result].length;
  return `· ${compactCount(chars)} 字 · ~${compactCount(estimateTokensFromText(result))} tok`;
}

export function isWriteTool(name: string): boolean {
  return resolveToolCardDress(name) === "edit";
}

export function extractToolPath(args: string, body = ""): string | undefined {
  const from = (raw: string): string | undefined => {
    const t = raw.trim();
    if (!t) return undefined;
    try {
      const v = JSON.parse(t) as Record<string, unknown>;
      for (const key of ["path", "file", "file_path", "target", "cwd"]) {
        const p = v[key];
        if (typeof p === "string" && p.trim()) return p.trim();
      }
    } catch {
      /* free-form */
    }
    const m = t.match(
      /(?:^|[\s`'"])((?:\.{1,2}\/|~\/|\/(?!\/)|[A-Za-z]:[\\/])[^\s`'"]+)/,
    );
    return m?.[1]?.replace(/[.,)]+$/, "");
  };
  return from(args) || from(body);
}

export function todoSummary(result: string): string | undefined {
  const lines = result.split("\n");
  let done = 0;
  let total = 0;
  let current = "";
  for (const line of lines) {
    const check = line.match(/^\s*[-*]\s+\[([ xX>!-])\]\s+(.*)$/);
    if (check) {
      total += 1;
      if (check[1] === "x" || check[1] === "X") done += 1;
      if ((check[1] === ">" || check[1] === " ") && !current) {
        current = (check[2] || "").trim();
      }
      continue;
    }
    const table = line.match(
      /\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(\[[ xX>!-]\]|[xX>!-]|▶)?/,
    );
    if (table && !/^\s*\|\s*[-=]/.test(line) && !/\|\s*#\s*\|/.test(line)) {
      total += 1;
      const mark = (table[3] || "").trim();
      const desc = (table[2] || "").trim();
      if (mark.includes("x") || mark.includes("X")) done += 1;
      if ((mark.includes(">") || /当前执行/.test(line)) && !current) current = desc;
    }
    const exec = line.match(/▶\s*当前执行:\s*(\S+)\s*—\s*(.+)$/);
    if (exec) current = exec[2]!.trim();
  }
  if (!total) return undefined;
  return current ? `${done}/${total} · ${current}` : `${done}/${total}`;
}

export function isDiffResult(s: string): boolean {
  return s
    .split("\n")
    .slice(0, 20)
    .some(
      (l) =>
        l.startsWith("@@") ||
        l.startsWith("+++ ") ||
        l.startsWith("--- ") ||
        (l.startsWith("+") && !l.startsWith("++")) ||
        (l.startsWith("-") && !l.startsWith("--")),
    );
}

/** Preview line count before fold (CLI DiffCollapsible). */
export function toolPreviewLines(name: string, result: string): number {
  return isDiffResult(result) || isWriteTool(name) ? 8 : 12;
}

export type ResolvedToolCard = {
  id: string;
  name: string;
  args: string;
  result: string;
  done: boolean;
  isError: boolean;
  durationMs?: number;
  description: string;
};

/**
 * Resolve draft message → CLI-like card fields.
 * Prefer structured `message.tool`; fall back to tag + body.
 */
export function resolveToolCard(message: DraftMessage): ResolvedToolCard {
  const t: DraftToolCard | undefined = message.tool;
  const name = (t?.name || message.tag || "tool").trim() || "tool";
  const args = t?.args ?? "";
  const result = t?.result ?? message.body ?? "";
  const description =
    (t?.description ?? "").trim() || firstDescriptionFromArgs(args);
  return {
    id: message.id,
    name,
    args,
    result,
    done: t?.done ?? true,
    isError: t?.isError ?? false,
    durationMs: t?.durationMs,
    description,
  };
}

function firstDescriptionFromArgs(args: string): string {
  if (!args.trim()) return "";
  try {
    const v = JSON.parse(args) as { description?: unknown };
    if (typeof v?.description === "string") return v.description.trim();
  } catch {
    /* free-form */
  }
  return "";
}

export function asToolParams(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const v = JSON.parse(raw);
      if (v && typeof v === "object") return v as Record<string, unknown>;
    } catch {
      /* free-form */
    }
  }
  return {};
}

/** 从 tool.parameters / JSON 字符串取出 description */
export function readToolIntent(raw: unknown): string {
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return "";
    if (t.startsWith("{") || t.startsWith("[")) {
      try {
        return readToolIntent(JSON.parse(t));
      } catch {
        return "";
      }
    }
    return "";
  }
  if (!raw || typeof raw !== "object") return "";
  const o = raw as Record<string, unknown>;
  if (typeof o.description === "string" && o.description.trim()) {
    return o.description.trim();
  }
  if (o.parameters != null) return readToolIntent(o.parameters);
  if (o.arguments != null) return readToolIntent(o.arguments);
  return "";
}

/** `▶ use_terminal · scan routes` 第一行里的调用意图 */
export function extractToolCallIntent(text: string): string {
  const first = (text || "").split("\n")[0]?.trim() ?? "";
  const m = first.match(/^▶\s*[a-zA-Z_][\w.-]*\s+·\s+(.+)$/);
  return m?.[1]?.trim() ?? "";
}

export function toolIntentLabel(card: ResolvedToolCard): string {
  const d = card.description.trim();
  if (!d) return "";
  return d.length > 56 ? `${d.slice(0, 55)}…` : d;
}

export function toolDurationLabel(card: ResolvedToolCard): string {
  return durationStr(card.durationMs);
}

/** Title meta: intent + duration. */
export function toolTitleMeta(card: ResolvedToolCard): string {
  return [toolIntentLabel(card), toolDurationLabel(card)]
    .filter(Boolean)
    .join(" ");
}

/** 标题行点击前是否展开。`force` 来自 ToolCard.defaultExpanded。 */
export function toolCardInitiallyExpanded(force = false): boolean {
  return force === true;
}

/** ▶ collapsed · ▼ expanded */
export function toolFoldMark(
  _card: ResolvedToolCard,
  expanded: boolean,
  _spinnerFrame = 0,
): string {
  return expanded ? "▼" : "▶";
}

export function slicePreview(
  text: string,
  name: string,
  full: boolean,
): { show: string; totalLines: number; needFold: boolean } {
  const lines = text.split("\n");
  const totalLines = lines.length;
  const previewN = toolPreviewLines(name, text);
  const needFold = totalLines > previewN;
  const show =
    needFold && !full
      ? lines.slice(0, previewN).join("\n")
      : text;
  return { show, totalLines, needFold };
}
