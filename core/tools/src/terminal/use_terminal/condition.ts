/**
 * 终端/文件条件返回：return_when=filter|until + 受限 Python 表达式。
 * 通过 condition_eval.py 求值（AST 白名单）。
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type ReturnWhen = "filter" | "until";

export interface ConditionHit {
  line: number;
  text: string;
  value?: string | null;
  context_before?: string[];
  context_after?: string[];
  error?: string;
}

export interface ConditionResult {
  ok: boolean;
  mode?: ReturnWhen;
  matched?: number;
  hits?: ConditionHit[];
  truncated?: boolean;
  scanned?: number;
  error?: string;
  message?: string;
}

const __dir = dirname(fileURLToPath(import.meta.url));

/** dist 与 src 两处都能找到脚本 */
export function resolveConditionEvalScript(): string | null {
  const candidates = [
    join(__dir, "condition_eval.py"),
    join(__dir, "..", "..", "..", "src", "terminal", "use_terminal", "condition_eval.py"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function resolvePython(): string {
  for (const cmd of ["python3", "python"]) {
    try {
      const r = spawnSync(cmd, ["--version"], { encoding: "utf-8" });
      if (r.status === 0) return cmd;
    } catch {
      /* try next */
    }
  }
  return "python3";
}

export interface EvalLinesOpts {
  expr: string;
  match?: string;
  mode: ReturnWhen;
  maxHits?: number;
  contextLines?: number;
}

/** 对内存中的文本（多行）求值 */
export async function evalConditionOnText(
  text: string,
  opts: EvalLinesOpts,
): Promise<ConditionResult> {
  const script = resolveConditionEvalScript();
  if (!script) {
    return { ok: false, error: "script_missing", message: "condition_eval.py not found" };
  }
  const py = resolvePython();
  const args = [
    script,
    "--expr",
    opts.expr,
    "--mode",
    opts.mode,
    "--max-hits",
    String(opts.maxHits ?? 100),
    "--context-lines",
    String(opts.contextLines ?? 3),
  ];
  if (opts.match) {
    args.push("--match", opts.match);
  }

  return new Promise((resolve) => {
    const child = spawn(py, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString("utf-8");
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString("utf-8");
    });
    child.on("error", (err) => {
      resolve({
        ok: false,
        error: "python_spawn_failed",
        message: err.message + (stderr ? ` ${stderr}` : ""),
      });
    });
    child.on("close", () => {
      const line = stdout.trim().split("\n").filter(Boolean).pop() ?? "";
      try {
        const parsed = JSON.parse(line) as ConditionResult;
        resolve(parsed);
      } catch {
        resolve({
          ok: false,
          error: "bad_python_output",
          message: (stdout || stderr || "empty").slice(0, 500),
        });
      }
    });
    child.stdin?.write(text.endsWith("\n") ? text : text + "\n");
    child.stdin?.end();
  });
}

/** 扫文件 */
export async function evalConditionOnFile(
  path: string,
  opts: EvalLinesOpts,
): Promise<ConditionResult> {
  const script = resolveConditionEvalScript();
  if (!script) {
    return { ok: false, error: "script_missing", message: "condition_eval.py not found" };
  }
  if (!existsSync(path)) {
    return { ok: false, error: "file_not_found", message: path };
  }
  const py = resolvePython();
  const args = [
    script,
    "--path",
    path,
    "--expr",
    opts.expr,
    "--mode",
    opts.mode,
    "--max-hits",
    String(opts.maxHits ?? 100),
    "--context-lines",
    String(opts.contextLines ?? 3),
  ];
  if (opts.match) args.push("--match", opts.match);

  return new Promise((resolve) => {
    const child = spawn(py, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString("utf-8");
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString("utf-8");
    });
    child.on("error", (err) => {
      resolve({ ok: false, error: "python_spawn_failed", message: err.message });
    });
    child.on("close", () => {
      const line = stdout.trim().split("\n").filter(Boolean).pop() ?? "";
      try {
        resolve(JSON.parse(line) as ConditionResult);
      } catch {
        resolve({
          ok: false,
          error: "bad_python_output",
          message: (stdout || stderr || "empty").slice(0, 500),
        });
      }
    });
  });
}

export function formatConditionHits(result: ConditionResult, limit = 8000): string {
  if (!result.ok) {
    return `条件求值失败: ${result.error ?? "?"} ${result.message ?? ""}`.trim();
  }
  const hits = result.hits ?? [];
  if (hits.length === 0) {
    return `条件未命中（已扫描 ${result.scanned ?? 0} 行）`;
  }
  const lines: string[] = [
    `条件命中 ${result.matched} 处` +
      (result.truncated ? "（已达 max_hits 上限）" : "") +
      ` · 扫描 ${result.scanned ?? "?"} 行`,
    "",
  ];
  for (const h of hits.slice(0, 50)) {
    lines.push(`L${h.line}: ${h.text}`);
    if (h.value != null && h.value !== "") lines.push(`  value=${h.value}`);
  }
  if (hits.length > 50) lines.push(`… 另有 ${hits.length - 50} 条未展示`);
  let out = lines.join("\n");
  if (out.length > limit) out = out.slice(0, limit) + "\n…(截断)";
  return out;
}

/** 校验 expr 非空且不太夸张 */
export function validateConditionParams(opts: {
  returnWhen?: string;
  expr?: string;
  match?: string;
}): string | null {
  const rw = (opts.returnWhen ?? "").trim();
  if (!rw) return null;
  if (rw !== "filter" && rw !== "until") {
    return `return_when 须为 filter 或 until，收到: ${rw}`;
  }
  const expr = (opts.expr ?? "").trim();
  const match = (opts.match ?? "").trim();
  if (!expr && !match) {
    return "return_when 已设置时须提供 expr 和/或 match（match  alone 时默认 expr 为 m is not None）";
  }
  if (expr.length > 2000) return "expr 过长（上限 2000 字符）";
  return null;
}

export function resolveExpr(expr: string | undefined, match: string | undefined): string {
  const e = (expr ?? "").trim();
  if (e) return e;
  if ((match ?? "").trim()) return "m is not None";
  return "False";
}
