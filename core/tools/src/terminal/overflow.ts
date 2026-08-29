/**
 * 工具输出超限：头尾留给模型，全文写到会话旁临时文件。
 * 写文件失败不把成功命令改口失败。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatRetentionNotice, spillRetrieveHint } from "@little-house-studio/types";
import { truncateMiddle } from "../util/common.js";

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

/**
 * 头尾留给模型，中间省掉的字节写到磁盘并在正文里给出路。
 *
 * `sourceId` 决定落盘文件名，同时是 `peekOverflow` 的键。终端传 terminalId，
 * 其他工具传「工具名 + toolCallId」。
 */
export function applyOutputLimit(
  output: string,
  limit: number,
  opts?: {
    sessionId?: string;
    projectRoot?: string;
    sourceId?: string;
    /** 终端侧旧参数名；等价于 sourceId */
    terminalId?: string;
  },
): { text: string; overflowPath?: string } {
  if (!output) return { text: "" };
  if (limit === 0) return { text: "" };
  if (output.length <= limit) return { text: output };

  const truncated = truncateMiddle(output, limit);
  const root = opts?.projectRoot?.trim();
  const sid = opts?.sessionId?.trim() || "anon";
  const sourceId = (opts?.sourceId ?? opts?.terminalId ?? "").trim();
  if (!root) return { text: truncated };

  try {
    const dir = spillDir(root, sid);
    mkdirSync(dir, { recursive: true });
    const safeId = (sourceId || "out").replace(/[^\w.-]+/g, "_").slice(0, 80);
    const path = join(dir, `${safeId}-${Date.now()}.txt`);
    writeFileSync(path, output, "utf-8");
    if (sourceId) rememberOverflow(sourceId, path);
    const omitted = Math.max(0, output.length - limit);
    const notice = `\n\n... ${formatRetentionNotice(
      { kind: "exact", count: omitted, unit: "chars" },
      { locator: path, retrieveHint: spillRetrieveHint() },
    )} ...\n\n`;
    const budget = Math.max(32, limit - notice.length);
    const headSize = Math.floor(budget * 0.6);
    const tailSize = Math.max(1, budget - headSize);
    return {
      text: output.slice(0, headSize) + notice + output.slice(output.length - tailSize),
      overflowPath: path,
    };
  } catch {
    return { text: truncated };
  }
}
