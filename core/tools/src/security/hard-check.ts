/**
 * 硬指标检查 —— /goal verify 用的安全命令执行。
 *
 * 安全约束（故意偏严）：
 *  - 不用 shell:true / 不解释 ; | & $ () ` 等
 *  - 仅允许白名单解释器 + 项目内脚本路径
 *  - 所有相对路径必须解析在 projectRoot 下
 *  - 超时 / 输出长度上限
 *
 * 退出码 0 = pass，非 0 = fail。
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, resolve, relative } from "node:path";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT = 32_000;

/** 允许的解释器 / 启动器（basename） */
const ALLOWED_BINS = new Set([
  "node",
  "nodejs",
  "python3",
  "python",
  "bash",
  "sh",
  "pnpm",
  "npm",
  "npx",
  "bun",
  "deno",
]);

/** 危险字符：出现即拒绝 */
const UNSAFE_RE = /[;|&`$(){}<>\n\r]|&&|\|\|/;

export interface HardCheckResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  commandLine: string;
  error?: string;
}

export interface HardCheckOptions {
  projectRoot: string;
  /** 如 "node scripts/check-stage1.mjs" 或 "python3 tools/check.py --stage 1" */
  command: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

function isUnderRoot(root: string, candidate: string): boolean {
  if (candidate === root) return true;
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * 将用户命令解析为 argv，并做安全校验。
 * What: hard_check_parse
 * How: whitelist_bin_and_project_paths
 */
export function parseHardCheckCommand(
  projectRoot: string,
  command: string,
): { ok: true; argv: string[] } | { ok: false; error: string } {
  const raw = command.trim();
  if (!raw) return { ok: false, error: "check_command 为空" };
  if (UNSAFE_RE.test(raw)) {
    return {
      ok: false,
      error:
        "check_command 含不安全字符（禁止 ; | & $ ` () {} <> 与换行）。" +
        "请用空格分隔的简单 argv，例如：node scripts/check.mjs",
    };
  }

  // 简单空白分词（不支持引号转义 —— 故意简化，避免 shell 语义）
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { ok: false, error: "check_command 解析为空" };

  const root = resolve(projectRoot);
  const argv: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (i === 0) {
      // 第一段：白名单 bin 或项目内可执行脚本
      const base = p.split(/[/\\]/).pop() ?? p;
      if (ALLOWED_BINS.has(base) && !p.includes("/") && !p.includes("\\")) {
        argv.push(p);
        continue;
      }
      // 相对/绝对脚本路径
      const abs = isAbsolute(p) ? resolve(p) : resolve(root, p);
      if (!isUnderRoot(root, abs)) {
        return { ok: false, error: `可执行文件不在项目内: ${p}` };
      }
      if (!existsSync(abs)) {
        return { ok: false, error: `可执行文件不存在: ${p}` };
      }
      // 脚本扩展名限制
      if (!/\.(mjs|js|cjs|py|sh)$/i.test(abs)) {
        return {
          ok: false,
          error: `仅允许 .mjs/.js/.cjs/.py/.sh 脚本作为直接入口: ${p}`,
        };
      }
      // 用 node/python/bash 包装更安全
      if (/\.py$/i.test(abs)) {
        argv.push("python3", abs);
      } else if (/\.sh$/i.test(abs)) {
        argv.push("bash", abs);
      } else {
        argv.push("node", abs);
      }
      continue;
    }

    // 后续参数：若像路径则必须在项目内；flag 放行
    if (p.startsWith("-")) {
      // 禁止 -c / -e 等执行任意代码的 flag
      if (/^-[ce]$/.test(p) || p === "--eval" || p === "--command") {
        return { ok: false, error: `禁止解释器代码注入 flag: ${p}` };
      }
      argv.push(p);
      continue;
    }

    if (p.includes("/") || p.includes("\\") || p.includes("..")) {
      const abs = isAbsolute(p) ? resolve(p) : resolve(root, p);
      if (!isUnderRoot(root, abs)) {
        return { ok: false, error: `参数路径越出项目: ${p}` };
      }
      argv.push(abs);
    } else {
      // 简单 token（数字、标识符）
      if (!/^[\w.@+=,:%-]+$/i.test(p)) {
        return { ok: false, error: `参数含非法字符: ${p}` };
      }
      argv.push(p);
    }
  }

  if (argv.length === 0) return { ok: false, error: "解析后 argv 为空" };
  return { ok: true, argv };
}

/**
 * 执行硬指标检查。
 * What: hard_check_run
 * How: spawn_no_shell_timeout
 */
export function runHardCheck(opts: HardCheckOptions): Promise<HardCheckResult> {
  const parsed = parseHardCheckCommand(opts.projectRoot, opts.command);
  if (!parsed.ok) {
    return Promise.resolve({
      ok: false,
      code: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      commandLine: opts.command,
      error: parsed.error,
    });
  }

  const { argv } = parsed;
  const commandLine = argv.join(" ");
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cwd = resolve(opts.projectRoot);

  return new Promise((resolvePromise) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const child = spawn(argv[0]!, argv.slice(1), {
      cwd,
      env: {
        ...process.env,
        ...opts.env,
        // 禁止交互
        CI: "1",
        MAOU_HARD_CHECK: "1",
      },
      shell: false,
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, timeoutMs);

    const onData = (buf: Buffer, which: "out" | "err") => {
      const s = buf.toString("utf-8");
      if (which === "out") {
        stdout = (stdout + s).slice(0, MAX_OUTPUT);
      } else {
        stderr = (stderr + s).slice(0, MAX_OUTPUT);
      }
    };

    child.stdout?.on("data", (b) => onData(b, "out"));
    child.stderr?.on("data", (b) => onData(b, "err"));

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({
        ok: false,
        code: null,
        stdout,
        stderr,
        timedOut,
        commandLine,
        error: err.message,
      });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const exit = code ?? (timedOut ? 124 : 1);
      resolvePromise({
        ok: !timedOut && exit === 0,
        code: exit,
        stdout,
        stderr,
        timedOut,
        commandLine,
        error: timedOut ? `超时（>${timeoutMs}ms）` : undefined,
      });
    });
  });
}
