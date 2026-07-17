/**
 * 依赖预检 / doctor —— 分档：Core / Terminal / Optional。
 *
 * - Core 失败 → 不可启动（exit 1）
 * - Terminal 缺失 → 可启动但终端能力降级（exit 0，报告标 △）
 * - Optional 缺失 → 提示即可
 */

import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { platform, homedir } from "node:os";

const require = createRequire(import.meta.url);

/** 运行必需（缺了 agent 起不来） */
export const CRITICAL_PACKAGES = [
  "@little-house-studio/types",
  "@little-house-studio/agent",
  "@little-house-studio/coding-agent",
  "@little-house-studio/llm",
  "@little-house-studio/tools",
  "@little-house-studio/context",
] as const;

/** 功能增强（缺了部分工具不可用，不阻断启动） */
export const OPTIONAL_PACKAGES = [
  "@little-house-studio/terminal-engine",
  "@little-house-studio/sqry-engine",
  "@little-house-studio/opencli-engine",
  "@little-house-studio/lsp-engine",
] as const;

export type CapabilityTier = {
  /** Node + 核心 JS 包 + cli dist */
  core: boolean;
  /** terminal-engine .node 和/或 node-pty 可用 */
  terminal: boolean;
  /** dcg 二进制 */
  dcg: boolean;
  /** sqry（find_code） */
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
  cliRoot: string;
  /** cli/dist/index.js 是否存在 */
  distOk: boolean;
  tiers: CapabilityTier;
}

function log(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

/** CLI 包根目录（含 package.json） */
export function resolveCliPackageRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "..", ".."), join(here, ".."), process.cwd()];
  for (const c of candidates) {
    const pkg = join(c, "package.json");
    if (!existsSync(pkg)) continue;
    try {
      const name = JSON.parse(readFileSync(pkg, "utf-8")).name;
      if (name === "@little-house-studio/cli" || name === "maou") return c;
    } catch {
      /* next */
    }
  }
  return join(here, "..", "..");
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

function checkNodeVersion(): { ok: boolean; version: string } {
  const version = process.versions.node;
  const major = parseInt(version.split(".")[0] ?? "0", 10);
  return { ok: major >= 20, version };
}

function commandOnPath(name: string): boolean {
  const cmd = platform() === "win32" ? "where" : "which";
  const r = spawnSync(cmd, [name], { encoding: "utf-8", windowsHide: true });
  return r.status === 0 && Boolean(r.stdout?.trim());
}

function findMonorepoRoot(from: string): string | null {
  let d = from;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(d, "pnpm-workspace.yaml"))) return d;
    const parent = dirname(d);
    if (parent === d) break;
    d = parent;
  }
  return null;
}

function detectTerminalEngine(cliRoot: string): { ok: boolean; detail: string } {
  const mono = findMonorepoRoot(cliRoot);
  const teDir = mono ? join(mono, "terminal-engine") : null;
  if (teDir && existsSync(join(teDir, "package.json"))) {
    try {
      const nodes = readdirSync(teDir).filter((f) => f.endsWith(".node"));
      if (nodes.length) return { ok: true, detail: nodes.join(", ") };
      return { ok: false, detail: "源码在但无 .node — 运行 scripts/build-native" };
    } catch {
      return { ok: false, detail: "无法读取 terminal-engine" };
    }
  }
  // 尝试 require 包
  try {
    require.resolve("@little-house-studio/terminal-engine");
    return { ok: true, detail: "package resolvable" };
  } catch {
    return { ok: false, detail: "未构建 / 未安装" };
  }
}

function detectDcg(): { ok: boolean; detail: string } {
  const name = platform() === "win32" ? "dcg.exe" : "dcg";
  const candidates = [
    process.env.MAOU_DCG_PATH,
    process.env.DCG_PATH,
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
  return { ok: false, detail: "未安装（find_code 将不可用）" };
}

function detectInstaller(cwd: string): { cmd: string; argsPrefix: string[] } {
  if (existsSync(join(cwd, "pnpm-lock.yaml")) || existsSync(join(cwd, "node_modules", ".pnpm"))) {
    return { cmd: "pnpm", argsPrefix: ["add"] };
  }
  if (existsSync(join(cwd, "yarn.lock"))) {
    return { cmd: "yarn", argsPrefix: ["add"] };
  }
  return { cmd: "npm", argsPrefix: ["install", "--no-save", "--no-fund", "--no-audit"] };
}

function tryInstall(packages: string[], cwd: string): { ok: boolean; error?: string } {
  if (packages.length === 0) return { ok: true };
  if (
    existsSync(join(cwd, "..", "pnpm-workspace.yaml")) ||
    existsSync(join(cwd, "..", "..", "pnpm-workspace.yaml"))
  ) {
    return {
      ok: false,
      error: "检测到 monorepo workspace，请在仓库根执行: pnpm install && pnpm -r build（或 scripts/build-native）",
    };
  }
  const { cmd, argsPrefix } = detectInstaller(cwd);
  const which = spawnSync(cmd, ["--version"], { encoding: "utf-8" });
  if (which.status !== 0) {
    return { ok: false, error: `未找到 ${cmd}` };
  }
  try {
    log(`[maou] 正在安装缺失依赖: ${packages.join(", ")}`);
    const args = [...argsPrefix, ...packages];
    const r = spawnSync(cmd, args, { cwd, stdio: "inherit", env: process.env });
    if (r.status !== 0) {
      return { ok: false, error: `${cmd} 退出码 ${r.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e as Error).message ?? e) };
  }
}

/**
 * 检查（并可选自动安装）依赖。
 */
export async function ensureDependencies(
  opts: { autoInstall?: boolean; quiet?: boolean } = {},
): Promise<DepCheckResult> {
  const autoInstall =
    opts.autoInstall !== false && process.env.MAOU_NO_AUTO_INSTALL !== "1";
  const quiet = !!opts.quiet;
  const cliRoot = resolveCliPackageRoot();
  const errors: string[] = [];
  const repaired: string[] = [];

  const node = checkNodeVersion();
  if (!node.ok) errors.push(`需要 Node.js >= 20，当前 ${node.version}`);

  const missingCritical: string[] = [];
  for (const pkg of CRITICAL_PACKAGES) {
    if (!(await canImport(pkg))) missingCritical.push(pkg);
  }

  const missingOptional: string[] = [];
  for (const pkg of OPTIONAL_PACKAGES) {
    if (!(await canImport(pkg))) missingOptional.push(pkg);
  }

  if (missingCritical.length > 0 && autoInstall) {
    if (!quiet) log(`[maou] 缺少核心依赖: ${missingCritical.join(", ")}`);
    const r = tryInstall(missingCritical, cliRoot);
    if (r.ok) {
      repaired.push(...missingCritical);
      missingCritical.length = 0;
      for (const pkg of CRITICAL_PACKAGES) {
        if (!(await canImport(pkg))) missingCritical.push(pkg);
      }
    } else if (r.error) {
      errors.push(r.error);
    }
  }

  if (missingOptional.length > 0 && autoInstall) {
    if (!quiet) {
      log(`[maou] 可选依赖缺失: ${missingOptional.join(", ")}`);
    }
    const r = tryInstall(missingOptional, cliRoot);
    if (r.ok) {
      repaired.push(...missingOptional);
      missingOptional.length = 0;
      for (const pkg of OPTIONAL_PACKAGES) {
        if (!(await canImport(pkg))) missingOptional.push(pkg);
      }
    }
  }

  const distOk = existsSync(join(cliRoot, "dist", "index.js"));
  if (!distOk) {
    errors.push("cli/dist/index.js 不存在 — 请在 monorepo 根执行 pnpm -r build 或 scripts/build-native");
  }

  const te = detectTerminalEngine(cliRoot);
  const dcg = detectDcg();
  const sqry = detectSqry();

  const tiers: CapabilityTier = {
    core: node.ok && missingCritical.length === 0 && distOk,
    terminal: te.ok,
    dcg: dcg.ok,
    sqry: sqry.ok,
  };

  const ok = tiers.core;
  if (!ok && missingCritical.length > 0) {
    errors.push(`核心依赖仍不可用: ${missingCritical.join(", ")}`);
  }

  // attach details for doctor via errors only for core; terminal stored in log path
  (ensureDependencies as unknown as { _lastTe?: typeof te; _lastDcg?: typeof dcg; _lastSqry?: typeof sqry })._lastTe =
    te;
  (ensureDependencies as unknown as { _lastDcg?: typeof dcg })._lastDcg = dcg;
  (ensureDependencies as unknown as { _lastSqry?: typeof sqry })._lastSqry = sqry;

  return {
    ok,
    nodeOk: node.ok,
    nodeVersion: node.version,
    missingCritical: [...missingCritical],
    missingOptional: [...missingOptional],
    repaired,
    errors,
    cliRoot,
    distOk,
    tiers,
  };
}

/** 启动前：仅要求 Core；失败抛错或返回 false */
export async function assertCoreReady(): Promise<{ ok: boolean; message?: string }> {
  const r = await ensureDependencies({ autoInstall: false, quiet: true });
  if (r.tiers.core) return { ok: true };
  return {
    ok: false,
    message:
      `Core 未就绪（无法启动）。\n` +
      `  Node: ${r.nodeVersion} ${r.nodeOk ? "ok" : "需要 >=20"}\n` +
      `  dist: ${r.distOk ? "ok" : "缺失"}\n` +
      `  缺失包: ${r.missingCritical.join(", ") || "—"}\n` +
      `  请在 maou-sdk 根目录: pnpm install && pnpm -r build\n` +
      `  或: bash scripts/build-native.sh  /  .\\scripts\\build-native.ps1\n` +
      `  然后: maou doctor`,
  };
}

/** 打印 doctor 报告（分档） */
export async function runDoctor(): Promise<boolean> {
  log("══════════════════════════════════════");
  log("  Maou Doctor · 能力分档检查");
  log("══════════════════════════════════════");
  const r = await ensureDependencies({ autoInstall: true, quiet: false });
  const te = detectTerminalEngine(r.cliRoot);
  const dcg = detectDcg();
  const sqry = detectSqry();

  log(`平台: ${process.platform}/${process.arch}`);
  log("");
  log("── Core（必须，否则不能启动）──");
  log(`  Node >=20:     ${r.nodeOk ? "✓" : "✗"} ${r.nodeVersion}`);
  log(`  CLI dist:      ${r.distOk ? "✓" : "✗"} ${join(r.cliRoot, "dist/index.js")}`);
  log(
    `  核心包:        ${r.missingCritical.length === 0 ? "✓" : "✗ " + r.missingCritical.join(", ")}`,
  );
  log(`  Core 合计:     ${r.tiers.core ? "✓ 可启动" : "✗ 不可启动"}`);

  log("");
  log("── Terminal（建议；缺失则终端能力降级）──");
  log(`  terminal-engine: ${te.ok ? "✓" : "△"} ${te.detail}`);
  log(`  dcg:             ${dcg.ok ? "✓" : "△"} ${dcg.detail}`);
  if (!te.ok) {
    log("  兜底: 使用 child_process 降级 PTY（无完整 ConPTY/交互）");
    log("  修复: scripts/build-native（需 Rust + Win 上 VS Build Tools）");
  }
  if (!dcg.ok) {
    log("  兜底: 危险命令门可能 fail-closed 或跳过 — 勿当生产安全基线");
    log("  修复: node scripts/ensure-dcg.mjs --user");
  }

  log("");
  log("── Optional ──");
  log(`  sqry/find_code:  ${sqry.ok ? "✓" : "△"} ${sqry.detail}`);
  log(
    `  其它包:          ${
      r.missingOptional.length === 0 ? "✓" : "△ " + r.missingOptional.join(", ")
    }`,
  );
  if (!sqry.ok) log("  兜底: find_code 不可用；可用 grep/glob（Node 降级）");

  try {
    const { resolveUserMaouRoot } = await import("@little-house-studio/types");
    log("");
    log(`MAOU_HOME: ${resolveUserMaouRoot()}`);
  } catch {
    /* ignore */
  }
  const tuiDefault = process.platform === "win32" ? "ink" : "ratatui";
  log(`TUI 默认: ${process.env.MAOU_TUI || tuiDefault}（Win=ink；完整 UI 需自建 ratatui）`);
  log("原生件: 用户本机构建（build-native），我们不提供环境相关预编译。");

  if (r.repaired.length) log(`已尝试安装: ${r.repaired.join(", ")}`);
  for (const e of r.errors) log(`⚠ ${e}`);

  log("");
  if (r.tiers.core && te.ok && dcg.ok) {
    log("✓ Core+Terminal 就绪 — 可按「全主功能」使用（仍建议真机验收）");
  } else if (r.tiers.core) {
    log("△ Core 就绪，Terminal/可选 有缺口 — 可启动，但有功能降级");
    log("  详见 INSTALL.md「支持矩阵」");
  } else {
    log("❌ Core 未就绪 — 不要宣称安装成功；先修构建再 doctor");
  }
  log("");
  return r.tiers.core;
}

export async function runPostinstallCheck(): Promise<void> {
  try {
    log("[maou] postinstall: 检查依赖…");
    const r = await ensureDependencies({ autoInstall: true, quiet: false });
    if (r.tiers.core) {
      log("[maou] postinstall: Core 就绪");
    } else {
      log("[maou] postinstall: Core 不完整，请运行: maou doctor");
      for (const e of r.errors) log(`  - ${e}`);
    }
    if (!r.tiers.terminal) {
      log("[maou] postinstall: Terminal 未就绪（可稍后 build-native）");
    }
  } catch (e) {
    log(`[maou] postinstall 检查跳过: ${e}`);
  }
}
