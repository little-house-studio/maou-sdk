/**
 * Destructive Command Guard (dcg) 适配器 — 终端破坏性命令的必要依赖。
 *
 * 调用官方 CLI：`dcg test --format json --robot <command>`
 * - decision=allow → 放行
 * - decision=deny  → 先走 maou 安全白名单（产物 rm -rf / 单文件 restore 等），
 *                    仍不匹配才拦截
 * - 二进制缺失 → 尝试 ensure 后仍缺失则 fail-closed（必要依赖）
 *
 * 文档：https://github.com/Dicklesworthstone/destructive_command_guard
 */

import { tryOverrideDcgDeny } from "./safe-allow.js";

import { existsSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type DcgDecision = "allow" | "deny" | "error";

export interface DcgEvalResult {
  decision: DcgDecision;
  command: string;
  reason?: string;
  explanation?: string;
  ruleId?: string;
  packId?: string;
  severity?: string;
  /** 原始 JSON（调试） */
  raw?: Record<string, unknown>;
  /** 使用的 dcg 路径 */
  binary?: string;
  /** 未找到二进制 / 超时等 */
  error?: string;
  /** DCG 原判 deny，但被 maou 安全白名单放行 */
  maouSafeAllow?: { id: string; reason: string };
  /** 跳过 maou 安全白名单（测试用） */
  skippedSafeAllow?: boolean;
}

export interface DcgGuardOptions {
  /** 覆盖二进制路径 */
  binaryPath?: string;
  /** 超时 ms，默认 250 */
  timeoutMs?: number;
  /** 额外启用的 packs（逗号分隔），叠加 DCG_PACKS */
  extraPacks?: string[];
  /**
   * 未找到 dcg 时：
   * - true（默认）：fail-closed 拒绝执行
   * - false：仅日志并 allow（不推荐；必要依赖应为 true）
   */
  required?: boolean;
  /**
   * 是否启用 maou 安全白名单覆盖 DCG deny（默认 true）。
   * 设 false 可看到「纯 DCG」行为。
   */
  safeAllow?: boolean;
}

/** 测试可注入的评估器 */
export type DcgEvaluator = (command: string, opts?: DcgGuardOptions) => Promise<DcgEvalResult>;

let injectedEvaluator: DcgEvaluator | null = null;
let cachedBinary: string | null | undefined;

/** 单测注入 / 恢复 */
export function setDcgEvaluatorForTest(fn: DcgEvaluator | null): void {
  injectedEvaluator = fn;
}

export function resetDcgBinaryCache(): void {
  cachedBinary = undefined;
}

function binName(): string {
  return platform() === "win32" ? "dcg.exe" : "dcg";
}

/** 解析 monorepo 根（tools → core → sdk） */
function guessRepoRoot(): string | null {
  try {
    // .../core/tools/src/terminal/dcg-guard.ts → 上 4 层到 core/tools，再上 2 到 sdk
    const here = dirname(fileURLToPath(import.meta.url));
    // dist: .../core/tools/dist/terminal → 上 3 层到 tools，再上 2 到 sdk
    const candidates = [
      join(here, "..", "..", "..", ".."), // src: terminal→src→tools→core→sdk
      join(here, "..", "..", ".."), // dist: terminal→dist→tools→?  wait
    ];
    // 更稳：向上找含 vendor/bin 或 pnpm-workspace.yaml 的目录
    let dir = here;
    for (let i = 0; i < 8; i++) {
      if (
        existsSync(join(dir, "pnpm-workspace.yaml")) ||
        existsSync(join(dir, "vendor", "bin", binName())) ||
        existsSync(join(dir, "scripts", "ensure-dcg.mjs"))
      ) {
        return dir;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return candidates[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * 解析 dcg 二进制路径。
 * 顺序：opts / MAOU_DCG_PATH / DCG_PATH / vendor/bin / ~/.local/bin / PATH which
 */
export function resolveDcgBinary(explicit?: string): string | null {
  if (explicit && existsSync(explicit)) return explicit;
  const env =
    process.env.MAOU_DCG_PATH ||
    process.env.DCG_PATH ||
    process.env.DCG_BIN ||
    "";
  if (env && existsSync(env)) return env;

  if (cachedBinary !== undefined) return cachedBinary;

  const name = binName();
  const roots: string[] = [];
  const repo = guessRepoRoot();
  if (repo) roots.push(join(repo, "vendor", "bin", name));
  // 用户安装器默认路径（跨平台）
  roots.push(join(homedir(), ".maou", "bin", name));
  roots.push(join(homedir(), ".local", "bin", name));
  roots.push(join(homedir(), "bin", name));

  for (const p of roots) {
    if (existsSync(p)) {
      cachedBinary = p;
      return p;
    }
  }

  // PATH
  try {
    const whichCmd = platform() === "win32" ? "where" : "which";
    const out = execFileSync(whichCmd, [name.replace(/\.exe$/, "")], {
      encoding: "utf-8",
      timeout: 3000,
    })
      .trim()
      .split(/\r?\n/)[0];
    if (out && existsSync(out)) {
      cachedBinary = out;
      return out;
    }
  } catch {
    /* not on PATH */
  }

  cachedBinary = null;
  return null;
}

/** 尝试运行 monorepo ensure-dcg.mjs（同步，安装时用） */
export function ensureDcgInstalled(): string | null {
  resetDcgBinaryCache();
  const existing = resolveDcgBinary();
  if (existing) return existing;

  const repo = guessRepoRoot();
  if (!repo) return null;
  const script = join(repo, "scripts", "ensure-dcg.mjs");
  if (!existsSync(script)) return null;
  try {
    execFileSync(process.execPath, [script], {
      encoding: "utf-8",
      timeout: 180_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    /* install failed */
  }
  resetDcgBinaryCache();
  return resolveDcgBinary();
}

function parseJsonPayload(stdout: string): Record<string, unknown> | null {
  const text = (stdout || "").trim();
  if (!text) return null;
  // 可能混有多行；取最后一个 { ... } 块
  const start = text.lastIndexOf("{");
  if (start < 0) return null;
  try {
    return JSON.parse(text.slice(start)) as Record<string, unknown>;
  } catch {
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

/** DCG deny 后应用 maou 安全白名单；环境变量 MAOU_DCG_STRICT=1 可关闭覆盖 */
function applySafeAllow(
  command: string,
  result: DcgEvalResult,
  opts: DcgGuardOptions,
): DcgEvalResult {
  if (result.decision !== "deny") return result;
  if (opts.safeAllow === false) return result;
  if (process.env.MAOU_DCG_STRICT === "1") return { ...result, skippedSafeAllow: true };
  const hit = tryOverrideDcgDeny(command);
  if (!hit) return result;
  return {
    ...result,
    decision: "allow",
    maouSafeAllow: hit,
    reason: `maou 安全放行（${hit.id}）：${hit.reason}；原 DCG：${result.ruleId || result.reason || "deny"}`,
  };
}

/**
 * 用 dcg 评估命令是否允许执行。
 */
export async function evaluateWithDcg(
  command: string,
  opts: DcgGuardOptions = {},
): Promise<DcgEvalResult> {
  if (injectedEvaluator) {
    const r = await injectedEvaluator(command, opts);
    return applySafeAllow(command, r, opts);
  }

  // 显式旁路（与上游 DCG_BYPASS 对齐）
  if (process.env.DCG_BYPASS === "1" || process.env.MAOU_DCG_BYPASS === "1") {
    return {
      decision: "allow",
      command,
      reason: "DCG_BYPASS/MAOU_DCG_BYPASS=1",
    };
  }

  const required = opts.required !== false;
  let binary = resolveDcgBinary(opts.binaryPath);
  if (!binary) {
    binary = ensureDcgInstalled();
  }
  if (!binary) {
    if (!required) {
      return {
        decision: "allow",
        command,
        error: "dcg binary not found (optional mode)",
      };
    }
    return {
      decision: "deny",
      command,
      reason:
        "必要依赖 dcg（Destructive Command Guard）未安装。请在 maou-sdk 根目录执行: node scripts/ensure-dcg.mjs",
      error: "dcg-missing",
    };
  }

  const timeoutMs = opts.timeoutMs ?? 400;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // 注意：不要设 DCG_QUIET=1 —— quiet 会吞掉 test 的 JSON stdout
    DCG_FORMAT: "json",
    DCG_NO_RICH: "1",
    DCG_NO_COLOR: "1",
  };
  // coding agent 常用：默认额外打开 docker 等（可用 MAOU_DCG_PACKS 覆盖）
  const packs =
    opts.extraPacks?.join(",") ||
    process.env.MAOU_DCG_PACKS ||
    process.env.DCG_PACKS ||
    "";
  if (packs) env.DCG_PACKS = packs;
  // 清理可能从父进程继承的 quiet
  delete env.DCG_QUIET;

  const args = ["test", "--format", "json", "--robot", command];

  try {
    const result = await new Promise<{
      code: number | null;
      stdout: string;
      stderr: string;
      killed: boolean;
    }>((resolve, reject) => {
      const child = spawn(binary, args, {
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let killed = false;
      const timer = setTimeout(() => {
        killed = true;
        child.kill("SIGTERM");
      }, timeoutMs);
      child.stdout?.setEncoding("utf-8");
      child.stderr?.setEncoding("utf-8");
      child.stdout?.on("data", (c: string) => {
        stdout += c;
      });
      child.stderr?.on("data", (c: string) => {
        stderr += c;
      });
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr, killed });
      });
    });

    if (result.killed) {
      return {
        decision: "allow",
        command,
        binary,
        error: `dcg timeout ${timeoutMs}ms (fail-open)`,
      };
    }

    const raw = parseJsonPayload(result.stdout) || parseJsonPayload(result.stderr);
    if (!raw) {
      return {
        decision: "allow",
        command,
        binary,
        error: `dcg empty output code=${result.code} (fail-open)`,
      };
    }

    if (raw.decision === "deny" || result.code === 1) {
      // code 1 通常为 deny；以 JSON decision 为准
      if (raw.decision === "allow") {
        return {
          decision: "allow",
          command: String(raw.command ?? command),
          raw,
          binary,
        };
      }
      return applySafeAllow(
        command,
        {
          decision: "deny",
          command: String(raw.command ?? command),
          reason: raw.reason ? String(raw.reason) : "dcg denied",
          explanation: raw.explanation ? String(raw.explanation) : undefined,
          ruleId: raw.rule_id ? String(raw.rule_id) : undefined,
          packId: raw.pack_id ? String(raw.pack_id) : undefined,
          severity: raw.severity ? String(raw.severity) : undefined,
          raw,
          binary,
        },
        opts,
      );
    }

    return {
      decision: "allow",
      command: String(raw.command ?? command),
      reason: raw.reason ? String(raw.reason) : undefined,
      raw,
      binary,
    };
  } catch (err: unknown) {
    const e = err as { message?: string };
    return {
      decision: "allow",
      command,
      binary,
      error: e.message || String(err),
    };
  }
}

/** 格式化给 Agent 看的拦截文案 */
export function formatDcgDenyMessage(r: DcgEvalResult): string {
  const lines = [
    `⛔ [DCG 安全拦截] 破坏性命令被 Destructive Command Guard 阻止：\`${r.command}\``,
  ];
  if (r.reason) lines.push(`原因：${r.reason}`);
  if (r.ruleId) lines.push(`规则：${r.ruleId}${r.packId ? `（pack: ${r.packId}）` : ""}`);
  if (r.severity) lines.push(`严重级别：${r.severity}`);
  if (r.explanation) {
    const short = r.explanation.length > 600 ? r.explanation.slice(0, 600) + "…" : r.explanation;
    lines.push(`说明：\n${short}`);
  }
  lines.push(
    "这是必要安全依赖拦截，不可被 yolo/白名单绕过。",
    "若确需执行：由人类在本机确认后手动运行，或临时设置环境变量 MAOU_DCG_BYPASS=1（慎用）。",
    "请改用更安全的方式（git stash / 文件工具 / 精确删除路径）完成目标。",
  );
  return lines.join("\n");
}
