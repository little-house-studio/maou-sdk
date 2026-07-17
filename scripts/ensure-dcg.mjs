#!/usr/bin/env node
/**
 * 确保 monorepo / 用户目录有 dcg 二进制（跨平台，不依赖 bash）。
 *
 * 安装到：
 *   1) <repo>/vendor/bin/dcg[.exe]   （monorepo 开发）
 *   2) ~/.maou/bin/dcg[.exe]         （用户安装 / PATH 回退）
 *
 * 用法：
 *   node scripts/ensure-dcg.mjs
 *   node scripts/ensure-dcg.mjs --force
 *   node scripts/ensure-dcg.mjs --user   # 只装到 ~/.maou/bin
 *
 * 环境变量：
 *   MAOU_DCG_VERSION=v0.6.7  固定版本（默认 GitHub latest）
 *   MAOU_DCG_SKIP=1          跳过
 *   MAOU_DCG_DEST=path       覆盖目标文件路径
 */

import {
  existsSync,
  mkdirSync,
  chmodSync,
  copyFileSync,
  createWriteStream,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { spawnSync, execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { platform, arch, homedir, tmpdir } from "node:os";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OWNER = "Dicklesworthstone";
const REPO = "destructive_command_guard";
const FORCE = process.argv.includes("--force");
const USER_ONLY = process.argv.includes("--user");
const BIN = platform() === "win32" ? "dcg.exe" : "dcg";

if (process.env.MAOU_DCG_SKIP === "1") {
  console.log("[ensure-dcg] MAOU_DCG_SKIP=1，跳过");
  process.exit(0);
}

function targetTriple() {
  const p = platform();
  const a = arch();
  // GitHub release assets (v0.6.7):
  // darwin arm/x64, linux gnu/musl x64, windows msvc x64/arm64
  if (p === "darwin" && a === "arm64") return "aarch64-apple-darwin";
  if (p === "darwin" && a === "x64") return "x86_64-apple-darwin";
  if (p === "linux" && a === "arm64") return "aarch64-unknown-linux-gnu";
  if (p === "linux" && a === "x64") {
    // prefer musl asset if on musl (alpine); else gnu
    try {
      const out = execFileSync("ldd", ["--version"], { encoding: "utf-8" });
      if (/musl/i.test(out)) return "x86_64-unknown-linux-musl";
    } catch {
      /* gnu */
    }
    // asset list has musl for x64; gnu may be named differently — check both later
    return "x86_64-unknown-linux-musl";
  }
  if (p === "win32" && a === "arm64") return "aarch64-pc-windows-msvc";
  if (p === "win32" && a === "x64") return "x86_64-pc-windows-msvc";
  throw new Error(`不支持的平台: ${p}/${a}`);
}

function defaultDests() {
  const list = [];
  if (process.env.MAOU_DCG_DEST) {
    list.push(process.env.MAOU_DCG_DEST);
    return list;
  }
  const userBin = join(homedir(), ".maou", "bin", BIN);
  if (!USER_ONLY) {
    list.push(join(REPO_ROOT, "vendor", "bin", BIN));
  }
  list.push(userBin);
  return list;
}

async function latestTag() {
  if (process.env.MAOU_DCG_VERSION) {
    const v = process.env.MAOU_DCG_VERSION;
    return v.startsWith("v") ? v : `v${v}`;
  }
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "maou-sdk-ensure-dcg",
      },
    },
  );
  if (!res.ok) throw new Error(`GitHub releases API ${res.status}`);
  const j = await res.json();
  return j.tag_name;
}

async function listAssetNames(tag) {
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${tag}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "maou-sdk-ensure-dcg",
      },
    },
  );
  if (!res.ok) throw new Error(`releases/tags ${tag}: ${res.status}`);
  const j = await res.json();
  return (j.assets || []).map((a) => a.name);
}

function alreadyOk(dest) {
  if (!existsSync(dest) || FORCE) return false;
  try {
    const out = execFileSync(dest, ["--version"], {
      encoding: "utf-8",
      timeout: 5000,
    });
    return /\d+\.\d+/.test(out);
  } catch {
    return false;
  }
}

function findExtractedBinary(dir) {
  const name = BIN;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try {
      entries = readdirSync(d);
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = join(d, e);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) stack.push(p);
      else if (e === name || e === "dcg" || e === "dcg.exe") return p;
    }
  }
  return null;
}

async function downloadToFile(url, filePath) {
  const res = await fetch(url, {
    headers: { "User-Agent": "maou-sdk-ensure-dcg" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`download ${url} → ${res.status}`);
  mkdirSync(dirname(filePath), { recursive: true });
  const body = res.body;
  if (!body) throw new Error("empty body");
  await pipeline(Readable.fromWeb(body), createWriteStream(filePath));
}

function extractArchive(archivePath, outDir) {
  mkdirSync(outDir, { recursive: true });
  const lower = archivePath.toLowerCase();
  if (lower.endsWith(".zip")) {
    // try powershell Expand-Archive / unzip / tar
    if (platform() === "win32") {
      const r = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${outDir.replace(/'/g, "''")}' -Force`,
        ],
        { encoding: "utf-8", timeout: 120_000 },
      );
      if (r.status !== 0) {
        throw new Error(`Expand-Archive failed: ${r.stderr || r.stdout}`);
      }
      return;
    }
    const r = spawnSync("unzip", ["-o", archivePath, "-d", outDir], {
      encoding: "utf-8",
      timeout: 120_000,
    });
    if (r.status !== 0) {
      // tar can open zip on some systems
      const r2 = spawnSync("tar", ["-xf", archivePath, "-C", outDir], {
        encoding: "utf-8",
        timeout: 120_000,
      });
      if (r2.status !== 0) {
        throw new Error(`unzip/tar zip failed: ${r.stderr || r2.stderr}`);
      }
    }
    return;
  }
  // .tar.xz / .tar.gz
  const r = spawnSync("tar", ["-xf", archivePath, "-C", outDir], {
    encoding: "utf-8",
    timeout: 120_000,
  });
  if (r.status !== 0) {
    throw new Error(`tar extract failed: ${r.stderr || r.stdout}`);
  }
}

async function installBinary(dest) {
  const tag = await latestTag();
  let triple = targetTriple();
  let assets = await listAssetNames(tag);

  // linux x64: try musl then gnu-style names
  const tryNames = [];
  const push = (t) => {
    tryNames.push(`dcg-${t}.tar.xz`, `dcg-${t}.zip`, `dcg-${t}.tar.gz`);
  };
  push(triple);
  if (platform() === "linux" && arch() === "x64") {
    push("x86_64-unknown-linux-gnu");
    push("x86_64-unknown-linux-musl");
  }

  let assetName = tryNames.find((n) => assets.includes(n));
  if (!assetName) {
    // fuzzy
    assetName = assets.find(
      (n) =>
        n.startsWith("dcg-") &&
        (n.includes(triple.split("-").slice(-2).join("-")) ||
          n.includes(arch() === "x64" ? "x86_64" : "aarch64")) &&
        (n.endsWith(".zip") || n.endsWith(".tar.xz") || n.endsWith(".tar.gz")),
    );
  }
  if (!assetName) {
    throw new Error(
      `No dcg asset for ${triple} in ${tag}. Available: ${assets.filter((a) => a.startsWith("dcg-")).join(", ")}`,
    );
  }

  const url = `https://github.com/${OWNER}/${REPO}/releases/download/${tag}/${assetName}`;
  console.log(`[ensure-dcg] 下载 ${url}`);
  const tmpRoot = join(tmpdir(), `maou-dcg-${Date.now()}`);
  mkdirSync(tmpRoot, { recursive: true });
  const archivePath = join(tmpRoot, assetName);
  try {
    await downloadToFile(url, archivePath);
    const extractDir = join(tmpRoot, "out");
    extractArchive(archivePath, extractDir);
    const binPath = findExtractedBinary(extractDir);
    if (!binPath) {
      throw new Error(`archive 中未找到 ${BIN}`);
    }
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(binPath, dest);
    try {
      chmodSync(dest, 0o755);
    } catch {
      /* win */
    }
  } finally {
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

async function main() {
  const dests = defaultDests();
  // if any dest already ok and not force, done
  for (const d of dests) {
    if (alreadyOk(d)) {
      console.log(`[ensure-dcg] 已就绪: ${d}`);
      return;
    }
  }

  console.log("[ensure-dcg] 安装 Destructive Command Guard (dcg)…");
  const primary = dests[0];
  await installBinary(primary);
  // mirror to other dests
  for (const d of dests.slice(1)) {
    try {
      mkdirSync(dirname(d), { recursive: true });
      copyFileSync(primary, d);
      try {
        chmodSync(d, 0o755);
      } catch {
        /* win */
      }
      console.log(`[ensure-dcg] 复制 → ${d}`);
    } catch (e) {
      console.warn(`[ensure-dcg] 复制到 ${d} 失败: ${e.message || e}`);
    }
  }
  const ver = execFileSync(primary, ["--version"], {
    encoding: "utf-8",
    timeout: 5000,
  }).trim();
  console.log(`[ensure-dcg] 完成: ${primary} (${ver.split("\n")[0]})`);
}

main().catch((err) => {
  console.error("[ensure-dcg] 失败:", err.message || err);
  process.exit(1);
});
