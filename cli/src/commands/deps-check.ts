/**
 * 依赖预检 / doctor —— 分档机制
 *
 * Core     必须 → 失败不可启动（exit 1）
 * Terminal 建议 → 缺失可启动，终端/安全降级（exit 0 + △）
 * Optional 可选 → 提示
 * Install  信息 → git/pnpm/API/TUI（仅报告）
 *
 * monorepo：禁止对 optional 包执行 npm install（只会失败刷屏）。
 */

import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { platform, homedir } from "node:os";
import { findMonorepoRoot, findSdkGitRoot, resolveCliPackageRoot } from "./repo-root.js";

function runInherit(cmd: string, args: string[], cwd: string): boolean {
  const r = spawnSync(cmd, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  return r.status === 0;
}

const require = createRequire(import.meta.url);

export const CRITICAL_PACKAGES = [
  "@little-house-studio/types",
  "@little-house-studio/agent",
  "@little-house-studio/coding-agent",
  "@little-house-studio/llm",
  "@little-house-studio/tools",
  "@little-house-studio/context",
] as const;

export const OPTIONAL_PACKAGES = [
  "@little-house-studio/terminal-engine",
  "@little-house-studio/sqry-engine",
  "@little-house-studio/opencli-engine",
  "@little-house-studio/lsp-engine",
] as const;

export type CapabilityTier = {
  core: boolean;
  terminal: boolean;
  dcg: boolean;
  sqry: boolean;
};

export interface DepCheckResult {
  ok: boolean;
  nodeOk: boolean;
  nodeVersion: string;
  missingCritical: string[];
  missingOptional: string[];
  repaired: string[];
  errors: string[];
  warnings: string[];
  cliRoot: string;
  monoRoot: string | null;
  distOk: boolean;
  tiers: CapabilityTier;
  details: {
    terminalEngine: string;
    dcg: string;
    sqry: string;
    git: string;
    pnpm: string;
    apiConfig: string;
    tui: string;
  };
}

function log(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

function commandOnPath(name: string): boolean {
  const cmd = platform() === "win32" ? "where" : "which";
  const r = spawnSync(cmd, [name], { encoding: "utf-8", windowsHide: true });
  return r.status === 0 && Boolean(r.stdout?.trim());
}

function canResolve(pkg: string): boolean {
  try {
    require.resolve(pkg);
    return true;
  } catch {
    try {
      require.resolve(`${pkg}/package.json`);
      return true;
    } catch {
      return false;
    }
  }
}

async function canImport(pkg: string): Promise<boolean> {
  if (canResolve(pkg)) return true;
  try {
    await import(pkg);
    return true;
  } catch {
    return false;
  }
}

/** monorepo 内用磁盘 dist/src 判断包是否存在（避免 workspace 解析假阴性） */
function monorepoPackagePresent(mono: string, pkgName: string): boolean {
  const map: Record<string, string> = {
    "@little-house-studio/types": "core/types",
    "@little-house-studio/agent": "core/agent",
    "@little-house-studio/coding-agent": "agent/coding-agent",
    "@little-house-studio/llm": "core/llm",
    "@little-house-studio/tools": "core/tools",
    "@little-house-studio/context": "core/context",
    "@little-house-studio/terminal-engine": "terminal-engine",
    "@little-house-studio/sqry-engine": "sqry-engine",
    "@little-house-studio/opencli-engine": "opencli-engine",
    "@little-house-studio/lsp-engine": "lsp-engine",
  };
  const rel = map[pkgName];
  if (!rel) return false;
  const base = join(mono, rel);
  return (
    existsSync(join(base, "package.json")) &&
    (existsSync(join(base, "dist")) ||
      existsSync(join(base, "src")) ||
      existsSync(join(base, "index.js")) ||
      readdirSync(base).some((f) => f.endsWith(".node")))
  );
}

function checkNodeVersion(): { ok: boolean; version: string } {
  const version = process.versions.node;
  const major = parseInt(version.split(".")[0] ?? "0", 10);
  return { ok: major >= 20, version };
}

function detectTerminalEngine(cliRoot: string, mono: string | null): { ok: boolean; detail: string } {
  const teDir = mono ? join(mono, "terminal-engine") : null;
  if (teDir && existsSync(join(teDir, "package.json"))) {
    try {
      const nodes = readdirSync(teDir).filter((f) => f.endsWith(".node"));
      if (nodes.length) return { ok: true, detail: nodes.join(", ") };
      return { ok: false, detail: "源码在但无 .node — scripts/build-native" };
    } catch {
      return { ok: false, detail: "无法读取 terminal-engine" };
    }
  }
  try {
    require.resolve("@little-house-studio/terminal-engine");
    return { ok: true, detail: "package resolvable" };
  } catch {
    return { ok: false, detail: "未构建 / 未安装" };
  }
}

function detectDcg(mono: string | null): { ok: boolean; detail: string } {
  const name = platform() === "win32" ? "dcg.exe" : "dcg";
  const candidates = [
    process.env.MAOU_DCG_PATH,
    process.env.DCG_PATH,
    mono ? join(mono, "vendor", "bin", name) : "",
    join(homedir(), ".maou", "bin", name),
    join(homedir(), ".local", "bin", name),
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    if (existsSync(p)) return { ok: true, detail: p };
  }
  if (commandOnPath("dcg") || commandOnPath("dcg.exe")) {
    return { ok: true, detail: "on PATH" };
  }
  return { ok: false, detail: "缺失 — node scripts/ensure-dcg.mjs --user" };
}

function detectSqry(): { ok: boolean; detail: string } {
  const names = platform() === "win32" ? ["sqry.exe", "sqry"] : ["sqry"];
  const dirs = [
    join(homedir(), ".cargo", "bin"),
    join(homedir(), ".maou", "bin"),
    join(homedir(), ".local", "bin"),
  ];
  for (const n of names) {
    for (const d of dirs) {
      const p = join(d, n);
      if (existsSync(p)) return { ok: true, detail: p };
    }
  }
  if (commandOnPath("sqry") || commandOnPath("sqry.exe")) {
    return { ok: true, detail: "on PATH" };
  }
  return { ok: false, detail: "未安装（find_code 不可用）" };
}

function detectGit(mono: string | null): string {
  if (!commandOnPath("git")) return "✗ git 不在 PATH";
  const root = findSdkGitRoot(mono ?? undefined);
  if (!root) return "△ 非 git clone 安装（maou update 不可用）";
  const url = spawnSync("git", ["config", "--get", "remote.origin.url"], {
    cwd: root,
    encoding: "utf-8",
    windowsHide: true,
  });
  const branch = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: root,
    encoding: "utf-8",
    windowsHide: true,
  });
  const short = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: root,
    encoding: "utf-8",
    windowsHide: true,
  });
  const u = (url.stdout ?? "").trim() || "no-origin";
  const b = (branch.stdout ?? "").trim() || "?";
  const h = (short.stdout ?? "").trim() || "?";
  return `✓ ${b}@${h} ${u}`;
}

function detectPnpm(): string {
  return commandOnPath("pnpm") ? "✓ on PATH" : "✗ 未安装（npm i -g pnpm）";
}

function detectApiConfig(): string {
  try {
    const envPath = process.env.MAOU_LLM_CONFIG?.trim();
    const p =
      (envPath && existsSync(envPath) ? envPath : "") ||
      join(homedir(), ".maou", "config.json");
    if (!existsSync(p)) return `△ 无配置文件 — maou setup`;
    const raw = JSON.parse(readFileSync(p, "utf-8")) as {
      api?: { presets?: unknown[] };
    };
    const n = Array.isArray(raw.api?.presets) ? raw.api!.presets!.length : 0;
    const envKey = Boolean(
      process.env.MAOU_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY,
    );
    if (n > 0 || envKey) return `✓ 已配置（${n} presets；不打印密钥）`;
    return `△ 配置存在但无 preset — maou setup`;
  } catch {
    return "△ 无法读取 API 配置";
  }
}

function detectTui(mono: string | null): string {
  const forced = process.env.MAOU_TUI || "";
  const def = "ratatui";
  const active = forced || def;
  const exe = platform() === "win32" ? ".exe" : "";
  const bins = [
    process.env.MAOU_TUI_BIN,
    mono ? join(mono, "cli/tui-ratatui/target/release/maou-tui-ratatui" + exe) : "",
    join(homedir(), ".maou", "bin", "maou-tui-ratatui" + exe),
  ].filter(Boolean) as string[];
  const hasRt = bins.some((b) => existsSync(b));
  if (active === "ratatui" || active === "rust" || active === "rt") {
    return hasRt
      ? `✓ ratatui（有二进制） default=${def}`
      : `△ 配置倾向 ratatui 但无二进制 — 用 MAOU_TUI=ink 或 build --full`;
  }
  return `✓ ink（或默认） effective=${active}`;
}

function tryInstall(packages: string[], cwd: string, mono: string | null): { ok: boolean; error?: string } {
  if (packages.length === 0) return { ok: true };
  if (mono) {
    return {
      ok: false,
      error: "monorepo：请用 pnpm install && pnpm -r build / scripts/build-native，勿对单包 npm install",
    };
  }
  const cmd = "npm";
  const which = spawnSync(cmd, ["--version"], { encoding: "utf-8" });
  if (which.status !== 0) return { ok: false, error: "未找到 npm" };
  log(`[maou] 正在安装: ${packages.join(", ")}`);
  const r = spawnSync(cmd, ["install", "--no-save", "--no-fund", "--no-audit", ...packages], {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
  if (r.status !== 0) return { ok: false, error: `npm install 退出 ${r.status}` };
  return { ok: true };
}

export async function ensureDependencies(
  opts: { autoInstall?: boolean; quiet?: boolean } = {},
): Promise<DepCheckResult> {
  const autoInstall =
    opts.autoInstall !== false && process.env.MAOU_NO_AUTO_INSTALL !== "1";
  const quiet = !!opts.quiet;
  const cliRoot = resolveCliPackageRoot();
  const monoRoot = findMonorepoRoot(cliRoot);
  const errors: string[] = [];
  const warnings: string[] = [];
  const repaired: string[] = [];

  const node = checkNodeVersion();
  if (!node.ok) errors.push(`需要 Node.js >= 20，当前 ${node.version}`);

  const missingCritical: string[] = [];
  for (const pkg of CRITICAL_PACKAGES) {
    let ok = await canImport(pkg);
    if (!ok && monoRoot) ok = monorepoPackagePresent(monoRoot, pkg);
    if (!ok) missingCritical.push(pkg);
  }

  const missingOptional: string[] = [];
  for (const pkg of OPTIONAL_PACKAGES) {
    let ok = await canImport(pkg);
    if (!ok && monoRoot) ok = monorepoPackagePresent(monoRoot, pkg);
    if (!ok) missingOptional.push(pkg);
  }

  // monorepo：永不自动 npm install 可选包；核心缺失只提示 build
  if (missingCritical.length > 0 && autoInstall && !monoRoot) {
    if (!quiet) log(`[maou] 缺少核心依赖: ${missingCritical.join(", ")}`);
    const r = tryInstall([...missingCritical], cliRoot, monoRoot);
    if (r.ok) {
      repaired.push(...missingCritical);
      missingCritical.length = 0;
      for (const pkg of CRITICAL_PACKAGES) {
        if (!(await canImport(pkg))) missingCritical.push(pkg);
      }
    } else if (r.error) errors.push(r.error);
  } else if (missingCritical.length > 0 && monoRoot) {
    errors.push(
      `核心包未就绪: ${missingCritical.join(", ")} — 在仓库根: pnpm install && pnpm -r build`,
    );
  }

  if (missingOptional.length > 0 && autoInstall && !monoRoot) {
    const r = tryInstall([...missingOptional], cliRoot, monoRoot);
    if (r.ok) {
      repaired.push(...missingOptional);
      missingOptional.length = 0;
    }
  } else if (missingOptional.length > 0 && monoRoot && !quiet) {
    // 不刷 install 错误；optional 在 monorepo 常因未 link 显示缺失
    warnings.push(`可选包（monorepo 可能仅未 link）: ${missingOptional.join(", ")}`);
  }

  const distOk = existsSync(join(cliRoot, "dist", "index.js"));
  if (!distOk) {
    errors.push("cli/dist/index.js 不存在 — pnpm -r build 或 scripts/build-native");
  }

  const te = detectTerminalEngine(cliRoot, monoRoot);
  const dcg = detectDcg(monoRoot);
  const sqry = detectSqry();
  const gitInfo = detectGit(monoRoot);
  const pnpmInfo = detectPnpm();
  const apiInfo = detectApiConfig();
  const tuiInfo = detectTui(monoRoot);

  const tiers: CapabilityTier = {
    core: node.ok && missingCritical.length === 0 && distOk,
    terminal: te.ok,
    dcg: dcg.ok,
    sqry: sqry.ok,
  };

  return {
    ok: tiers.core,
    nodeOk: node.ok,
    nodeVersion: node.version,
    missingCritical: [...missingCritical],
    missingOptional: [...missingOptional],
    repaired,
    errors,
    warnings,
    cliRoot,
    monoRoot,
    distOk,
    tiers,
    details: {
      terminalEngine: `${te.ok ? "✓" : "△"} ${te.detail}`,
      dcg: `${dcg.ok ? "✓" : "△"} ${dcg.detail}`,
      sqry: `${sqry.ok ? "✓" : "△"} ${sqry.detail}`,
      git: gitInfo,
      pnpm: pnpmInfo,
      apiConfig: apiInfo,
      tui: tuiInfo,
    },
  };
}

export async function assertCoreReady(): Promise<{ ok: boolean; message?: string }> {
  const r = await ensureDependencies({ autoInstall: false, quiet: true });
  if (r.tiers.core) return { ok: true };
  return {
    ok: false,
    message:
      `Core 未就绪。\n` +
      `  Node: ${r.nodeVersion}\n` +
      `  dist: ${r.distOk}\n` +
      `  缺失: ${r.missingCritical.join(", ") || "—"}\n` +
      `  → maou doctor`,
  };
}

export interface DoctorOptions {
  /**
   * 禁止自动 install（仅诊断）。
   * 默认 false：会 **自动修复**（monorepo: pnpm + build-native/ensure-dcg）。
   * `maou doctor --check` / MAOU_DOCTOR_NO_INSTALL=1 → 只检查。
   */
  noInstall?: boolean;
  /** 修复时跳过 terminal-engine 原生构建（更快，只保证 Core + dcg） */
  jsOnly?: boolean;
  /** 修复时编 ratatui */
  full?: boolean;
}

export interface AutoFixResult {
  attempted: boolean;
  coreFixed: boolean;
  terminalFixed: boolean;
  dcgFixed: boolean;
  actions: string[];
  errors: string[];
}

/**
 * 自动修复依赖（monorepo 主路径）：
 *   1. pnpm install + pnpm -r build（Core）
 *   2. node scripts/ensure-dcg.mjs --user（dcg）
 *   3. build-native（Terminal，可 --js-only 跳过）
 */
export async function autoFixDependencies(opts: {
  jsOnly?: boolean;
  full?: boolean;
  quiet?: boolean;
} = {}): Promise<AutoFixResult> {
  const actions: string[] = [];
  const errors: string[] = [];
  const before = await ensureDependencies({ autoInstall: false, quiet: true });
  const mono = before.monoRoot;
  const cliRoot = before.cliRoot;

  if (!before.nodeOk) {
    return {
      attempted: false,
      coreFixed: false,
      terminalFixed: false,
      dcgFixed: false,
      actions,
      errors: ["Node < 20，无法自动修复 — 请先安装 Node.js >= 20"],
    };
  }

  let needCore = !before.tiers.core;
  let needDcg = !before.tiers.dcg;
  let needTerminal = !before.tiers.terminal && !opts.jsOnly;

  // 已全绿
  if (!needCore && !needDcg && !needTerminal) {
    return {
      attempted: false,
      coreFixed: true,
      terminalFixed: before.tiers.terminal,
      dcgFixed: before.tiers.dcg,
      actions: ["无需修复"],
      errors: [],
    };
  }

  if (!opts.quiet) {
    log("");
    log("── 自动修复 ──");
  }

  if (mono) {
    if (!commandOnPath("pnpm")) {
      errors.push("未找到 pnpm — 请先: npm i -g pnpm");
      return {
        attempted: true,
        coreFixed: false,
        terminalFixed: false,
        dcgFixed: false,
        actions,
        errors,
      };
    }

    // Core
    if (needCore) {
      if (!opts.quiet) log("[fix] pnpm install…");
      actions.push("pnpm install");
      if (!runInherit("pnpm", ["install"], mono)) {
        errors.push("pnpm install 失败");
      } else {
        if (!opts.quiet) log("[fix] pnpm -r run build…");
        actions.push("pnpm -r build");
        if (!runInherit("pnpm", ["-r", "run", "build"], mono)) {
          errors.push("pnpm -r build 失败");
        }
      }
    }

    // dcg
    if (needDcg || needCore) {
      const ensure = join(mono, "scripts", "ensure-dcg.mjs");
      if (existsSync(ensure)) {
        if (!opts.quiet) log("[fix] ensure-dcg…");
        actions.push("ensure-dcg");
        const ok =
          runInherit(process.execPath, [ensure, "--user"], mono) ||
          runInherit(process.execPath, [ensure], mono);
        if (!ok) errors.push("ensure-dcg 失败（可稍后手动）");
      }
    }

    // Terminal / 完整 native：Core 已好但缺 engine，或刚修完 Core 且非 jsOnly
    const runNative = needTerminal || (needCore && !opts.jsOnly);
    if (runNative) {
      const isWin = platform() === "win32";
      if (isWin) {
        const ps1 = join(mono, "scripts", "build-native.ps1");
        if (existsSync(ps1)) {
          const args = ["-ExecutionPolicy", "Bypass", "-File", ps1];
          if (opts.jsOnly) args.push("-JsOnly");
          else if (!opts.full) args.push("-SkipRatatui");
          if (!opts.quiet) {
            log(
              `[fix] build-native.ps1${opts.jsOnly ? " -JsOnly" : opts.full ? "" : " -SkipRatatui"}…`,
            );
          }
          actions.push("build-native.ps1");
          if (!runInherit("powershell", args, mono)) {
            if (needTerminal || !needCore) {
              errors.push("build-native 失败 — Terminal 可能仍降级");
            }
          }
        }
      } else {
        const sh = join(mono, "scripts", "build-native.sh");
        if (existsSync(sh)) {
          const args = [sh];
          if (opts.jsOnly) args.push("--js-only");
          else if (!opts.full) args.push("--skip-ratatui");
          if (!opts.quiet) log(`[fix] bash ${args.join(" ")}…`);
          actions.push("build-native.sh");
          if (!runInherit("bash", args, mono)) {
            if (needTerminal || !needCore) {
              errors.push("build-native 失败 — Terminal 可能仍降级");
            }
          }
        }
      }
    }
  } else {
    // 非 monorepo：尽力 npm install 核心包
    if (needCore && before.missingCritical.length) {
      if (!opts.quiet) log("[fix] npm install 核心包…");
      actions.push("npm install critical");
      const r = tryInstall([...before.missingCritical], cliRoot, null);
      if (!r.ok && r.error) errors.push(r.error);
    }
  }

  const after = await ensureDependencies({ autoInstall: false, quiet: true });
  return {
    attempted: true,
    coreFixed: after.tiers.core,
    terminalFixed: after.tiers.terminal,
    dcgFixed: after.tiers.dcg,
    actions,
    errors,
  };
}

function printDoctorReport(r: DepCheckResult): void {
  log(`平台: ${process.platform}/${process.arch}`);
  log(`CLI:  ${r.cliRoot}`);
  if (r.monoRoot) log(`Repo: ${r.monoRoot}`);
  log("");

  log("── Core（必须）──");
  log(`  Node >=20:  ${r.nodeOk ? "✓" : "✗"} ${r.nodeVersion}`);
  log(`  CLI dist:   ${r.distOk ? "✓" : "✗"}`);
  log(
    `  核心包:     ${r.missingCritical.length === 0 ? "✓" : "✗ " + r.missingCritical.join(", ")}`,
  );
  log(`  合计:       ${r.tiers.core ? "✓ 可启动" : "✗ 不可启动"}`);

  log("");
  log("── Terminal（建议）──");
  log(`  engine: ${r.details.terminalEngine}`);
  log(`  dcg:    ${r.details.dcg}`);
  if (!r.tiers.terminal) {
    log("  兜底: child_process 弱 PTY");
  }
  if (!r.tiers.dcg) {
    log("  兜底: 危险命令门不可靠");
  }

  log("");
  log("── Optional ──");
  log(`  sqry:   ${r.details.sqry}`);
  if (r.missingOptional.length) {
    log(`  其它:   △ ${r.missingOptional.join(", ")}`);
  } else {
    log("  其它:   ✓");
  }
  if (!r.tiers.sqry) log("  兜底: find_code 不可用；grep/glob 仍可用");

  log("");
  log("── Install / 环境 ──");
  log(`  git:  ${r.details.git}`);
  log(`  pnpm: ${r.details.pnpm}`);
  log(`  API:  ${r.details.apiConfig}`);
  log(`  TUI:  ${r.details.tui}`);
  try {
    // sync require 避免 async
    const { resolveUserMaouRoot } = require("@little-house-studio/types") as {
      resolveUserMaouRoot: () => string;
    };
    log(`  HOME: ${resolveUserMaouRoot()}`);
  } catch {
    /* ignore */
  }

  if (r.repaired.length) log(`已尝试安装: ${r.repaired.join(", ")}`);
  for (const e of r.errors) log(`⚠ ${e}`);
  for (const w of r.warnings) log(`△ ${w}`);
}

export async function runDoctor(opts: DoctorOptions = {}): Promise<boolean> {
  log("══════════════════════════════════════");
  log("  Maou Doctor · 诊断 + 自动修复");
  log("══════════════════════════════════════");

  const noInstall =
    opts.noInstall === true ||
    process.env.MAOU_NO_AUTO_INSTALL === "1" ||
    process.env.MAOU_DOCTOR_NO_INSTALL === "1";

  // 先诊断（不装）
  let r = await ensureDependencies({ autoInstall: false, quiet: false });
  printDoctorReport(r);

  const needsFix =
    !r.tiers.core || !r.tiers.dcg || (!r.tiers.terminal && !opts.jsOnly);

  if (!noInstall && needsFix && r.nodeOk) {
    const fix = await autoFixDependencies({
      jsOnly: opts.jsOnly,
      full: opts.full,
      quiet: false,
    });
    if (fix.attempted) {
      log("");
      log(`修复动作: ${fix.actions.join(" → ") || "—"}`);
      for (const e of fix.errors) log(`⚠ ${e}`);
      // 再诊断
      r = await ensureDependencies({ autoInstall: false, quiet: true });
      log("");
      log("── 修复后 ──");
      log(
        `  Core: ${r.tiers.core ? "✓" : "✗"}  Terminal: ${r.tiers.terminal ? "✓" : "△"}  dcg: ${r.tiers.dcg ? "✓" : "△"}  sqry: ${r.tiers.sqry ? "✓" : "△"}`,
      );
    }
  } else if (noInstall && needsFix) {
    log("");
    log("（--check：未自动修复。需要修复请运行: maou doctor  或  maou doctor --fix）");
  }

  log("");
  log("── 下一步 ──");
  if (!r.tiers.core) {
    log("  Core 仍失败。检查 Node/pnpm，或手动: scripts/build-native");
  } else if (!r.tiers.terminal || !r.tiers.dcg) {
    log("  可启动 maou coding（部分能力降级）");
    if (r.details.apiConfig.includes("△")) log("  API: maou setup");
  } else {
    log("  就绪 → maou coding");
    if (!r.details.git.includes("非 git")) log("  更新: maou update");
  }

  log("");
  if (r.tiers.core && r.tiers.terminal && r.tiers.dcg) {
    log("✓ Core+Terminal 就绪");
  } else if (r.tiers.core) {
    log("△ Core 就绪，有降级");
  } else {
    log("❌ Core 未就绪");
  }
  log("");
  return r.tiers.core;
}

export async function runPostinstallCheck(): Promise<void> {
  try {
    log("[maou] postinstall: 检查…");
    const r = await ensureDependencies({ autoInstall: false, quiet: false });
    log(r.tiers.core ? "[maou] postinstall: Core 就绪" : "[maou] postinstall: Core 不完整 → maou doctor");
  } catch (e) {
    log(`[maou] postinstall 跳过: ${e}`);
  }
}

export { resolveCliPackageRoot, findMonorepoRoot };
