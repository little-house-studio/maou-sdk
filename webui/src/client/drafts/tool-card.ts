/**
 * CLI ToolCard logic port (cli/tui-ratatui messages.rs render_tool_card).
 * Pure helpers — UI state (expanded) lives in the React component.
 */

import type { DraftMessage, DraftToolCard } from "./types";
import { durationStr } from "./message-meta";

export { durationStr };

/** Ink compact(): 200000 → 200.0k */
export function compactCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** CLI tool_result_size_label */
export function toolResultSizeLabel(result: string | undefined | null): string {
  if (result == null) return "";
  if (result.length === 0) return "· 0 字";
  let cjk = 0;
  let ascii = 0;
  let other = 0;
  for (const ch of result) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      code >= 0x20000
    ) {
      cjk += 1;
    } else if (code <= 0x7f) {
      ascii += 1;
    } else {
      other += 1;
    }
  }
  const chars = [...result].length;
  const tok = cjk + other + Math.ceil(ascii / 4);
  return `· ${compactCount(chars)} 字 · ~${compactCount(tok)} tok`;
}

export function isWriteTool(name: string): boolean {
  return [
    "create",
    "edit",
    "write",
    "patch",
    "rm",
    "remove",
    "mkdir",
    "move",
    "write_file",
    "edit_file",
  ].includes(name);
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
    (t?.description ?? "").trim() ||
    firstDescriptionFromArgs(args) ||
    firstLineSummary(result);
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

function firstLineSummary(body: string): string {
  const line = body.split("\n").find((l) => l.trim());
  if (!line) return "";
  return line.trim().length > 56 ? `${line.trim().slice(0, 55)}…` : line.trim();
}

/** Title meta: description + duration + size (when done). */
export function toolTitleMeta(card: ResolvedToolCard): string {
  const parts: string[] = [];
  if (card.description) {
    parts.push(
      card.description.length > 56
        ? `${card.description.slice(0, 55)}…`
        : card.description,
    );
  }
  const dur = durationStr(card.durationMs);
  if (dur) parts.push(`(${dur})`);
  if (card.done) {
    const size = toolResultSizeLabel(card.result);
    if (size) parts.push(size);
  }
  return parts.join(" ");
}

/** ▶ collapsed · ▼ expanded · ✗ error · ⠋ running */
export function toolFoldMark(
  card: ResolvedToolCard,
  expanded: boolean,
  spinnerFrame = 0,
): string {
  if (!card.done) {
    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    return frames[spinnerFrame % frames.length]!;
  }
  if (card.isError) return "✗";
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
