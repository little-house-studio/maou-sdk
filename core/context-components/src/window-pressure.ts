/**
 * 窗口压力：未到 80% 不剪；过线先盖住超大 tool/result，重测仍高才走折叠 / 摘要。
 */

import type { MaouMessage } from "./types/message.js";
import { MICRO_TRIGGER_PERCENT } from "./constants.js";
import {
  pruneToolResultText,
  TOOL_RESULT_PRUNE_THRESHOLD_CHARS,
} from "./prune-text.js";
import { buildRetentionNotice, type RetentionNotice } from "./omission.js";
import { renderMicroCompactText, segmentMicroPolicy } from "./micro-compact.js";
import { writeOriginalRecord } from "./original-record.js";

export type WindowPressureAction = "none" | "omit" | "summarize";

export interface WindowPressureInput {
  occupancy: number;
  window: number;
  largestToolResultChars: number;
}

export function pressureLine(window: number): number {
  if (window <= 0) return Number.POSITIVE_INFINITY;
  return Math.floor((window * MICRO_TRIGGER_PERCENT) / 100);
}

export function decideWindowPressure(input: WindowPressureInput): WindowPressureAction {
  if (input.window <= 0 || input.occupancy < pressureLine(input.window)) return "none";
  if (input.largestToolResultChars > TOOL_RESULT_PRUNE_THRESHOLD_CHARS) return "omit";
  return "summarize";
}

export function largestToolResultChars(history: MaouMessage[]): number {
  let max = 0;
  for (const m of history) {
    if (m.category !== "tool_result") continue;
    const n = [...m.contents.map((c) => c.text).join("\n")].length;
    if (n > max) max = n;
  }
  return max;
}

export function omitOversizedToolResults(
  history: MaouMessage[],
  skip?: (m: MaouMessage) => boolean,
  sessionRoot?: string,
): {
  history: MaouMessage[];
  notices: RetentionNotice[];
} {
  const notices: RetentionNotice[] = [];
  const next = history.map((m) => {
    if (skip?.(m)) return m;
    if (m.category !== "tool_result") return m;
    const text = m.contents.map((c) => c.text).join("\n");
    const chars = [...text];
    if (chars.length <= TOOL_RESULT_PRUNE_THRESHOLD_CHARS) return m;
    const policy = m.contents[0] ? segmentMicroPolicy(m.contents[0]) : undefined;
    let pruned =
      policy?.strategy === "terminal_spill"
        ? renderMicroCompactText(text, policy)
        : pruneToolResultText(text);
    if (!pruned || pruned === text) return m;
    if (
      sessionRoot &&
      !/Full output stored at:/i.test(pruned) &&
      !/\[(?:path|url)=/i.test(pruned)
    ) {
      const path = writeOriginalRecord(sessionRoot, `tool-${m.seqId}`, text);
      if (path) pruned = `${pruned}\nFull output stored at: ${path}`;
    }
    const keptHead = Math.min(4096, chars.length);
    const keptTail = Math.min(1024, Math.max(0, chars.length - keptHead));
    notices.push(
      buildRetentionNotice({
        original: chars.length,
        keptHead,
        keptTail,
        unit: "code_points",
      }),
    );
    const newContents = [...m.contents];
    if (newContents[0]) {
      newContents[0] = { ...newContents[0], microCompact: { enabled: true, summary: pruned } };
    }
    return { ...m, contents: newContents };
  });
  return { history: next, notices };
}

export function applyWindowPressure(
  history: MaouMessage[],
  occupancy: number,
  window: number,
  skip?: (m: MaouMessage) => boolean,
  sessionRoot?: string,
): {
  action: WindowPressureAction;
  history: MaouMessage[];
  notices: RetentionNotice[];
} {
  const action = decideWindowPressure({
    occupancy,
    window,
    largestToolResultChars: largestToolResultChars(history),
  });
  if (action === "none") return { action, history, notices: [] };
  if (action === "omit") {
    const omitted = omitOversizedToolResults(history, skip, sessionRoot);
    return { action, history: omitted.history, notices: omitted.notices };
  }
  return { action, history, notices: [] };
}
