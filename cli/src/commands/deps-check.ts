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
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { platform, homedir } from "node:os";
import { findMonorepoRoot, findSdkGitRoot, resolveCliPackageRoot } from "./repo-root.js";
import {
  detectRuntime,
  runtimeVersionLabel,
  type InstallMode,
  type RuntimeInfo,
} from "./runtime-mode.js";
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
  rg: boolean;
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
  /** 安装形态：bundle（免构建预编译）/ monorepo（源码）/ standalone */
  mode: InstallMode;
  /** bundle 根，仅 mode==="bundle" 时非空 */
  bundleRoot: string | null;
  distOk: boolean;
  tiers: CapabilityTier;
  details: {
    terminalEngine: string;
    dcg: string;
    rg: string;
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

/**
 * 修复提示。预编译包用户不该被告知去跑仓库脚本 —— 他们没有仓库，
 * `maou doctor` 会用包内自带的同名脚本下载。
 */
function fixHint(rt: RuntimeInfo, script: string): string {
  return rt.mode === "bundle" ? "maou doctor（自动下载）" : `node scripts/${script}`;
}

function installModeLabel(mode: InstallMode): string {
  if (mode === "bundle") return "预编译包（免构建）";
  if (mode === "monorepo") return "源码仓库（开发者）";
  return "独立安装";
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
    "@little-house-studio/coding-agent": "agent-products/coding-agent",
    "@little-house-studio/ops-agent": "agent-products/ops-agent",
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

/**
 * terminal-engine 判定以「本平台 .node 真实存在」为准，而不是包能否 resolve。
 * bundle 里引擎在 node_modules/@little-house-studio/terminal-engine 下。
 */
function detectTerminalEngine(rt: RuntimeInfo): { ok: boolean; detail: string } {
  const dirs: string[] = [];
  if (rt.bundleRoot) {
    dirs.push(join(rt.bundleRoot, "node_modules", "@little-house-studio", "terminal-engine"));
  }
  if (rt.monoRoot) dirs.push(join(rt.monoRoot, "terminal-engine"));
  try {
    dirs.push(dirname(require.resolve("@little-house-studio/terminal-engine/package.json")));
  } catch {
    /* 包不可解析时靠上面两条 */
  }

  let sawPackage = false;
  for (const d of dirs) {
    if (!existsSync(join(d, "package.json"))) continue;
    sawPackage = true;
    try {
      const nodes = readdirSync(d).filter((f) => f.endsWith(".node"));
      if (nodes.length) return { ok: true, detail: nodes.join(", ") };
    } catch {
      /* 下一个候选 */
    }
  }
  if (sawPackage) {
    return {
      ok: false,
      detail:
        rt.mode === "bundle"
          ? "无 .node — maou doctor（下载预编译）"
          : "源码在但无 .node — scripts/build-native",
    };
  }
  return { ok: false, detail: "未构建 / 未安装" };
}

function detectDcg(rt: RuntimeInfo): { ok: boolean; detail: string } {
  const name = platform() === "win32" ? "dcg.exe" : "dcg";
  const candidates = [
    process.env.MAOU_DCG_PATH,
    process.env.DCG_PATH,
    rt.vendorBinDir ? join(rt.vendorBinDir, name) : "",
    join(homedir(), ".maou", "bin", name),
    join(homedir(), ".local", "bin", name),
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    if (existsSync(p)) return { ok: true, detail: p };
  }
  if (commandOnPath("dcg") || commandOnPath("dcg.exe")) {
    return { ok: true, detail: "on PATH" };
  }
  return { ok: false, detail: `缺失 — ${fixHint(rt, "ensure-dcg.mjs --user")}` };
}

function detectRg(rt: RuntimeInfo): { ok: boolean; detail: string } {
  const names = platform() === "win32" ? ["rg.exe", "rg"] : ["rg"];
  const dirs = [
    rt.vendorBinDir ?? "",
    join(homedir(), ".maou", "bin"),
    join(homedir(), ".local", "bin"),
  ].filter(Boolean) as string[];
  for (const n of names) {
    for (const d of dirs) {
      const p = join(d, n);
      if (existsSync(p)) return { ok: true, detail: p };
    }
  }
  if (commandOnPath("rg") || commandOnPath("rg.exe")) {
    return { ok: true, detail: "on PATH" };
  }
  return { ok: false, detail: `未安装（grep 降级为 Node.js）— ${fixHint(rt, "ensure-rg.mjs")}` };
}

function detectSqry(rt: RuntimeInfo): { ok: boolean; detail: string } {
  const names = platform() === "win32" ? ["sqry.exe", "sqry"] : ["sqry"];
  const dirs = [
    rt.vendorBinDir ?? "",
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
  return { ok: false, detail: `未安装（find_code 不可用）— ${fixHint(rt, "ensure-sqry.mjs")}` };
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
/** Python >= 3.6（ddgr 是 Python 脚本，没有解释器就是装了也跑不动） */
function detectPython(): { ok: boolean; detail: string } {
  const names = platform() === "win32" ? ["python", "py", "python3"] : ["python3", "python"];
  for (const n of names) {
    const r = spawnSync(n, ["-c", "import sys; print(sys.version_info[0], sys.version_info[1])"], {
      encoding: "utf-8",
      timeout: 8000,
      windowsHide: true,
    });
    if (r.status === 0 && r.stdout) {
      const [maj, min] = r.stdout.trim().split(/\s+/).map(Number);
      if (maj! > 3 || (maj === 3 && min! >= 6)) {
        return { ok: true, detail: `${n} ${maj}.${min}` };
      }
    }
  }
  return { ok: false, detail: "未找到 Python >= 3.6" };
}

function detectDdgr(rt: RuntimeInfo): { ok: boolean; detail: string } {
  const isWin = platform() === "win32";
  const names = isWin ? ["ddgr.cmd", "ddgr.exe", "ddgr"] : ["ddgr"];
  const dirs = [
    rt.vendorBinDir ?? "",
    rt.bundleRoot ? join(rt.bundleRoot, "vendor", "bin") : "",
    rt.monoRoot ? join(rt.monoRoot, "vendor", "bin") : "",
    join(homedir(), ".maou", "bin"),
    join(homedir(), ".local", "bin"),
  ].filter(Boolean) as string[];

  let found = "";
  for (const d of dirs) {
    for (const n of names) {
      const p = join(d, n);
      if (existsSync(p)) {
        found = p;
        break;
      }
    }
    if (found) break;
  }
  if (!found && (commandOnPath("ddgr") || commandOnPath("ddgr.cmd") || commandOnPath("ddgr.exe"))) {
    found = "on PATH";
  }
  if (!found) return { ok: false, detail: "未安装（搜索走 HTTP fallback）" };

  // 装了但没 Python：必须报不可用，否则 doctor 说 ✓ 而实际调用直接失败
  const py = detectPython();
  if (!py.ok) {
    return { ok: false, detail: `已下载但缺 Python >= 3.6（${found}）—— 装 Python 后即可用` };
  }
  return { ok: true, detail: `${found}（${py.detail}）` };
}

function detectGit(rt: RuntimeInfo): string {
  if (rt.mode === "bundle") {
    const rel = rt.release;
    const tag = rel?.releaseTag ?? "?";
    const short = rel?.commit ? rel.commit.slice(0, 7) : "?";
    return `— 预编译包安装（${rel?.channel ?? "?"} ${tag} @${short}）；更新: maou update`;
  }
  if (!commandOnPath("git")) return "✗ git 不在 PATH";
  const root = findSdkGitRoot(rt.monoRoot ?? undefined);
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

function detectTui(rt: RuntimeInfo): string {
  const forced = process.env.MAOU_TUI || "";
  const def = "ratatui";
  const active = forced || def;
  // 与 launch 同源探测（含 bundle vendor/bin、~/.maou/bin、target/release、PATH）
  const binPath = resolveRatatuiBinary() ?? "";
  const hasRt = !!binPath;
  if (active === "ratatui" || active === "rust" || active === "rt") {
    if (hasRt) return `✓ ratatui（${binPath}） default=${def}`;
    return rt.mode === "bundle"
      ? "△ 预编译包内缺 TUI 二进制 — maou doctor（重新下载）"
      : "△ 配置倾向 ratatui 但无二进制 — npm run build:tui-ratatui 或 maou doctor";
  }
  return `✓ ink（或默认） effective=${active}`;
}

function tryInstall(
  packages: string[],
  cwd: string,
  mode: InstallMode,
): { ok: boolean; error?: string } {
  if (packages.length === 0) return { ok: true };
  if (mode === "monorepo") {
    return {
      ok: false,
      error: "monorepo：请用 pnpm install && pnpm -r build / scripts/build-native，勿对单包 npm install",
    };
  }
  if (mode === "bundle") {
    // 预编译包自带完整 node_modules；缺包只可能是解压不全 → 重装，不要 npm install
    return {
      ok: false,
      error: "预编译包内依赖不完整（解压可能损坏）— 请重新安装: maou update --force 或重跑安装脚本",
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
  const rt = detectRuntime({ refresh: true });
  const cliRoot = rt.cliRoot;
  const monoRoot = rt.monoRoot;
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

  // monorepo / bundle：都不允许对单包 npm install（前者要构建，后者自带依赖）
  const canNpmInstall = rt.mode === "standalone";
  if (missingCritical.length > 0 && autoInstall && canNpmInstall) {
    if (!quiet) log(`[maou] 缺少核心依赖: ${missingCritical.join(", ")}`);
    const r = tryInstall([...missingCritical], cliRoot, rt.mode);
    if (r.ok) {
      repaired.push(...missingCritical);
      missingCritical.length = 0;
      for (const pkg of CRITICAL_PACKAGES) {
        if (!(await canImport(pkg))) missingCritical.push(pkg);
      }
    } else if (r.error) errors.push(r.error);
  } else if (missingCritical.length > 0) {
    errors.push(
      rt.mode === "bundle"
        ? `核心包缺失: ${missingCritical.join(", ")} — 预编译包不完整，请重装（见 maou update）`
        : `核心包未就绪: ${missingCritical.join(", ")} — 在仓库根: pnpm install && pnpm -r build`,
    );
  }

  if (missingOptional.length > 0 && autoInstall && canNpmInstall) {
    const r = tryInstall([...missingOptional], cliRoot, rt.mode);
    if (r.ok) {
      repaired.push(...missingOptional);
      missingOptional.length = 0;
    }
  } else if (missingOptional.length > 0 && rt.mode !== "standalone" && !quiet) {
    // 不刷 install 错误；optional 在 monorepo 常因未 link 显示缺失
    warnings.push(`可选包（monorepo 可能仅未 link）: ${missingOptional.join(", ")}`);
  }

  const distOk = existsSync(join(cliRoot, "dist", "index.js"));
  if (!distOk) {
    errors.push(
      rt.mode === "bundle"
        ? "dist/index.js 不存在 — 预编译包损坏，请重装"
        : "cli/dist/index.js 不存在 — pnpm -r build 或 scripts/build-native",
    );
  }

  const te = detectTerminalEngine(rt);
  const dcg = detectDcg(rt);
  const rg = detectRg(rt);
  const sqry = detectSqry(rt);
  const nodePty = detectNodePty();
  const lspTS = detectLspTS();
  const ddgr = detectDdgr(rt);
  const gitInfo = detectGit(rt);
  const pnpmInfo = rt.mode === "bundle" ? "— 预编译包无需 pnpm" : detectPnpm();
  const apiInfo = detectApiConfig();
  const tuiInfo = detectTui(rt);

  const tiers: CapabilityTier = {
    core: node.ok && missingCritical.length === 0 && distOk,
    terminal: te.ok,
    dcg: dcg.ok,
    rg: rg.ok,
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
    mode: rt.mode,
    bundleRoot: rt.bundleRoot,
    cliRoot,
    monoRoot,
    distOk,
    tiers,
    details: {
      terminalEngine: `${te.ok ? "✓" : "△"} ${te.detail}`,
      dcg: `${dcg.ok ? "✓" : "△"} ${dcg.detail}`,
      rg: `${rg.ok ? "✓" : "△"} ${rg.detail}`,
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
   * 默认 false：会 **自动修复**（monorepo: pnpm + build-native/ensure-dcg/rg/sqry）。
   * `maou doctor --check` / MAOU_DOCTOR_NO_INSTALL=1 → 只检查。
   */
  noInstall?: boolean;
}

export interface AutoFixResult {
  attempted: boolean;
  coreFixed: boolean;
  terminalFixed: boolean;
  dcgFixed: boolean;
  rgFixed: boolean;
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
 *   3. node scripts/ensure-rg.mjs --user（rg / ripgrep）
 *   4. build-native（Terminal + Ratatui）
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
      rgFixed: false,
      sqryFixed: false,
      lspTSFixed: false,
      nodePtyFixed: false,
      actions,
      errors: ["Node < 20，无法自动修复 — 请先安装 Node.js >= 20"],
    };
  }

  let needCore = !before.tiers.core;
  let needDcg = !before.tiers.dcg;
  let needRg = !before.tiers.rg;
  let needTerminal = !before.tiers.terminal;
  let needSqry = !before.tiers.sqry;
  let needLspTS = !before.tiers.lspTS;
  let needNodePty = !before.tiers.nodePty;

  // 已全绿
  if (!needCore && !needDcg && !needRg && !needTerminal && !needSqry && !needLspTS && !needNodePty) {
    return {
      attempted: false,
      coreFixed: true,
      terminalFixed: before.tiers.terminal,
      dcgFixed: before.tiers.dcg,
      rgFixed: before.tiers.rg,
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

  const rt = detectRuntime();

  if (rt.mode === "bundle" && rt.bundleRoot) {
    // 预编译包：只允许「下载缺失的二进制」，绝不构建（包内没有源码）
    const root = rt.bundleRoot;
    const scripts = rt.scriptsDir;
    const vendorBin = rt.vendorBinDir ?? join(root, "vendor", "bin");
    const exe = platform() === "win32" ? ".exe" : "";

    const runEnsure = (
      file: string,
      label: string,
      env: Record<string, string>,
    ): boolean => {
      if (!scripts) return false;
      const p = join(scripts, file);
      if (!existsSync(p)) {
        errors.push(`预编译包内缺 ${file} — 请重装`);
        return false;
      }
      if (!opts.quiet) log(`[fix] ${label}…`);
      actions.push(label);
      const prev: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(env)) {
        prev[k] = process.env[k];
        process.env[k] = v;
      }
      const ok = runInherit(process.execPath, [p, "--force"], root);
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      return ok;
    };

    if (needCore) {
      errors.push(
        "预编译包 Core 不完整（dist/node_modules 缺失）— 解压可能损坏，请重跑安装脚本或 maou update --force",
      );
    }
    if (needTerminal) {
      if (!runEnsure("ensure-terminal-engine.mjs", "ensure-terminal-engine", {})) {
        errors.push("terminal-engine 下载失败 — use_terminal 将降级");
      }
    }
    if (needDcg) {
      if (!runEnsure("ensure-dcg.mjs", "ensure-dcg", { MAOU_DCG_DEST: join(vendorBin, `dcg${exe}`) })) {
        errors.push("dcg 下载失败 — 危险命令门降级");
      }
    }
    if (needRg) {
      if (!runEnsure("ensure-rg.mjs", "ensure-rg", { MAOU_RG_DEST: join(vendorBin, `rg${exe}`) })) {
        errors.push("rg 下载失败 — grep 降级为 Node.js");
      }
    }
    if (needSqry) {
      if (!runEnsure("ensure-sqry.mjs", "ensure-sqry", { MAOU_SQRY_DEST: join(vendorBin, `sqry${exe}`) })) {
        errors.push("sqry 下载失败 — find_code 不可用");
      }
    }
    if (!resolveRatatuiBinary()) {
      if (!runEnsure("ensure-maou-tui.mjs", "ensure-maou-tui", { MAOU_TUI_DEST: vendorBin })) {
        errors.push("maou-tui-ratatui 下载失败 — TUI 不可用");
      }
    }
    // ts-ls 是全局 npm 包，与包形态无关
    if (needLspTS && (commandOnPath("npm") || commandOnPath("npm.cmd"))) {
      if (!opts.quiet) log("[fix] npm i -g typescript-language-server typescript…");
      actions.push("npm i -g typescript-language-server typescript");
      if (!runInherit("npm", ["install", "-g", "typescript-language-server", "typescript"], root)) {
        errors.push("npm i -g typescript-language-server 失败 — LSP 诊断将不可用");
      }
    }
    if (!before.tiers.ddgr) {
      // ddgr 是 Python 脚本，Windows 上也**不带** .exe（旁边另有 ddgr.cmd shim）
      if (!runEnsure("ensure-ddgr.mjs", "ensure-ddgr", {
        MAOU_DDGR_DEST: join(vendorBin, "ddgr"),
      })) {
        errors.push("ddgr 安装失败 — search_internet 走 HTTP fallback");
      }
    }

    const afterBundle = await ensureDependencies({ autoInstall: false, quiet: true });
    return {
      attempted: true,
      coreFixed: afterBundle.tiers.core,
      terminalFixed: afterBundle.tiers.terminal,
      dcgFixed: afterBundle.tiers.dcg,
      rgFixed: afterBundle.tiers.rg,
      sqryFixed: afterBundle.tiers.sqry,
      lspTSFixed: afterBundle.tiers.lspTS,
      nodePtyFixed: afterBundle.tiers.nodePty,
      actions,
      errors,
    };
  }

  if (mono) {
    if (!commandOnPath("pnpm")) {
      errors.push("未找到 pnpm — 请先: npm i -g pnpm");
      return {
        attempted: true,
        coreFixed: false,
        terminalFixed: false,
        dcgFixed: false,
        rgFixed: false,
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

    // rg (ripgrep)
    if (needRg || needCore) {
      const ensure = join(mono, "scripts", "ensure-rg.mjs");
      if (existsSync(ensure)) {
        if (!opts.quiet) log("[fix] ensure-rg…");
        actions.push("ensure-rg");
        const ok =
          runInherit(process.execPath, [ensure, "--user"], mono) ||
          runInherit(process.execPath, [ensure], mono);
        if (!ok) errors.push("ensure-rg 失败（grep 将降级为 Node.js）");
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
              errors.push("build-native 失败 — terminal-engine 可能仍不可用");
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
              errors.push("build-native 失败 — terminal-engine 可能仍不可用");
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

    // ddgr —— 单文件 Python 脚本，直接抓 raw（不再依赖 brew/apt/pip）
    if (!before.tiers.ddgr) {
      const ensure = join(mono, "scripts", "ensure-ddgr.mjs");
      if (existsSync(ensure)) {
        if (!opts.quiet) log("[fix] ensure-ddgr…");
        actions.push("ensure-ddgr");
        if (!runInherit(process.execPath, [ensure], mono)) {
          errors.push("ddgr 安装失败 — search_internet 走 HTTP fallback");
        }
      }
    }
  } else {
    // 非 monorepo：尽力 npm install 核心包
    if (needCore && before.missingCritical.length) {
      if (!opts.quiet) log("[fix] npm install 核心包…");
      actions.push("npm install critical");
      const r = tryInstall([...before.missingCritical], cliRoot, "standalone");
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
    rgFixed: after.tiers.rg,
    sqryFixed: after.tiers.sqry,
    lspTSFixed: after.tiers.lspTS,
    nodePtyFixed: after.tiers.nodePty,
    actions,
    errors,
  };
}

function printDoctorReport(r: DepCheckResult): void {
  log(`平台: ${process.platform}/${process.arch}`);
  log(`形态: ${installModeLabel(r.mode)}`);
  log(`CLI:  ${r.cliRoot}`);
  if (r.monoRoot) log(`Repo: ${r.monoRoot}`);
  if (r.mode === "bundle") log(`版本: ${runtimeVersionLabel()}`);
  log("");

  log("── Core（必须）──");
  log(`  Node >=20:  ${r.nodeOk ? "✓" : "✗"} ${r.nodeVersion}`);
  log(`  CLI dist:   ${r.distOk ? "✓" : "✗"}`);
  log(
    `  核心包:     ${r.missingCritical.length === 0 ? "✓" : "✗ " + r.missingCritical.join(", ")}`,
  );
  log(`  合计:       ${r.tiers.core ? "✓ 可启动" : "✗ 不可启动"}`);

  log("");
  log("── Terminal / Coding 依赖（建议必选）──");
  log(`  engine:   ${r.details.terminalEngine}`);
  log(`  dcg:      ${r.details.dcg}`);
  log(`  rg:       ${r.details.rg}`);
  log(`  sqry:     ${r.details.sqry}（find_code 必选）`);
  log(`  node-pty: ${r.details.nodePty}（遗留，use_terminal 已不依赖）`);
  if (!r.tiers.terminal) {
    log("  兜底: 无 terminal-engine 时 use_terminal 不可用 — scripts/build-native");
  } else {
    log("  说明: use_terminal 默认全平台管道（Rust engine）；MAOU_PTY_FORCE=1 才开真 PTY");
  }
  if (!r.tiers.dcg) {
    log("  兜底: 危险命令门不可靠");
  }
  if (!r.tiers.rg) {
    log(
      `  兜底: grep 降级为 Node.js（速度较慢）— ${
        r.mode === "bundle" ? "maou doctor" : "node scripts/ensure-rg.mjs"
      }`,
    );
  }
  if (!r.tiers.sqry) {
    log(
      `  缺失: find_code 不可用 — ${
        r.mode === "bundle" ? "maou doctor" : "node scripts/ensure-sqry.mjs 或 maou doctor"
      }`,
    );
  }

  log("");
  log("── Optional ──");
  log(`  typescript-ls:    ${r.details.lspTS}`);
  log(`  ddgr:             ${r.details.ddgr}`);
  if (r.missingOptional.length) {
    log(`  其它:             △ ${r.missingOptional.join(", ")}`);
  } else {
    log("  其它:             ✓");
  }
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

  // Coding 必选：engine + dcg + rg + sqry；lspTS 仍自动修但非「Coding 完整」硬门槛文案
  // node-pty 已非 use_terminal 主路径，不作为门槛
  const needsFix =
    !r.tiers.core ||
    !r.tiers.dcg ||
    !r.tiers.rg ||
    !r.tiers.terminal ||
    !r.tiers.sqry ||
    !r.tiers.lspTS;

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
        `  Core: ${r.tiers.core ? "✓" : "✗"}  Terminal: ${r.tiers.terminal ? "✓" : "△"}  dcg: ${r.tiers.dcg ? "✓" : "△"}  rg: ${r.tiers.rg ? "✓" : "△"}  sqry: ${r.tiers.sqry ? "✓" : "△"}  ts-ls: ${r.tiers.lspTS ? "✓" : "△"}`,
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
        // 预编译包：只下载，不 cargo build（包里没有 Rust 源码）
        const bin = ensureRatatuiBinary({
          tryBuild: r.mode !== "bundle",
          log: (m) => log(m),
        });
        if (bin) log(`  ✓ ${bin}`);
        else {
          log(
            r.mode === "bundle"
              ? "  △ 下载失败 — 检查网络/GitHub 可达性后重试 maou doctor"
              : "  △ 未安装 — 手动: cd maou-sdk/cli && npm run build:tui-ratatui",
          );
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
  const isBundle = r.mode === "bundle";
  if (!r.tiers.core) {
    log(
      isBundle
        ? "  Core 仍失败。预编译包不完整 — 重跑安装脚本，或 maou update --force 重装"
        : "  Core 仍失败。检查 Node/pnpm，或手动: scripts/build-native",
    );
  } else if (!r.tiers.terminal || !r.tiers.dcg || !r.tiers.rg || !r.tiers.sqry) {
    log("  可启动 maou coding（Coding 依赖不完整）");
    if (isBundle) {
      log("  缺失组件均可重新下载: maou doctor（不需要编译器）");
      if (!r.tiers.terminal) log("  terminal-engine: 检查能否访问 GitHub Release");
    } else {
      if (!r.tiers.terminal) log("  terminal-engine: scripts/build-native 或 cd terminal-engine && npm run build");
      if (!r.tiers.rg) log("  rg: node scripts/ensure-rg.mjs 或 winget install BurntSushi.ripgrep");
      if (!r.tiers.sqry) log("  sqry: node scripts/ensure-sqry.mjs 或 maou doctor（find_code 必选）");
    }
    if (r.details.apiConfig.includes("△")) log("  API: maou setup");
  } else if (!r.tiers.lspTS) {
    log("  Coding 依赖就绪；Optional 降级");
    log("  ts-ls: maou doctor（npm i -g typescript-language-server typescript）");
  } else {
    log("  就绪 → maou coding（默认 Ratatui）");
    if (isBundle || !r.details.git.includes("非 git")) log("  更新: maou update");
  }

  log("");
  // Coding 完整就绪：engine + dcg + rg + sqry（node-pty 不计入）
  if (r.tiers.core && r.tiers.terminal && r.tiers.dcg && r.tiers.rg && r.tiers.sqry) {
    log("✓ Core+Terminal+Coding 就绪（含 find_code/sqry）");
  } else if (r.tiers.core && r.tiers.terminal && r.tiers.dcg && r.tiers.rg) {
    log("△ Core+Terminal 就绪，缺 sqry — find_code 不可用");
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
