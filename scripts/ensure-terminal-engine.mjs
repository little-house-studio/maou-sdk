#!/usr/bin/env node
/**
 * 确保 terminal-engine 原生 .node 可用（优先下载预编译，可选本机构建）。
 *
 * 目标文件（与 load.mjs 一致，underscore 名）：
 *   terminal-engine/terminal_engine.<platform>.node
 * 同时写一份 hyphen 名兼容加载。
 *
 * 用法：
 *   node scripts/ensure-terminal-engine.mjs
 *   node scripts/ensure-terminal-engine.mjs --force
 *
 * 环境变量：
 *   MAOU_NATIVE_SKIP=1              跳过
 *   MAOU_NATIVE_REPO=owner/repo     默认 little-house-studio/maou-sdk
 *   MAOU_NATIVE_TAG=native-prebuilds  Release 标签（默认滚动预编译）
 *   MAOU_BUILD_NATIVE=1             下载失败时强制 cargo 本机构建
 *   MAOU_NATIVE_FORCE_BUILD=1       跳过下载，直接本机构建
 */

import {
  existsSync,
  mkdirSync,
  copyFileSync,
  createWriteStream,
  statSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { platform, arch, tmpdir } from "node:os";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const ENGINE_DIR = join(REPO_ROOT, "terminal-engine");
const FORCE = process.argv.includes("--force");
const OWNER_REPO =
  process.env.MAOU_NATIVE_REPO || "little-house-studio/maou-sdk";
const RELEASE_TAG = process.env.MAOU_NATIVE_TAG || "native-prebuilds";

if (process.env.MAOU_NATIVE_SKIP === "1") {
  console.log("[ensure-terminal-engine] MAOU_NATIVE_SKIP=1，跳过");
  process.exit(0);
}

/** @returns {{ asset: string, triple: string }} */
function platformAsset() {
  const p = platform();
  const a = arch();
  if (p === "darwin" && a === "arm64") {
    return { asset: "terminal_engine.darwin-arm64.node", triple: "darwin-arm64" };
  }
  if (p === "darwin" && a === "x64") {
    return { asset: "terminal_engine.darwin-x64.node", triple: "darwin-x64" };
  }
  if (p === "linux" && a === "x64") {
    return {
      asset: "terminal_engine.linux-x64-gnu.node",
      triple: "linux-x64-gnu",
    };
  }
  if (p === "linux" && a === "arm64") {
    return {
      asset: "terminal_engine.linux-arm64-gnu.node",
      triple: "linux-arm64-gnu",
    };
  }
  if (p === "win32" && a === "x64") {
    return {
      asset: "terminal_engine.win32-x64-msvc.node",
      triple: "win32-x64-msvc",
    };
  }
  if (p === "win32" && a === "arm64") {
    return {
      asset: "terminal_engine.win32-arm64-msvc.node",
      triple: "win32-arm64-msvc",
    };
  }
  throw new Error(`不支持的平台: ${p}/${a}`);
}

function destPaths(triple) {
  const underscored = join(ENGINE_DIR, `terminal_engine.${triple}.node`);
  const hyphen = join(ENGINE_DIR, `terminal-engine.${triple}.node`);
  return { underscored, hyphen };
}

function alreadyOk(paths) {
  if (FORCE) return false;
  for (const p of [paths.underscored, paths.hyphen]) {
    try {
      if (existsSync(p) && statSync(p).size > 10_000) return true;
    } catch {
      /* continue */
    }
  }
  return false;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "maou-sdk-ensure-terminal-engine",
      ...(process.env.GITHUB_TOKEN
        ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
        : {}),
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${url}`);
  }
  return res.json();
}

async function resolveAssetUrl(assetName) {
  const tag = RELEASE_TAG;
  const api = `https://api.github.com/repos/${OWNER_REPO}/releases/tags/${encodeURIComponent(tag)}`;
  const release = await fetchJson(api);
  const assets = release.assets || [];
  const hit = assets.find((a) => a.name === assetName);
  if (!hit) {
    const names = assets.map((a) => a.name).join(", ") || "(none)";
    throw new Error(
      `Release ${tag} 无资产 ${assetName}。现有: ${names}\n` +
        `请维护者运行 GitHub Actions「Native prebuilds」或设置 MAOU_NATIVE_TAG。`,
    );
  }
  return { url: hit.browser_download_url, size: hit.size };
}

async function downloadTo(url, dest) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "maou-sdk-ensure-terminal-engine",
      ...(process.env.GITHUB_TOKEN
        ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
        : {}),
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`download ${res.status}: ${url}`);
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp-${process.pid}`;
  const body = res.body;
  if (!body) throw new Error("empty body");
  await pipeline(Readable.fromWeb(body), createWriteStream(tmp));
  // atomic-ish replace
  try {
    if (existsSync(dest)) unlinkSync(dest);
  } catch {
    /* ignore */
  }
  copyFileSync(tmp, dest);
  try {
    unlinkSync(tmp);
  } catch {
    /* ignore */
  }
}

function tryLocalCargoBuild(triple) {
  if (!existsSync(join(ENGINE_DIR, "Cargo.toml"))) {
    console.warn("[ensure-terminal-engine] 无 terminal-engine 源码，无法本机构建");
    return false;
  }
  const cargo = spawnSync("cargo", ["--version"], { encoding: "utf-8" });
  if (cargo.status !== 0) {
    console.warn("[ensure-terminal-engine] 未找到 cargo，跳过本机构建");
    return false;
  }
  console.log("[ensure-terminal-engine] 本机 cargo build --release …");
  const build = spawnSync("cargo", ["build", "--release"], {
    cwd: ENGINE_DIR,
    encoding: "utf-8",
    env: process.env,
    stdio: "inherit",
  });
  if (build.status !== 0) {
    console.warn("[ensure-terminal-engine] cargo build 失败");
    return false;
  }

  const targetDir =
    process.env.CARGO_TARGET_DIR || join(ENGINE_DIR, "target");
  const releaseDir = join(targetDir, "release");
  let src;
  if (platform() === "darwin") {
    src = join(releaseDir, "libterminal_engine.dylib");
  } else if (platform() === "linux") {
    src = join(releaseDir, "libterminal_engine.so");
  } else if (platform() === "win32") {
    src = join(releaseDir, "terminal_engine.dll");
  }
  if (!src || !existsSync(src)) {
    // fallback: search common names
    console.warn(`[ensure-terminal-engine] 未找到产物: ${src}`);
    return false;
  }
  const { underscored, hyphen } = destPaths(triple);
  mkdirSync(ENGINE_DIR, { recursive: true });
  copyFileSync(src, underscored);
  try {
    copyFileSync(src, hyphen);
  } catch {
    /* ignore */
  }
  console.log(`[ensure-terminal-engine] 本机构建完成: ${underscored}`);
  return true;
}

function writeStamp(triple, source) {
  const stamp = join(ENGINE_DIR, ".prebuild-stamp.json");
  writeFileSync(
    stamp,
    JSON.stringify(
      {
        triple,
        source,
        tag: RELEASE_TAG,
        repo: OWNER_REPO,
        at: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf-8",
  );
}

async function main() {
  const { asset, triple } = platformAsset();
  const paths = destPaths(triple);

  if (alreadyOk(paths)) {
    console.log(
      `[ensure-terminal-engine] 已存在: ${existsSync(paths.underscored) ? paths.underscored : paths.hyphen}`,
    );
    process.exit(0);
  }

  mkdirSync(ENGINE_DIR, { recursive: true });

  if (process.env.MAOU_NATIVE_FORCE_BUILD === "1") {
    if (!tryLocalCargoBuild(triple)) process.exit(1);
    writeStamp(triple, "local-cargo");
    process.exit(0);
  }

  // 1) download prebuild
  try {
    console.log(
      `[ensure-terminal-engine] 下载预编译 ${OWNER_REPO}@${RELEASE_TAG} / ${asset}`,
    );
    const { url } = await resolveAssetUrl(asset);
    await downloadTo(url, paths.underscored);
    try {
      copyFileSync(paths.underscored, paths.hyphen);
    } catch {
      /* optional hyphen twin */
    }
    if (!existsSync(paths.underscored) || statSync(paths.underscored).size < 10_000) {
      throw new Error("下载文件过小或缺失");
    }
    writeStamp(triple, "github-release");
    console.log(`[ensure-terminal-engine] 已就绪: ${paths.underscored}`);
    process.exit(0);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[ensure-terminal-engine] 预编译不可用: ${msg}`);
  }

  // 2) optional local build
  const allowBuild =
    process.env.MAOU_BUILD_NATIVE === "1" ||
    process.env.MAOU_BUILD_NATIVE === "true";
  if (allowBuild || process.argv.includes("--build")) {
    if (tryLocalCargoBuild(triple)) {
      writeStamp(triple, "local-cargo-fallback");
      process.exit(0);
    }
  }

  console.warn(
    "[ensure-terminal-engine] 未安装原生模块。终端将降级/不可用。\n" +
      "  稍后: node scripts/ensure-terminal-engine.mjs\n" +
      "  或本机构建: MAOU_BUILD_NATIVE=1 node scripts/ensure-terminal-engine.mjs --build\n" +
      "  维护者: 在 GitHub 运行 Actions → Native prebuilds",
  );
  // soft fail — install 可继续
  process.exit(0);
}

main().catch((e) => {
  console.error("[ensure-terminal-engine]", e);
  process.exit(0); // soft
});
