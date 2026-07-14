/**
 * 依赖预检 / 自动补齐 —— 安装时与启动前共用。
 *
 * 1. 检查 Node 版本
 * 2. 检查核心包是否可 import
 * 3. 缺失时尝试在 CLI 包目录 npm/pnpm install
 * 4. 可选原生模块（terminal-engine）失败只警告不阻断
 */

import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

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

export interface DepCheckResult {
  ok: boolean;
  nodeOk: boolean;
  nodeVersion: string;
  missingCritical: string[];
  missingOptional: string[];
  repaired: string[];
  errors: string[];
  cliRoot: string;
}

function log(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

/** CLI 包根目录（含 package.json） */
export function resolveCliPackageRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/commands → dist → package root；tsx src/commands → src → package root
  const candidates = [
    join(here, "..", ".."),
    join(here, ".."),
    process.cwd(),
  ];
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
    // ESM-only packages may only expose export map
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
  // workspace 开发态：包已在 monorepo，install 可能无意义且易破坏
  if (existsSync(join(cwd, "..", "pnpm-workspace.yaml")) || existsSync(join(cwd, "..", "..", "pnpm-workspace.yaml"))) {
    return {
      ok: false,
      error: "检测到 monorepo workspace，请在仓库根执行 pnpm install / pnpm -r build",
    };
  }
  const { cmd, argsPrefix } = detectInstaller(cwd);
  const which = spawnSync(cmd, ["--version"], { encoding: "utf-8" });
  if (which.status !== 0) {
    return { ok: false, error: `未找到 ${cmd}，请手动安装: ${packages.join(" ")}` };
  }
  try {
    log(`[maou] 正在安装缺失依赖: ${packages.join(", ")}`);
    const args = [...argsPrefix, ...packages];
    const r = spawnSync(cmd, args, {
      cwd,
      stdio: "inherit",
      env: process.env,
    });
    if (r.status !== 0) {
      return { ok: false, error: `${cmd} ${args.join(" ")} 退出码 ${r.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e as Error).message ?? e) };
  }
}

/**
 * 检查（并可选自动安装）依赖。
 * @param opts.autoInstall 默认 true；MAOU_NO_AUTO_INSTALL=1 时强制关闭
 * @param opts.quiet 少打日志
 */
export async function ensureDependencies(opts: {
  autoInstall?: boolean;
  quiet?: boolean;
} = {}): Promise<DepCheckResult> {
  const autoInstall =
    opts.autoInstall !== false && process.env.MAOU_NO_AUTO_INSTALL !== "1";
  const quiet = !!opts.quiet;
  const cliRoot = resolveCliPackageRoot();
  const errors: string[] = [];
  const repaired: string[] = [];

  const node = checkNodeVersion();
  if (!node.ok) {
    errors.push(`需要 Node.js >= 20，当前 ${node.version}`);
  }

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
      // re-check
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
      log(`[maou] 可选依赖缺失（部分功能可能不可用）: ${missingOptional.join(", ")}`);
    }
    const r = tryInstall(missingOptional, cliRoot);
    if (r.ok) {
      repaired.push(...missingOptional);
      missingOptional.length = 0;
      for (const pkg of OPTIONAL_PACKAGES) {
        if (!(await canImport(pkg))) missingOptional.push(pkg);
      }
    }
    // optional 安装失败不进 errors
  }

  const ok = node.ok && missingCritical.length === 0;
  if (!ok && missingCritical.length > 0) {
    errors.push(`核心依赖仍不可用: ${missingCritical.join(", ")}`);
  }

  return {
    ok,
    nodeOk: node.ok,
    nodeVersion: node.version,
    missingCritical: [...missingCritical],
    missingOptional: [...missingOptional],
    repaired,
    errors,
    cliRoot,
  };
}

/** 打印 doctor 报告 */
export async function runDoctor(): Promise<boolean> {
  log("══════════════════════════════════════");
  log("  Maou Doctor · 依赖与环境检查");
  log("══════════════════════════════════════");
  const r = await ensureDependencies({ autoInstall: true, quiet: false });
  log(`Node: ${r.nodeVersion} ${r.nodeOk ? "✓" : "✗ 需要 >= 20"}`);
  log(`CLI 包目录: ${r.cliRoot}`);
  log(`核心依赖: ${r.missingCritical.length === 0 ? "✓ 齐全" : "✗ " + r.missingCritical.join(", ")}`);
  log(
    `可选依赖: ${
      r.missingOptional.length === 0 ? "✓ 齐全" : "△ 缺失 " + r.missingOptional.join(", ")
    }`,
  );
  if (r.repaired.length) log(`已尝试安装: ${r.repaired.join(", ")}`);
  for (const e of r.errors) log(`⚠ ${e}`);
  log(r.ok ? "✓ 可以启动 maou coding" : "❌ 请先修复核心依赖后再启动");
  log("");
  return r.ok;
}

/**
 * 安装后钩子：检查依赖，尽量补齐，失败只警告（不让 npm install 失败）。
 */
export async function runPostinstallCheck(): Promise<void> {
  try {
    log("[maou] postinstall: 检查依赖…");
    const r = await ensureDependencies({ autoInstall: true, quiet: false });
    if (r.ok) {
      log("[maou] postinstall: 核心依赖就绪");
    } else {
      log("[maou] postinstall: 核心依赖不完整，请运行: maou doctor");
      for (const e of r.errors) log(`  - ${e}`);
    }
    if (r.missingOptional.length > 0) {
      log(
        `[maou] postinstall: 可选依赖未装全（终端/LSP 等功能可能受限）: ${r.missingOptional.join(", ")}`,
      );
    }
  } catch (e) {
    log(`[maou] postinstall 检查跳过: ${e}`);
  }
}
