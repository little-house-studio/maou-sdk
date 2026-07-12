#!/usr/bin/env node
/**
 * 确保 monorepo 内有 dcg 二进制（必要依赖）。
 * 安装到 <repo>/vendor/bin/dcg（不提交 git，体积约 20MB）。
 *
 * 用法：
 *   node scripts/ensure-dcg.mjs
 *   node scripts/ensure-dcg.mjs --force
 *
 * 环境变量：
 *   MAOU_DCG_VERSION=v0.6.5  固定版本（默认 latest via install.sh）
 *   MAOU_DCG_SKIP=1          跳过（仅调试）
 */

import { existsSync, mkdirSync, chmodSync, createWriteStream } from "node:fs";
import { spawnSync, execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { platform, arch } from "node:os";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const DEST_DIR = join(REPO_ROOT, "vendor", "bin");
const DEST = join(DEST_DIR, process.platform === "win32" ? "dcg.exe" : "dcg");
const FORCE = process.argv.includes("--force");
const OWNER = "Dicklesworthstone";
const REPO = "destructive_command_guard";

if (process.env.MAOU_DCG_SKIP === "1") {
  console.log("[ensure-dcg] MAOU_DCG_SKIP=1，跳过");
  process.exit(0);
}

function targetTriple() {
  const p = platform();
  const a = arch();
  if (p === "darwin" && a === "arm64") return "aarch64-apple-darwin";
  if (p === "darwin" && a === "x64") return "x86_64-apple-darwin";
  if (p === "linux" && a === "arm64") return "aarch64-unknown-linux-gnu";
  if (p === "linux" && a === "x64") return "x86_64-unknown-linux-gnu";
  if (p === "win32" && a === "arm64") return "aarch64-pc-windows-msvc";
  if (p === "win32" && a === "x64") return "x86_64-pc-windows-msvc";
  throw new Error(`不支持的平台: ${p}/${a}`);
}

async function latestTag() {
  if (process.env.MAOU_DCG_VERSION) {
    const v = process.env.MAOU_DCG_VERSION;
    return v.startsWith("v") ? v : `v${v}`;
  }
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`,
    { headers: { Accept: "application/vnd.github+json", "User-Agent": "maou-sdk-ensure-dcg" } },
  );
  if (!res.ok) throw new Error(`GitHub releases API ${res.status}`);
  const j = await res.json();
  return j.tag_name;
}

function alreadyOk() {
  if (!existsSync(DEST) || FORCE) return false;
  try {
    const out = execFileSync(DEST, ["--version"], { encoding: "utf-8", timeout: 5000 });
    return /\d+\.\d+/.test(out);
  } catch {
    return false;
  }
}

async function downloadBinary(tag) {
  const triple = targetTriple();
  // 资产名惯例：dcg-<triple>.tar.gz 或类似；优先用官方 install.sh
  mkdirSync(DEST_DIR, { recursive: true });
  const installSh = join(DEST_DIR, ".dcg-install.sh");
  const shRes = await fetch(
    `https://raw.githubusercontent.com/${OWNER}/${REPO}/main/install.sh`,
  );
  if (!shRes.ok) throw new Error(`download install.sh failed: ${shRes.status}`);
  const shText = await shRes.text();
  const { writeFileSync } = await import("node:fs");
  writeFileSync(installSh, shText, "utf-8");
  chmodSync(installSh, 0o755);

  const args = [
    installSh,
    "--dest",
    DEST_DIR,
    "--no-configure",
    "--quiet",
    "--no-verify", // monorepo CI 可能无 cosign
  ];
  if (tag) {
    args.push("--version", tag);
  }
  const r = spawnSync("bash", args, {
    encoding: "utf-8",
    env: { ...process.env, DEST: DEST_DIR },
    timeout: 180_000,
  });
  if (r.status !== 0) {
    console.error(r.stdout || "");
    console.error(r.stderr || "");
    throw new Error(`dcg install.sh 失败 exit=${r.status}`);
  }
  if (!existsSync(DEST)) {
    // 部分 installer 装到 ~/.local/bin
    const home = process.env.HOME || process.env.USERPROFILE || "";
    const alt = join(home, ".local", "bin", process.platform === "win32" ? "dcg.exe" : "dcg");
    if (existsSync(alt)) {
      const { copyFileSync } = await import("node:fs");
      copyFileSync(alt, DEST);
      chmodSync(DEST, 0o755);
    }
  }
  if (!existsSync(DEST)) {
    throw new Error(`安装后未找到 ${DEST}`);
  }
  chmodSync(DEST, 0o755);
}

async function main() {
  if (alreadyOk()) {
    console.log(`[ensure-dcg] 已就绪: ${DEST}`);
    return;
  }
  console.log("[ensure-dcg] 安装 Destructive Command Guard (dcg)…");
  let tag;
  try {
    tag = await latestTag();
    console.log(`[ensure-dcg] 版本 ${tag}`);
  } catch (e) {
    console.warn(`[ensure-dcg] 无法解析 latest tag，交给 install.sh: ${e.message}`);
    tag = undefined;
  }
  await downloadBinary(tag);
  const ver = execFileSync(DEST, ["--version"], { encoding: "utf-8", timeout: 5000 }).trim();
  console.log(`[ensure-dcg] 完成: ${DEST} (${ver.split("\n")[0]})`);
}

main().catch((err) => {
  console.error("[ensure-dcg] 失败:", err.message || err);
  process.exit(1);
});
