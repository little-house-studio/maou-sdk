/**
 * 安装形态识别 —— bundle（免构建预编译包）/ monorepo（源码开发）/ standalone。
 *
 * bundle：`scripts/build-release-bundle.mjs` 产出、由 install-user.sh/ps1 解压到
 *   ~/.maou/versions/<version>/ 的自包含运行时。根目录有 RELEASE.json，
 *   node_modules 已完整安装、dist 已编译、vendor/bin 已带平台二进制。
 *   **绝不允许**在这种形态下跑 pnpm install / pnpm build —— 那里没有源码。
 *
 * monorepo：git clone 的开发树（pnpm-workspace.yaml）。修复=构建。
 *
 * standalone：都不是（例如被单独 npm i 的 cli 包）。修复=尽力下载。
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { findMonorepoRoot, resolveCliPackageRoot } from "./repo-root.js";

export type InstallMode = "bundle" | "monorepo" | "standalone";

/** RELEASE.json —— 由 build-release-bundle.mjs 写入 */
export interface ReleaseManifest {
  /** 清单结构版本，便于以后兼容旧包 */
  schema: number;
  product: string;
  /** CLI 包版本，例如 0.1.0 */
  version: string;
  /** 发布通道：stable（tag）/ dev（develop 滚动） */
  channel: string;
  /** 构建时的 git commit */
  commit: string;
  /** 构建分支 */
  branch?: string;
  /** node-platform-arch，例如 darwin-arm64 / win32-x64 */
  platform: string;
  builtAt: string;
  /** owner/repo，供 update 回查 Release */
  repo: string;
  /** 该包所属的 Release tag */
  releaseTag: string;
  /** 包内已内置的组件 */
  bundled?: {
    terminalEngine?: string | null;
    tui?: string | null;
    dcg?: string | null;
    rg?: string | null;
    sqry?: string | null;
  };
}

export interface RuntimeInfo {
  mode: InstallMode;
  /** bundle 根（含 RELEASE.json），非 bundle 为 null */
  bundleRoot: string | null;
  release: ReleaseManifest | null;
  /** monorepo 根（含 pnpm-workspace.yaml），非 monorepo 为 null */
  monoRoot: string | null;
  /** @little-house-studio/cli 包根 */
  cliRoot: string;
  /**
   * ensure-*.mjs 所在目录。bundle 与 monorepo 都有，standalone 为 null。
   * doctor 自修复只从这里取脚本，不再猜路径。
   */
  scriptsDir: string | null;
  /** 平台二进制安装目录（dcg / rg / sqry / maou-tui-ratatui） */
  vendorBinDir: string | null;
}

function readRelease(dir: string): ReleaseManifest | null {
  const p = join(dir, "RELEASE.json");
  if (!existsSync(p)) return null;
  try {
    const parsed = JSON.parse(readFileSync(p, "utf-8")) as ReleaseManifest;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.version !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 从 start 向上找带 RELEASE.json 的目录 */
function findBundleRoot(start: string, max = 8): { root: string; release: ReleaseManifest } | null {
  let dir = resolve(start);
  for (let i = 0; i < max; i++) {
    const release = readRelease(dir);
    if (release) return { root: dir, release };
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

let cached: RuntimeInfo | null = null;

/**
 * 识别当前安装形态。结果在进程内缓存。
 * MAOU_FORCE_MODE=monorepo|bundle 可覆盖（调试用）。
 */
export function detectRuntime(opts: { refresh?: boolean } = {}): RuntimeInfo {
  if (cached && !opts.refresh) return cached;

  const cliRoot = resolveCliPackageRoot();

  // bundle 布局：<bundleRoot>/{RELEASE.json,package.json,dist,node_modules,scripts,vendor}
  // cliRoot 本身就是 bundleRoot（deploy 产物即 cli 包）。仍向上找一层以防将来嵌套。
  const bundle = findBundleRoot(cliRoot);
  const monoRoot = findMonorepoRoot(cliRoot);

  const forced = process.env.MAOU_FORCE_MODE;
  let mode: InstallMode;
  if (forced === "monorepo" && monoRoot) mode = "monorepo";
  else if (forced === "bundle" && bundle) mode = "bundle";
  else if (bundle) mode = "bundle"; // bundle 优先：里面没有源码，构建路径必须关掉
  else if (monoRoot) mode = "monorepo";
  else mode = "standalone";

  const root = mode === "bundle" ? bundle!.root : monoRoot;
  const scriptsDir = root && existsSync(join(root, "scripts")) ? join(root, "scripts") : null;
  const vendorBinDir = root ? join(root, "vendor", "bin") : null;

  cached = {
    mode,
    bundleRoot: mode === "bundle" ? bundle!.root : null,
    release: bundle?.release ?? null,
    monoRoot: mode === "monorepo" ? monoRoot : null,
    cliRoot,
    scriptsDir,
    vendorBinDir,
  };
  return cached;
}

/** 当前是否为免构建预编译安装 */
export function isBundleInstall(): boolean {
  return detectRuntime().mode === "bundle";
}

/** 展示用版本串：bundle 用 RELEASE.json，monorepo 用 package.json */
export function runtimeVersionLabel(): string {
  const rt = detectRuntime();
  if (rt.release) {
    const short = rt.release.commit ? rt.release.commit.slice(0, 7) : "?";
    return `${rt.release.version} (${rt.release.channel}, ${short}, ${rt.release.platform})`;
  }
  try {
    const pkg = JSON.parse(readFileSync(join(rt.cliRoot, "package.json"), "utf-8"));
    return `${pkg.version ?? "0.0.0"} (source)`;
  } catch {
    return "unknown (source)";
  }
}
