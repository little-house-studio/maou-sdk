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
import { resolveRatatuiBinary } from "../tui-bridge/resolve-binary.js";

/**
 * 解析可执行文件绝对路径。
 * Windows 上 npm/pnpm/cargo 常是 .cmd / 不在 PATH（cargo 默认 ~/.cargo/bin），
 * 直接 spawnSync("npm") 会 ENOENT。
 */
function resolveExecutable(name: string): string {
  const isWin = platform() === "win32";
  const candidates: string[] = [];
  if (isWin) {
    if (name === "npm" || name === "npx") {
      const base = process.env.ProgramFiles
        ? join(process.env.ProgramFiles, "nodejs")
        : "C:\\Program Files\\nodejs";
      candidates.push(join(base, `${name}.cmd`), join(base, name));
    }
    if (name === "cargo" || name === "rustc") {
      candidates.push(join(homedir(), ".cargo", "bin", `${name}.exe`));
    }
    // PATH 上的 .cmd / .exe
    const where = spawnSync("where", [name], { encoding: "utf-8", windowsHide: true });
    if (where.status === 0 && where.stdout) {
      for (const line of where.stdout.split(/\r?\n/)) {
        const p = line.trim();
        if (p) candidates.push(p);
      }
    }
  } else {
    // cargo 默认 ~/.cargo/bin 不一定在非登录 shell PATH
    if (name === "cargo" || name === "rustc") {
      candidates.push(join(homedir(), ".cargo", "bin", name));
    }
    const which = spawnSync("which", [name], { encoding: "utf-8" });
    if (which.status === 0 && which.stdout?.trim()) {
      candidates.push(which.stdout.trim().split("\n")[0]!);
    }
  }
  for (const p of candidates) {
    if (p && existsSync(p)) return p;
  }
  return name;
}

function runInherit(cmd: string, args: string[], cwd: string): boolean {
  const resolved = resolveExecutable(cmd);
  // Windows .cmd 必须 shell:true，否则 spawn ENOENT
  const needShell = platform() === "win32" && /\.(cmd|bat)$/i.test(resolved);
  const r = spawnSync(resolved, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
    shell: needShell,
  });
  return r.status === 0;
}

/** cargo 是否可用（PATH 或 ~/.cargo/bin） */
function hasCargo(): boolean {
  if (commandOnPath("cargo") || commandOnPath("cargo.exe")) return true;
  const p =
    platform() === "win32"
      ? join(homedir(), ".cargo", "bin", "cargo.exe")
      : join(homedir(), ".cargo", "bin", "cargo");
  return existsSync(p);
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
  nodePty: boolean;
  lspTS: boolean;
  ddgr: boolean;
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
    nodePty: string;
    lspTS: string;
    ddgr: string;
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

function detectSqry(mono: string | null = null): { ok: boolean; detail: string } {
  const names = platform() === "win32" ? ["sqry.exe", "sqry"] : ["sqry"];
  const dirs = [
    mono ? join(mono, "vendor", "bin") : "",
    join(homedir(), ".cargo", "bin"),
    join(homedir(), ".maou", "bin"),
    join(homedir(), ".local", "bin"),
  ].filter(Boolean) as string[];
  for (const n of names) {
    for (const d of dirs) {
      const p = join(d, n);
      if (existsSync(p)) return { ok: true, detail: p };
    }
  }
  if (commandOnPath("sqry") || commandOnPath("sqry.exe")) {
    return { ok: true, detail: "on PATH" };
  }
  return { ok: false, detail: "未安装（find_code 不可用）— node scripts/ensure-sqry.mjs" };
}

/** 尝试 require("node-pty")，验证原生模块加载成功（不只是包是否 resolve） */
function detectNodePty(): { ok: boolean; detail: string } {
  try {
    const mod = require("node-pty") ?? require("@lydell/node-pty");
    if (mod && typeof mod.spawn === "function") return { ok: true, detail: "已加载" };
    return { ok: false, detail: "包存在但 spawn 不可用" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Windows 典型：DLL 缺失 / STATUS_DLL_NOT_FOUND
    return { ok: false, detail: `加载失败：${msg.split("\n")[0]}` };
  }
}

/** 检测 typescript-language-server（TS/JS LSP）—— maou-sdk 主语言 */
function detectLspTS(): { ok: boolean; detail: string } {
  const name = platform() === "win32" ? "typescript-language-server.cmd" : "typescript-language-server";
  if (commandOnPath("typescript-language-server") || commandOnPath(name)) {
    return { ok: true, detail: "on PATH" };
  }
  return { ok: false, detail: "未安装 — npm i -g typescript-language-server typescript" };
}

/** 检测 ddgr（可选搜索 CLI，未安装时 search_internet 走 HTTP fallback） */
function detectDdgr(): { ok: boolean; detail: string } {
  if (commandOnPath("ddgr") || commandOnPath("ddgr.exe")) {
    return { ok: true, detail: "on PATH" };
  }
  return { ok: false, detail: "未安装（搜索走 HTTP fallback）" };
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

function detectTui(_mono: string | null): string {
  const forced = process.env.MAOU_TUI || "";
  const def = "ratatui";
  const active = forced || def;
  // 与 launch 同源探测（含 ~/.maou/bin、target/release、PATH；Windows 认 .exe）
  const binPath = resolveRatatuiBinary() ?? "";
  const hasRt = !!binPath;
  if (active === "ratatui" || active === "rust" || active === "rt") {
    return hasRt
      ? `✓ ratatui（${binPath}） default=${def}`
      : `△ 配置倾向 ratatui 但无二进制 — npm run build:tui-ratatui 或 maou doctor`;
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
  const sqry = detectSqry(monoRoot);
  const nodePty = detectNodePty();
  const lspTS = detectLspTS();
  const ddgr = detectDdgr();
  const gitInfo = detectGit(monoRoot);
  const pnpmInfo = detectPnpm();
  const apiInfo = detectApiConfig();
  const tuiInfo = detectTui(monoRoot);

  const tiers: CapabilityTier = {
    core: node.ok && missingCritical.length === 0 && distOk,
    terminal: te.ok,
    dcg: dcg.ok,
    sqry: sqry.ok,
    nodePty: nodePty.ok,
    lspTS: lspTS.ok,
    ddgr: ddgr.ok,
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
      nodePty: `${nodePty.ok ? "✓" : "△"} ${nodePty.detail}`,
      lspTS: `${lspTS.ok ? "✓" : "△"} ${lspTS.detail}`,
      ddgr: `${ddgr.ok ? "✓" : "△"} ${ddgr.detail}`,
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
}

export interface AutoFixResult {
  attempted: boolean;
  coreFixed: boolean;
  terminalFixed: boolean;
  dcgFixed: boolean;
  sqryFixed: boolean;
  lspTSFixed: boolean;
  nodePtyFixed: boolean;
  actions: string[];
  errors: string[];
}

/**
 * 自动修复依赖（monorepo 主路径）：
 *   1. pnpm install + pnpm -r build（Core）
 *   2. node scripts/ensure-dcg.mjs --user（dcg）
 *   3. build-native（Terminal + Ratatui）
 */
export async function autoFixDependencies(opts: {
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
      sqryFixed: false,
      lspTSFixed: false,
      nodePtyFixed: false,
      actions,
      errors: ["Node < 20，无法自动修复 — 请先安装 Node.js >= 20"],
    };
  }

  let needCore = !before.tiers.core;
  let needDcg = !before.tiers.dcg;
  let needTerminal = !before.tiers.terminal;
  let needSqry = !before.tiers.sqry;
  let needLspTS = !before.tiers.lspTS;
  let needNodePty = !before.tiers.nodePty;

  // 已全绿
  if (!needCore && !needDcg && !needTerminal && !needSqry && !needLspTS && !needNodePty) {
    return {
      attempted: false,
      coreFixed: true,
      terminalFixed: before.tiers.terminal,
      dcgFixed: before.tiers.dcg,
      sqryFixed: before.tiers.sqry,
      lspTSFixed: before.tiers.lspTS,
      nodePtyFixed: before.tiers.nodePty,
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
        sqryFixed: before.tiers.sqry,
        lspTSFixed: before.tiers.lspTS,
        nodePtyFixed: before.tiers.nodePty,
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

    // Terminal / 完整 native：Core 已好但缺 engine，或刚修完 Core，或 node-pty 加载失败
    const runNative = needTerminal || needCore || needNodePty;
    if (runNative) {
      const isWin = platform() === "win32";
      if (isWin) {
        const ps1 = join(mono, "scripts", "build-native.ps1");
        if (existsSync(ps1)) {
          const args = ["-ExecutionPolicy", "Bypass", "-File", ps1];
          if (!opts.quiet) log(`[fix] build-native.ps1…`);
          actions.push("build-native.ps1");
          if (!runInherit("powershell", args, mono)) {
            if (needTerminal || needNodePty || !needCore) {
              errors.push("build-native 失败 — Terminal/node-pty 可能仍降级");
            }
          }
        }
      } else {
        const sh = join(mono, "scripts", "build-native.sh");
        if (existsSync(sh)) {
          const args = [sh];
          if (!opts.quiet) log(`[fix] bash ${args.join(" ")}…`);
          actions.push("build-native.sh");
          if (!runInherit("bash", args, mono)) {
            if (needTerminal || needNodePty || !needCore) {
              errors.push("build-native 失败 — Terminal/node-pty 可能仍降级");
            }
          }
        }
      }
    }

    // sqry —— 预编译二进制（ensure-sqry.mjs）；cargo install 在 Windows 上常因 C 编译器失败
    if (needSqry) {
      const ensure = join(mono, "scripts", "ensure-sqry.mjs");
      if (existsSync(ensure)) {
        if (!opts.quiet) log("[fix] ensure-sqry…");
        actions.push("ensure-sqry");
        const ok =
          runInherit(process.execPath, [ensure, "--user"], mono) ||
          runInherit(process.execPath, [ensure], mono);
        if (!ok) {
          // 回退：cargo install sqry-cli（需要较新 rustc，且 Windows 可能失败）
          if (hasCargo()) {
            if (!opts.quiet) log("[fix] ensure-sqry 失败，回退 cargo install sqry-cli…");
            actions.push("cargo install sqry-cli");
            const cargoBin = join(homedir(), ".cargo", "bin");
            const prevPath = process.env.PATH ?? process.env.Path ?? "";
            process.env.PATH = `${cargoBin}${platform() === "win32" ? ";" : ":"}${prevPath}`;
            const cargoOk = runInherit("cargo", ["install", "sqry-cli"], mono);
            process.env.PATH = prevPath;
            if (!cargoOk) errors.push("sqry 安装失败 — find_code 将不可用（可手动: node scripts/ensure-sqry.mjs）");
          } else {
            errors.push("ensure-sqry 失败且无 cargo — find_code 将不可用");
          }
        }
      } else if (hasCargo()) {
        if (!opts.quiet) log("[fix] cargo install sqry-cli…");
        actions.push("cargo install sqry-cli");
        const cargoBin = join(homedir(), ".cargo", "bin");
        const prevPath = process.env.PATH ?? process.env.Path ?? "";
        process.env.PATH = `${cargoBin}${platform() === "win32" ? ";" : ":"}${prevPath}`;
        const ok = runInherit("cargo", ["install", "sqry-cli"], mono);
        process.env.PATH = prevPath;
        if (!ok) errors.push("cargo install sqry-cli 失败 — find_code 将不可用");
      } else {
        errors.push("sqry 未安装且无 ensure-sqry.mjs / cargo");
      }
    }

    // typescript-language-server —— npm i -g（Windows 走 .cmd + shell）
    if (needLspTS) {
      if (commandOnPath("npm") || commandOnPath("npm.cmd") || existsSync(resolveExecutable("npm"))) {
        if (!opts.quiet) log("[fix] npm i -g typescript-language-server typescript…");
        actions.push("npm i -g typescript-language-server typescript");
        if (!runInherit("npm", ["install", "-g", "typescript-language-server", "typescript"], mono)) {
          errors.push("npm i -g typescript-language-server 失败 — LSP 诊断将不可用");
        }
      } else {
        errors.push("typescript-language-server 未安装且无 npm");
      }
    }

    // ddgr —— 跨平台安装方式不一（brew/apt/pip），不自动装，仅告警
    if (!before.tiers.ddgr) {
      if (!opts.quiet) log("△ ddgr 未安装 — search_internet 走 HTTP fallback；如需更好结果: brew install ddgr / pip install ddgr");
    }
  } else {
    // 非 monorepo：尽力 npm install 核心包
    if (needCore && before.missingCritical.length) {
      if (!opts.quiet) log("[fix] npm install 核心包…");
      actions.push("npm install critical");
      const r = tryInstall([...before.missingCritical], cliRoot, null);
      if (!r.ok && r.error) errors.push(r.error);
    }
    // 非 monorepo 下也尝试装 ts-ls（全局）
    if (needLspTS && (commandOnPath("npm") || commandOnPath("npm.cmd") || existsSync(resolveExecutable("npm")))) {
      if (!opts.quiet) log("[fix] npm i -g typescript-language-server typescript…");
      actions.push("npm i -g typescript-language-server typescript");
      if (!runInherit("npm", ["install", "-g", "typescript-language-server", "typescript"], cliRoot)) {
        errors.push("npm i -g typescript-language-server 失败");
      }
    }
    if (needSqry) {
      // 非 monorepo：尝试从 npm 包旁 scripts 或用户自备 ensure；否则 cargo
      if (hasCargo()) {
        if (!opts.quiet) log("[fix] cargo install sqry-cli…");
        actions.push("cargo install sqry-cli");
        const cargoBin = join(homedir(), ".cargo", "bin");
        const prevPath = process.env.PATH ?? process.env.Path ?? "";
        process.env.PATH = `${cargoBin}${platform() === "win32" ? ";" : ":"}${prevPath}`;
        const ok = runInherit("cargo", ["install", "sqry-cli"], cliRoot);
        process.env.PATH = prevPath;
        if (!ok) errors.push("cargo install sqry-cli 失败");
      } else {
        errors.push("sqry 未安装 — 请运行: cargo install sqry-cli 或下载 https://github.com/verivus-oss/sqry/releases");
      }
    }
  }

  const after = await ensureDependencies({ autoInstall: false, quiet: true });
  return {
    attempted: true,
    coreFixed: after.tiers.core,
    terminalFixed: after.tiers.terminal,
    dcgFixed: after.tiers.dcg,
    sqryFixed: after.tiers.sqry,
    lspTSFixed: after.tiers.lspTS,
    nodePtyFixed: after.tiers.nodePty,
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
  log(`  engine:   ${r.details.terminalEngine}`);
  log(`  dcg:      ${r.details.dcg}`);
  log(`  node-pty: ${r.details.nodePty}`);
  if (!r.tiers.terminal) {
    log("  兜底: child_process 弱 PTY");
  }
  if (!r.tiers.nodePty) {
    log("  兜底: node-pty 加载失败 → use_terminal 退化为无 PTY spawn（Windows 易 DLL 缺失）");
  }
  if (!r.tiers.dcg) {
    log("  兜底: 危险命令门不可靠");
  }

  log("");
  log("── Optional ──");
  log(`  sqry:             ${r.details.sqry}`);
  log(`  typescript-ls:    ${r.details.lspTS}`);
  log(`  ddgr:             ${r.details.ddgr}`);
  if (r.missingOptional.length) {
    log(`  其它:             △ ${r.missingOptional.join(", ")}`);
  } else {
    log("  其它:             ✓");
  }
  if (!r.tiers.sqry) log("  兜底: find_code 不可用；grep/glob 仍可用");
  if (!r.tiers.lspTS) log("  兜底: LSP 诊断/跳转不可用（TS/JS）");
  if (!r.tiers.ddgr) log("  兜底: search_internet 走 HTTP fallback");

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
    !r.tiers.core || !r.tiers.dcg || !r.tiers.terminal ||
    !r.tiers.nodePty || !r.tiers.sqry || !r.tiers.lspTS;

  if (!noInstall && needsFix && r.nodeOk) {
    const fix = await autoFixDependencies({
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
        `  Core: ${r.tiers.core ? "✓" : "✗"}  Terminal: ${r.tiers.terminal ? "✓" : "△"}  dcg: ${r.tiers.dcg ? "✓" : "△"}  node-pty: ${r.tiers.nodePty ? "✓" : "△"}  sqry: ${r.tiers.sqry ? "✓" : "△"}  ts-ls: ${r.tiers.lspTS ? "✓" : "△"}`,
      );
    }
  } else if (noInstall && needsFix) {
    log("");
    log("（--check：未自动修复。需要修复请运行: maou doctor  或  maou doctor --fix）");
  }

  // Ratatui 二进制（产品默认 TUI；无则尝试 cargo build → ~/.maou/bin）
  if (!noInstall) {
    try {
      const { resolveRatatuiBinary, ensureRatatuiBinary } = await import(
        "../tui-bridge/resolve-binary.js"
      );
      if (!resolveRatatuiBinary()) {
        log("");
        log("── Ratatui TUI 二进制 ──");
        const bin = ensureRatatuiBinary({
          tryBuild: true,
          log: (m) => log(m),
        });
        if (bin) log(`  ✓ ${bin}`);
        else {
          log("  △ 未安装 — 手动: cd maou-sdk/cli && npm run build:tui-ratatui");
          log("  （无二进制时 maou coding 无法启动）");
        }
      }
    } catch (e) {
      log(
        `  △ TUI 二进制检查跳过: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  log("");
  log("── 下一步 ──");
  if (!r.tiers.core) {
    log("  Core 仍失败。检查 Node/pnpm，或手动: scripts/build-native");
  } else if (!r.tiers.terminal || !r.tiers.dcg || !r.tiers.nodePty) {
    log("  可启动 maou coding（部分能力降级）");
    if (!r.tiers.nodePty) log("  node-pty: 检查 Visual Studio Build Tools / Windows SDK");
    if (r.details.apiConfig.includes("△")) log("  API: maou setup");
  } else if (!r.tiers.sqry || !r.tiers.lspTS) {
    log("  可启动 maou coding（部分 Optional 降级）");
    if (!r.tiers.sqry) log("  sqry: maou doctor（ensure-sqry / cargo install sqry-cli）");
    if (!r.tiers.lspTS) log("  ts-ls: maou doctor（npm i -g typescript-language-server typescript）");
  } else {
    log("  就绪 → maou coding（默认 Ratatui）");
    if (!r.details.git.includes("非 git")) log("  更新: maou update");
  }

  log("");
  if (r.tiers.core && r.tiers.terminal && r.tiers.dcg && r.tiers.nodePty) {
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
