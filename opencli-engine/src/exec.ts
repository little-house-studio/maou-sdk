/**
 * OpenCLI 子进程执行
 */

import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { parseOpencliOutput, formatEnvelope, truncate, MSG_LIMIT } from "./shortcuts.js";
import type { OpencliEnvelope } from "./types.js";

const execFileAsync = promisify(execFile);

export const EXEC_TIMEOUT = 60_000;
export const EXEC_BUFFER = 10 * 1024 * 1024;

let cachedAvailable: boolean | undefined;

/** opencli 是否可用 */
export function isAvailable(): boolean {
  if (cachedAvailable !== undefined) return cachedAvailable;
  try {
    execFileSync("opencli", ["--version"], { stdio: "ignore" });
    cachedAvailable = true;
  } catch {
    cachedAvailable = false;
  }
  return cachedAvailable;
}

export interface RawResult {
  success: boolean;
  message: string;
  envelope: OpencliEnvelope | null;
  rawText: string;
  exitCode: number;
  stdoutStr: string;
  stderrStr: string;
}

/** 异步执行 opencli 命令（Promise 版） */
export async function runOpencliAsync(
  args: string[],
  session: string,
  cwd: string,
): Promise<RawResult> {
  const fullArgs = ["browser", session, ...args];
  try {
    const { stdout, stderr } = await execFileAsync("opencli", fullArgs, {
      cwd, timeout: EXEC_TIMEOUT, maxBuffer: EXEC_BUFFER, encoding: "utf-8",
    });
    const stdoutStr = stdout?.trim() ?? "";
    const stderrStr = stderr?.trim() ?? "";
    const { envelope, rawText } = parseOpencliOutput(stdoutStr || stderrStr);
    const message = envelope ? truncate(formatEnvelope(envelope), MSG_LIMIT) : truncate(rawText || "操作完成", MSG_LIMIT);
    return { success: true, message, envelope, rawText, exitCode: 0, stdoutStr, stderrStr };
  } catch (error: unknown) {
    const err = error as { code?: number; stdout?: string; stderr?: string };
    const stdoutStr = err.stdout?.trim() ?? "";
    const stderrStr = err.stderr?.trim() ?? "";
    const { envelope, rawText } = parseOpencliOutput(stdoutStr || stderrStr);
    const message = envelope ? truncate(formatEnvelope(envelope), MSG_LIMIT) : truncate(rawText || `操作失败，退出码: ${err.code}`, MSG_LIMIT);
    return { success: false, message, envelope, rawText, exitCode: err.code ?? 1, stdoutStr, stderrStr };
  }
}

/** 执行 opencli 命令（callback→Promise，返回原始结果） */
export function runOpencli(args: string[], session: string, cwd: string): Promise<RawResult> {
  return new Promise((resolve) => {
    const fullArgs = ["browser", session, ...args];
    execFile("opencli", fullArgs, { cwd, timeout: EXEC_TIMEOUT, maxBuffer: EXEC_BUFFER, encoding: "utf-8" }, (error, stdout, stderr) => {
      const exitCode = error ? (typeof error.code === "number" ? error.code : 1) : 0;
      const stdoutStr = stdout?.trim() ?? "";
      const stderrStr = stderr?.trim() ?? "";
      const { envelope, rawText } = parseOpencliOutput(stdoutStr || stderrStr);
      const message = envelope ? formatEnvelope(envelope) : (rawText || (exitCode === 0 ? "操作完成（无输出）" : `操作失败，退出码: ${exitCode}`));
      resolve({ success: exitCode === 0, message, envelope, rawText, exitCode, stdoutStr, stderrStr });
    });
  });
}
