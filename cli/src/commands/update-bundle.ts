/**
 * 预编译包自更新 —— 下载新 bundle、原子切换、保留回滚。
 *
 * 布局（由 install-user.sh / install-user.ps1 建立）：
 *   ~/.maou/versions/<version>-<short>/   bundle 根（含 RELEASE.json）
 *   ~/.maou/current                       指向当前版本（symlink / junction / 文本指针）
 *   ~/.maou/bin/maou                      启动器，运行时读 current
 *
 * 更新流程：
 *   1. 读本地 RELEASE.json 拿 repo / channel / platform / commit
 *   2. 查 Release（stable→latest，dev→固定 tag）里的 manifest.json
 *   3. 比对 version+commit；不同则下载 maou-<platform>.tar.gz|.zip
 *   4. 校验 sha256 → 解压到 versions/<新版本> → 切 current
 *   5. 旧版本目录保留（最近 2 个），可手动回滚
 *
 * 不杀正在运行的 TUI —— 切换后需用户手动重开。
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  statSync,
  createWriteStream,
  createReadStream,
  symlinkSync,
  lstatSync,
  unlinkSync,
  renameSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { homedir, platform, tmpdir } from "node:os";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { detectRuntime, type ReleaseManifest } from "./runtime-mode.js";

const IS_WIN = platform() === "win32";

function log(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

export interface BundleUpdateOptions {
  /** 只检查不下载 */
  check?: boolean;
  /** 版本相同也强制重装（修复损坏的安装） */
  force?: boolean;
  /** 覆盖发布通道 */
  channel?: string;
}

/** Release 级 manifest.json：各平台一条 */
interface ReleaseIndexEntry {
  platform: string;
  version: string;
  channel: string;
  commit: string;
  asset: string;
  dirName: string;
  sha256: string;
  size: number;
  builtAt: string;
}
interface ReleaseIndex {
  version?: string;
  channel?: string;
  commit?: string;
  builds: ReleaseIndexEntry[];
}

// ───────────────────────── 安装布局 ─────────────────────────

interface Layout {
  /** ~/.maou */
  home: string;
  /** ~/.maou/versions */
  versionsDir: string;
  /** ~/.maou/current */
  currentLink: string;
  /** 当前 bundle 根 */
  bundleRoot: string;
  /** 由安装器托管（在 versions/ 下）；否则是手动解压 */
  managed: boolean;
}

function resolveLayout(bundleRoot: string): Layout {
  const parent = dirname(bundleRoot);
  const managed = basename(parent) === "versions";
  const home = managed ? dirname(parent) : dirname(bundleRoot);
  return {
    home,
    versionsDir: managed ? parent : join(home, "versions"),
    currentLink: join(home, "current"),
    bundleRoot,
    managed,
  };
}

// ─────────────────────────── GitHub ─────────────────────────

function ghHeaders(json: boolean): Record<string, string> {
  return {
    ...(json ? { Accept: "application/vnd.github+json" } : {}),
    "User-Agent": "maou-update",
    ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
  };
}

interface GhAsset {
  name: string;
  browser_download_url: string;
  size: number;
}
interface GhRelease {
  tag_name: string;
  published_at: string;
  assets: GhAsset[];
}

async function fetchRelease(repo: string, channel: string, tagOverride?: string): Promise<GhRelease> {
  const tag = tagOverride || (channel === "stable" ? null : releaseTagForChannel(channel));
  const url = tag
    ? `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`
    : `https://api.github.com/repos/${repo}/releases/latest`;
  const res = await fetch(url, { headers: ghHeaders(true) });
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? `找不到 Release（${tag ?? "latest"}）—— 维护者可能尚未发布该通道`
        : `GitHub API ${res.status}: ${url}`,
    );
  }
  return (await res.json()) as GhRelease;
}

function releaseTagForChannel(channel: string): string {
  return channel === "stable" ? "" : "bundle-dev";
}

async function fetchReleaseIndex(rel: GhRelease): Promise<ReleaseIndex | null> {
  const asset = rel.assets.find((a) => a.name === "manifest.json");
  if (!asset) return null;
  const res = await fetch(asset.browser_download_url, {
    headers: ghHeaders(false),
    redirect: "follow",
  });
  if (!res.ok) return null;
  try {
    return (await res.json()) as ReleaseIndex;
  } catch {
    return null;
  }
}

function platformTag(): string {
  return `${process.platform}-${process.arch}`;
}

function assetNameForPlatform(): string {
  return `maou-${platformTag()}${IS_WIN ? ".zip" : ".tar.gz"}`;
}

// ───────────────────────── 下载 / 校验 ──────────────────────

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { headers: ghHeaders(false), redirect: "follow" });
  if (!res.ok) throw new Error(`下载失败 ${res.status}: ${url}`);
  if (!res.body) throw new Error("下载响应为空");
  mkdirSync(dirname(dest), { recursive: true });
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest));
}

function sha256File(p: string): Promise<string> {
  return new Promise((res, rej) => {
    const h = createHash("sha256");
    createReadStream(p)
      .on("error", rej)
      .on("data", (c) => h.update(c))
      .on("end", () => res(h.digest("hex")));
  });
}

/** 解压到 destParent，返回解压出的顶层目录名 */
function extract(archive: string, destParent: string): string | null {
  mkdirSync(destParent, { recursive: true });
  const before = new Set(readdirSync(destParent));

  // tar 在 macOS/Linux 与 Windows 10+ 都有；bsdtar 也能读 zip
  let r = spawnSync("tar", ["-xf", archive, "-C", destParent], {
    stdio: "inherit",
    windowsHide: true,
  });
  if (r.status !== 0 && IS_WIN && archive.endsWith(".zip")) {
    r = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -Path '${archive}' -DestinationPath '${destParent}' -Force`,
      ],
      { stdio: "inherit", windowsHide: true },
    );
  }
  if (r.status !== 0) return null;

  const added = readdirSync(destParent).filter((n) => !before.has(n));
  const dir = added.find((n) => {
    try {
      return statSync(join(destParent, n)).isDirectory();
    } catch {
      return false;
    }
  });
  return dir ?? null;
}

// ───────────────────────── current 切换 ─────────────────────

/**
 * 指向新版本。symlink 优先；Windows 无开发者模式时退化为
 * `current.path` 文本指针（启动器两种都认）。
 */
function pointCurrentTo(layout: Layout, target: string): void {
  const link = layout.currentLink;
  try {
    if (existsSync(link) || isSymlink(link)) {
      const st = lstatSync(link);
      if (st.isSymbolicLink() || st.isFile()) unlinkSync(link);
      else rmSync(link, { recursive: true, force: true });
    }
  } catch {
    /* 下面还会再试 */
  }
  try {
    symlinkSync(target, link, IS_WIN ? "junction" : "dir");
    return;
  } catch {
    /* Windows 非管理员 / 非开发者模式 */
  }
  writeFileSync(join(layout.home, "current.path"), target + "\n", "utf-8");
  log("△ 无法创建 current 符号链接，已写 current.path 文本指针（启动器兼容）");
}

function isSymlink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/** 只保留最近 keep 个版本目录（不含当前） */
function pruneOldVersions(layout: Layout, keepDirs: string[], keep = 2): void {
  let entries: string[];
  try {
    entries = readdirSync(layout.versionsDir);
  } catch {
    return;
  }
  const others = entries
    .filter((n) => !keepDirs.includes(n))
    .map((n) => {
      const p = join(layout.versionsDir, n);
      let mtime = 0;
      try {
        mtime = statSync(p).mtimeMs;
      } catch {
        /* ignore */
      }
      return { n, p, mtime };
    })
    .sort((a, b) => b.mtime - a.mtime);

  for (const old of others.slice(keep)) {
    try {
      rmSync(old.p, { recursive: true, force: true });
      log(`  清理旧版本: ${old.n}`);
    } catch {
      /* 保守失败 */
    }
  }
}

// ─────────────────────────── 主流程 ─────────────────────────

export async function runBundleUpdate(opts: BundleUpdateOptions = {}): Promise<boolean> {
  const rt = detectRuntime({ refresh: true });
  if (rt.mode !== "bundle" || !rt.bundleRoot || !rt.release) {
    log("❌ 当前不是预编译包安装 —— 该路径只用于 bundle 自更新");
    return false;
  }
  const local: ReleaseManifest = rt.release;
  const layout = resolveLayout(rt.bundleRoot);
  const repo = process.env.MAOU_NATIVE_REPO || local.repo || "little-house-studio/maou-sdk";
  const channel = opts.channel || process.env.MAOU_CHANNEL || local.channel || "dev";

  log(`当前: ${local.version} (${local.channel}, ${local.commit.slice(0, 7)}, ${local.platform})`);
  log(`来源: ${repo} · 通道 ${channel}`);
  log(`安装: ${rt.bundleRoot}${layout.managed ? "" : "（手动解压，未由安装器托管）"}`);

  if (local.platform !== platformTag()) {
    log(`△ 包平台 ${local.platform} 与当前运行平台 ${platformTag()} 不一致`);
  }

  let rel: GhRelease;
  try {
    rel = await fetchRelease(repo, channel, process.env.MAOU_RELEASE_TAG);
  } catch (e) {
    log(`❌ 查询 Release 失败: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }

  const index = await fetchReleaseIndex(rel);
  const entry = index?.builds?.find((b) => b.platform === platformTag()) ?? null;
  const assetName = entry?.asset ?? assetNameForPlatform();
  const asset = rel.assets.find((a) => a.name === assetName);

  if (!asset) {
    log(`❌ Release ${rel.tag_name} 缺少本平台资产 ${assetName}`);
    log(`   现有: ${rel.assets.map((a) => a.name).join(", ") || "(空)"}`);
    return false;
  }

  const remoteVersion = entry?.version ?? rel.tag_name.replace(/^v/, "");
  const remoteCommit = entry?.commit ?? "";
  const same =
    remoteVersion === local.version &&
    (!remoteCommit || remoteCommit === local.commit);

  log(`远程: ${remoteVersion}${remoteCommit ? ` (${remoteCommit.slice(0, 7)})` : ""} @ ${rel.tag_name}`);

  if (same && !opts.force) {
    log("✓ 已是最新（--force 可强制重装）");
    return true;
  }
  if (opts.check) {
    log("→ 有可用更新。执行 maou update 应用。");
    return true;
  }

  if (!layout.managed) {
    log("");
    log("△ 该安装不在 ~/.maou/versions 下（手动解压）。");
    log("  自更新只支持安装器布局。请重跑安装脚本，或手动下载：");
    log(`  ${asset.browser_download_url}`);
    return false;
  }

  // ── 下载 ──
  const tmp = join(tmpdir(), `maou-update-${process.pid}`);
  mkdirSync(tmp, { recursive: true });
  const archivePath = join(tmp, assetName);
  log("");
  log(`↓ 下载 ${assetName}（${(asset.size / 1024 / 1024).toFixed(1)} MB）…`);
  try {
    await download(asset.browser_download_url, archivePath);
  } catch (e) {
    log(`❌ ${e instanceof Error ? e.message : String(e)}`);
    rmSync(tmp, { recursive: true, force: true });
    return false;
  }

  // ── 校验 ──
  const expected = entry?.sha256 ?? (await sha256FromSumsAsset(rel, assetName));
  if (expected) {
    const actual = await sha256File(archivePath);
    if (actual !== expected) {
      log(`❌ 校验和不匹配\n   期望 ${expected}\n   实际 ${actual}`);
      rmSync(tmp, { recursive: true, force: true });
      return false;
    }
    log(`✓ sha256 校验通过`);
  } else {
    log("△ Release 未提供校验和，跳过校验");
  }

  // ── 解压到临时区再搬入 versions（避免半成品目录被 current 指到）──
  const stage = join(tmp, "stage");
  const extracted = extract(archivePath, stage);
  if (!extracted) {
    log("❌ 解压失败");
    rmSync(tmp, { recursive: true, force: true });
    return false;
  }
  const stagedRoot = join(stage, extracted);
  if (!existsSync(join(stagedRoot, "RELEASE.json"))) {
    log("❌ 解压产物缺少 RELEASE.json —— 资产可能不是 bundle");
    rmSync(tmp, { recursive: true, force: true });
    return false;
  }

  const finalName = entry?.dirName ?? extracted;
  const finalDir = join(layout.versionsDir, finalName);
  mkdirSync(layout.versionsDir, { recursive: true });
  if (existsSync(finalDir)) rmSync(finalDir, { recursive: true, force: true });
  try {
    renameSync(stagedRoot, finalDir);
  } catch {
    // 跨设备 rename 会失败 → 回退复制
    const r = IS_WIN
      ? spawnSync("robocopy", [stagedRoot, finalDir, "/E", "/NFL", "/NDL", "/NJH", "/NJS"], {
          windowsHide: true,
        })
      : spawnSync("cp", ["-R", stagedRoot, finalDir]);
    const ok = IS_WIN ? (r.status ?? 8) < 8 : r.status === 0;
    if (!ok) {
      log("❌ 无法把新版本移入 versions/");
      rmSync(tmp, { recursive: true, force: true });
      return false;
    }
  }

  pointCurrentTo(layout, finalDir);
  rmSync(tmp, { recursive: true, force: true });

  log("");
  log(`✓ 已更新 → ${finalName}`);
  pruneOldVersions(layout, [finalName, basename(rt.bundleRoot)], 2);

  log("");
  log("请手动退出正在运行的 maou（TUI 不会被自动关闭），再重新启动。");
  log("  maou doctor   # 确认组件齐全");
  return true;
}

/** 回退：从 SHA256SUMS.txt 资产里取校验和 */
async function sha256FromSumsAsset(rel: GhRelease, assetName: string): Promise<string | null> {
  const sums = rel.assets.find((a) => a.name === "SHA256SUMS.txt");
  if (!sums) return null;
  try {
    const res = await fetch(sums.browser_download_url, {
      headers: ghHeaders(false),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const text = await res.text();
    for (const line of text.split(/\r?\n/)) {
      const m = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
      if (m && basename(m[2]!.trim()) === assetName) return m[1]!.toLowerCase();
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** 列出可回滚的本地版本 */
export function listInstalledVersions(): { dir: string; release: ReleaseManifest | null }[] {
  const rt = detectRuntime();
  if (!rt.bundleRoot) return [];
  const layout = resolveLayout(rt.bundleRoot);
  if (!existsSync(layout.versionsDir)) return [];
  return readdirSync(layout.versionsDir)
    .map((n) => {
      const dir = join(layout.versionsDir, n);
      const p = join(dir, "RELEASE.json");
      let release: ReleaseManifest | null = null;
      try {
        release = existsSync(p) ? (JSON.parse(readFileSync(p, "utf-8")) as ReleaseManifest) : null;
      } catch {
        release = null;
      }
      return { dir, release };
    })
    .filter((e) => e.release !== null || existsSync(join(e.dir, "dist", "index.js")));
}

/** 切回指定版本目录（回滚） */
export function rollbackTo(versionDir: string): boolean {
  const rt = detectRuntime();
  if (!rt.bundleRoot) return false;
  const layout = resolveLayout(rt.bundleRoot);
  const target = resolve(versionDir);
  if (!existsSync(join(target, "RELEASE.json"))) {
    log(`❌ ${target} 不是有效 bundle`);
    return false;
  }
  pointCurrentTo(layout, target);
  log(`✓ current → ${target}`);
  return true;
}
