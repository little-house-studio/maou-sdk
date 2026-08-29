/**
 * 无模型文本修剪：留头 + 省略标记 + 留尾（Unicode 码点，不拆 surrogate）。
 */

import {
  TOOL_RESULT_OMIT_MARKER,
  buildRetentionNotice,
  formatRetentionNotice,
  spillRetrieveHint,
} from "./omission.js";

export const TOOL_RESULT_PRUNE_MARKER = TOOL_RESULT_OMIT_MARKER;

export const TOOL_RESULT_PRUNE_THRESHOLD_CHARS = 8192;
export const TOOL_RESULT_PRUNE_HEAD_CHARS = 4096;
export const TOOL_RESULT_PRUNE_TAIL_CHARS = 1024;

function codePoints(text: string): string[] {
  return [...text];
}

/**
 * 按码点留头尾。缩不了（含标记后不比原文短）返回 null。
 */
export function pruneTextHeadTail(
  text: string,
  headChars: number,
  tailChars: number,
  marker = TOOL_RESULT_PRUNE_MARKER,
  opts?: { locator?: string; retrieveHint?: string },
): string | null {
  const chars = codePoints(text);
  const head = Math.max(0, Math.floor(headChars));
  const tail = Math.max(0, Math.floor(tailChars));
  if (chars.length === 0 || head + tail <= 0) return null;
  const mark = codePoints(marker);
  if (chars.length <= head + tail + mark.length) return null;
  const notice = buildRetentionNotice({
    original: chars.length,
    keptHead: head,
    keptTail: tail,
    unit: "code_points",
    marker,
    locator: opts?.locator,
    retrieveHint: opts?.retrieveHint ?? (opts?.locator ? spillRetrieveHint() : undefined),
  });
  const mid =
    notice.omitted.kind === "none"
      ? marker
      : `${marker}${formatRetentionNotice(notice.omitted, {
          locator: notice.locator,
          retrieveHint: notice.retrieveHint,
        })}\n`;
  const out = `${chars.slice(0, head).join("")}${mid}${chars.slice(-tail).join("")}`;
  if (codePoints(out).length >= chars.length) return null;
  return out;
}

/**
 * 工具结果：超大用固定头尾预算；中等长度按比例留头尾，保证变矮。
 */
export function pruneToolResultText(text: string): string | null {
  const n = codePoints(text).length;
  if (n <= 0) return null;
  if (n > TOOL_RESULT_PRUNE_THRESHOLD_CHARS) {
    return pruneTextHeadTail(
      text,
      TOOL_RESULT_PRUNE_HEAD_CHARS,
      TOOL_RESULT_PRUNE_TAIL_CHARS,
    );
  }
  const head = Math.min(TOOL_RESULT_PRUNE_HEAD_CHARS, Math.max(80, Math.floor(n * 0.45)));
  const tail = Math.min(TOOL_RESULT_PRUNE_TAIL_CHARS, Math.max(40, Math.floor(n * 0.2)));
  return pruneTextHeadTail(text, head, tail);
}

/** 旧侧用户 / 助手长文：同样头尾，避免只剩前 100 字。 */
export function pruneBodyText(text: string, maxKeep = 400): string | null {
  const n = codePoints(text).length;
  if (n <= maxKeep) return null;
  const head = Math.min(240, Math.max(80, Math.floor(n * 0.4)));
  const tail = Math.min(160, Math.max(40, Math.floor(n * 0.2)));
  return pruneTextHeadTail(text, head, tail, "\n\n[... middle pruned ...]\n\n");
}
