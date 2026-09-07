/**
 * 工具输出超限：预览留给模型，全文写到会话旁临时文件。
 * 写文件失败不把成功命令改口失败。
 */

import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatRetentionNotice, spillRetrieveHint } from "@little-house-studio/types";
import { truncateMiddle } from "../util/common.js";

/** 终端回包默认行窗。调用方可被 result_limit 覆盖。 */
export const TERMINAL_RESULT_LIMIT_LINES = 200;

/** 采集/落盘上限。超出只留尾巴。 */
export const TERMINAL_CAPTURE_MAX_BYTES = 256 * 1024;

/** 向引擎要输出时的字符预算，与采集上限对齐。 */
export const ENGINE_OUTPUT_CHAR_BUDGET = TERMINAL_CAPTURE_MAX_BYTES;

/** 拉 logs 时按行取，对齐引擎 ring（2000 行）。 */
export const TERMINAL_LOG_FETCH_LINES = 2000;

/** 原记录文件过期删除。 */
export const SPILL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function cleanupSpillDir(dir: string, ttlMs = SPILL_TTL_MS): number {
  if (!dir) return 0;
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return 0;
  }
  const now = Date.now();
  let removed = 0;
  for (const name of names) {
    const path = join(dir, name);
    try {
      const st = statSync(path);
      if (!st.isFile()) continue;
      if (now - st.mtimeMs <= ttlMs) continue;
      unlinkSync(path);
      removed++;
    } catch {
      /* 单个文件失败不影响其余 */
    }
  }
  return removed;
}

const overflowByTerminal = new Map<string, string>();
const waitByTerminal = new Map<string, TerminalWaitState>();

const PROMPT_TAIL =
  /(?:\$|#|%|>|PS>)\s*$|(?:PS\s+[A-Za-z]:[^>\n]*>)\s*$|(?:\(.*\)\s*[\$#>])\s*$/;

export type TerminalWaitState = "busy" | "waiting" | "exited";

export function inferPromptWaitState(
  output: string,
  processState?: string,
): TerminalWaitState {
  const st = (processState ?? "").toLowerCase();
  if (
    st === "exited" ||
    st === "killed" ||
    st === "failed" ||
    st === "stopped" ||
    st === "interrupted"
  ) {
    return "exited";
  }
  const last = output
    .split(/\r?\n/)
    .reverse()
    .find((l) => l.trim());
  if (last && PROMPT_TAIL.test(last.trim())) return "waiting";
  if (st === "running" || st === "active") return "busy";
  return last && PROMPT_TAIL.test(last.trim()) ? "waiting" : "busy";
}

export function rememberOverflow(terminalId: string, path: string): void {
  if (terminalId && path) overflowByTerminal.set(terminalId, path);
}

export function peekOverflow(terminalId: string): string | undefined {
  return overflowByTerminal.get(terminalId);
}

export function rememberWaitState(terminalId: string, state: TerminalWaitState): void {
  if (terminalId && state) waitByTerminal.set(terminalId, state);
}

export function peekWaitState(terminalId: string): TerminalWaitState | undefined {
  return waitByTerminal.get(terminalId);
}

export function spillDir(projectRoot: string, sessionId: string): string {
  return join(projectRoot, ".maou", "sessions", sessionId || "anon", "spill");
}

export type SpillOpts = {
  sessionId?: string;
  projectRoot?: string;
  sourceId?: string;
  /** 终端侧旧参数名；等价于 sourceId */
  terminalId?: string;
};

export function resolveTerminalLineLimit(raw: unknown): number {
  if (raw == null || raw === "") return TERMINAL_RESULT_LIMIT_LINES;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return TERMINAL_RESULT_LIMIT_LINES;
  return Math.trunc(n);
}

function writeSpillFile(output: string, opts?: SpillOpts): string | undefined {
  const root = opts?.projectRoot?.trim();
  const sid = opts?.sessionId?.trim() || "anon";
  const sourceId = (opts?.sourceId ?? opts?.terminalId ?? "").trim();
  if (!root || !output) return undefined;
  try {
    const dir = spillDir(root, sid);
    mkdirSync(dir, { recursive: true });
    cleanupSpillDir(dir);
    const safeId = (sourceId || "out").replace(/[^\w.-]+/g, "_").slice(0, 80);
    const path = join(dir, `${safeId}-${Date.now()}.txt`);
    writeFileSync(path, output, "utf-8");
    if (sourceId) rememberOverflow(sourceId, path);
    return path;
  } catch {
    return undefined;
  }
}

export function capTerminalCapture(
  text: string,
  maxBytes = TERMINAL_CAPTURE_MAX_BYTES,
): { text: string; truncated: boolean; originalBytes: number } {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) {
    return { text, truncated: false, originalBytes: buf.length };
  }
  let start = buf.length - maxBytes;
  while (start < buf.length && (buf[start]! & 0xc0) === 0x80) start++;
  return {
    text: buf.subarray(start).toString("utf8"),
    truncated: true,
    originalBytes: buf.length,
  };
}

function takeLastLines(
  text: string,
  limit: number,
): { preview: string; total: number; from: number; to: number } {
  const lines = text.split("\n");
  const total = lines.length;
  if (limit <= 0) return { preview: "", total, from: 1, to: 0 };
  if (total <= limit) return { preview: text, total, from: 1, to: total };
  const from = total - limit + 1;
  return { preview: lines.slice(-limit).join("\n"), total, from, to: total };
}

function terminalPreviewEnvelope(
  preview: string,
  from: number,
  to: number,
  totalLines: number,
  totalChars: number,
  path?: string,
  captureCapped?: boolean,
): string {
  const meta = [
    path ? `path=${path}` : null,
    `total_lines=${totalLines}`,
    `total_chars=${totalChars}`,
  ]
    .filter(Boolean)
    .join(" | ");
  const header = `[${meta}]`;
  const range =
    totalLines === 0
      ? "End of output - 0 lines."
      : to < totalLines || from > 1
        ? `Showing lines ${from}-${to} of ${totalLines}.`
        : `End of output - ${totalLines} lines.`;
  const loc = path
    ? ` Full output stored at: ${path}. ${spillRetrieveHint({ unit: "lines" })}`
    : "";
  const cap = captureCapped
    ? ` Capture capped at ${TERMINAL_CAPTURE_MAX_BYTES} bytes (256KiB, kept the tail).`
    : "";
  const footer = `(${range}${loc}${cap})`;
  return preview ? `${header}\n${preview}\n${footer}` : `${header}\n${footer}`;
}

/**
 * 终端回包：全文落盘，模型只看最后 N 行和路径。
 * `lineLimit` 来自调用参数 result_limit，默认 200；0 只留状态和路径。
 */
export function retainTerminalOutput(
  output: string,
  lineLimit: number,
  opts?: SpillOpts,
): { text: string; overflowPath?: string } {
  if (!output) return { text: "" };
  const captured = capTerminalCapture(output);
  const overflowPath = writeSpillFile(captured.text, opts);
  const { preview, total, from, to } = takeLastLines(captured.text, lineLimit);
  return {
    text: terminalPreviewEnvelope(
      preview,
      from,
      to,
      total,
      [...captured.text].length,
      overflowPath,
      captured.truncated,
    ),
    overflowPath,
  };
}

/**
 * 头尾留给模型，中间省掉的字节写到磁盘并在正文里给出路。
 *
 * `sourceId` 决定落盘文件名，同时是 `peekOverflow` 的键。终端传 terminalId，
 * 其他工具传「工具名 + toolCallId」。
 */
export function applyOutputLimit(
  output: string,
  limit: number,
  opts?: SpillOpts,
): { text: string; overflowPath?: string } {
  if (!output) return { text: "" };
  if (limit === 0) return { text: "" };
  if (output.length <= limit) return { text: output };

  const truncated = truncateMiddle(output, limit);
  const overflowPath = writeSpillFile(output, opts);
  if (!overflowPath) return { text: truncated };

  const omitted = Math.max(0, output.length - limit);
  const notice = `\n\n... ${formatRetentionNotice(
    { kind: "exact", count: omitted, unit: "chars" },
    { locator: overflowPath, retrieveHint: spillRetrieveHint() },
  )} ...\n\n`;
  const budget = Math.max(32, limit - notice.length);
  const headSize = Math.floor(budget * 0.6);
  const tailSize = Math.max(1, budget - headSize);
  return {
    text: output.slice(0, headSize) + notice + output.slice(output.length - tailSize),
    overflowPath,
  };
}
