#!/usr/bin/env node
/**
 * 确保 monorepo / 用户目录有 ripgrep (rg) 二进制（跨平台，不依赖 bash）。
 *
 * 优先从 GitHub Releases 下载预编译包（BurntSushi/ripgrep），
 * 避免 Windows 用户手动安装。
 *
 * 安装到：
 *   1) <repo>/vendor/bin/rg[.exe]   （monorepo 开发）
 *   2) ~/.maou/bin/rg[.exe]         （用户安装 / PATH 回退）
 *
 * 用法：
 *   node scripts/ensure-rg.mjs
 *   node scripts/ensure-rg.mjs --force
 *   node scripts/ensure-rg.mjs --user   # 只装到 ~/.maou/bin
 *
 * 环境变量：
 *   MAOU_RG_VERSION=15.2.0     固定版本（默认 GitHub latest）
 *   MAOU_RG_SKIP=1             跳过
 *   MAOU_RG_DEST=path          覆盖目标文件路径
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
const OWNER = "BurntSushi";
const REPO = "ripgrep";
const FORCE = process.argv.includes("--force");
const USER_ONLY = process.argv.includes("--user");
const IS_WIN = platform() === "win32";
const BIN = IS_WIN ? "rg.exe" : "rg";

if (process.env.MAOU_RG_SKIP === "1") {
  console.log("[ensure-rg] MAOU_RG_SKIP=1，跳过");
  process.exit(0);
}

/**
 * 映射本机到 ripgrep release asset 名。
 * ripgrep asset 命名格式：ripgrep-{version}-{target}.{tar.gz|zip}
 * 示例：
 *   ripgrep-15.2.0-x86_64-pc-windows-msvc.zip
 *   ripgrep-15.2.0-aarch64-apple-darwin.tar.gz
 *   ripgrep-15.2.0-x86_64-unknown-linux-musl.tar.gz
 */
function preferredAssets() {
  const p = platform();
  const a = arch();
  const names = [];
  if (p === "win32" && a === "x64") {
    names.push("x86_64-pc-windows-msvc.zip");
  } else if (p === "win32" && a === "arm64") {
    names.push("aarch64-pc-windows-msvc.zip");
  } else if (p === "darwin" && a === "arm64") {
    names.push("aarch64-apple-darwin.tar.gz");
  } else if (p === "darwin" && a === "x64") {
    names.push("x86_64-apple-darwin.tar.gz");
  } else if (p === "linux" && a === "arm64") {
    names.push("aarch64-unknown-linux-musl.tar.gz", "aarch64-unknown-linux-gnu.tar.gz");
  } else if (p === "linux" && a === "x64") {
    let musl = false;
    try {
      const out = execFileSync("ldd", ["--version"], { encoding: "utf-8" });
      musl = /musl/i.test(out);
    } catch {
      /* gnu */
    }
    if (musl) names.push("x86_64-unknown-linux-musl.tar.gz", "x86_64-unknown-linux-gnu.tar.gz");
    else names.push("x86_64-unknown-linux-gnu.tar.gz", "x86_64-unknown-linux-musl.tar.gz");
  } else {
    throw new Error(`不支持的平台: ${p}/${a}`);
  }
  return names;
}

function defaultDests() {
  const list = [];
  if (process.env.MAOU_RG_DEST) {
    list.push(process.env.MAOU_RG_DEST);
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
  if (process.env.MAOU_RG_VERSION) {
    const v = process.env.MAOU_RG_VERSION;
    return v.startsWith("v") ? v : v;
  }
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "maou-sdk-ensure-rg",
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
        "User-Agent": "maou-sdk-ensure-rg",
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
    return /ripgrep|\d+\.\d+/i.test(out);
  } catch {
    return false;
  }
}

function matchAsset(preferred, assets, tag) {
  const ver = tag.replace(/^v/, "");
  for (const suffix of preferred) {
    // ripgrep asset 格式：ripgrep-{version}-{target}.{ext}
    const fullName = `ripgrep-${ver}-${suffix}`;
    if (assets.includes(fullName)) return fullName;
  }
  // fuzzy：用关键字匹配
  const p = platform();
  const a = arch();
  const platKey = p === "win32" ? "windows" : p === "darwin" ? "apple-darwin" : "linux";
  const archKey = a === "arm64" ? "aarch64" : a === "x64" ? "x86_64" : a;
  return (
    assets.find(
      (n) =>
        n.startsWith("ripgrep-") &&
        !n.endsWith(".sha256") &&
        !n.endsWith(".deb") &&
        n.includes(platKey) &&
        n.includes(archKey) &&
        (n.endsWith(".zip") || n.endsWith(".tar.gz") || n.endsWith(".tar.xz")),
    ) || null
  );
}

function findExtractedBinary(dir) {
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
      else if (e === BIN || e === "rg" || e === "rg.exe") return p;
    }
  }
  return null;
}

async function downloadToFile(url, filePath) {
  const res = await fetch(url, {
    headers: { "User-Agent": "maou-sdk-ensure-rg" },
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
    if (IS_WIN) {
      const r = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${outDir.replace(/'/g, "''")}' -Force`,
        ],
        { encoding: "utf-8", timeout: 180_000 },
      );
      if (r.status !== 0) {
        throw new Error(`Expand-Archive failed: ${r.stderr || r.stdout}`);
      }
      return;
    }
    const r = spawnSync("unzip", ["-o", archivePath, "-d", outDir], {
      encoding: "utf-8",
      timeout: 180_000,
    });
    if (r.status !== 0) {
      const r2 = spawnSync("tar", ["-xf", archivePath, "-C", outDir], {
        encoding: "utf-8",
        timeout: 180_000,
      });
      if (r2.status !== 0) {
        throw new Error(`unzip/tar zip failed: ${r.stderr || r2.stderr}`);
      }
    }
    return;
  }
  // .tar.gz / .tar.xz
  const r = spawnSync("tar", ["-xf", archivePath, "-C", outDir], {
    encoding: "utf-8",
    timeout: 180_000,
  });
  if (r.status !== 0) {
    throw new Error(`tar extract failed: ${r.stderr || r.stdout}`);
  }
}

async function installBinary(dest) {
  const tag = await latestTag();
  const assets = await listAssetNames(tag);
  const preferred = preferredAssets();
  const assetName = matchAsset(preferred, assets, tag);
  if (!assetName) {
    throw new Error(
      `No ripgrep asset for ${platform()}/${arch()} in ${tag}. Available: ${assets
        .filter((a) => a.startsWith("ripgrep-") && !a.endsWith(".sha256") && !a.endsWith(".deb"))
        .join(", ")}`,
    );
  }

  const url = `https://github.com/${OWNER}/${REPO}/releases/download/${tag}/${assetName}`;
  console.log(`[ensure-rg] 下载 ${url}`);
  const tmpRoot = join(tmpdir(), `maou-rg-${Date.now()}`);
  mkdirSync(tmpRoot, { recursive: true });
  const archivePath = join(tmpRoot, assetName);
  try {
    await downloadToFile(url, archivePath);
    const extractDir = join(tmpRoot, "out");
    extractArchive(archivePath, extractDir);
    const binPath = findExtractedBinary(extractDir);
    if (!binPath) throw new Error(`archive 中未找到 ${BIN}`);
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
  for (const d of dests) {
    if (alreadyOk(d)) {
      console.log(`[ensure-rg] 已就绪: ${d}`);
      return;
    }
  }

  console.log("[ensure-rg] 安装 ripgrep（预编译二进制）…");
  const primary = dests[0];
  await installBinary(primary);
  for (const d of dests.slice(1)) {
    try {
      mkdirSync(dirname(d), { recursive: true });
      copyFileSync(primary, d);
      try {
        chmodSync(d, 0o755);
      } catch {
        /* win */
      }
      console.log(`[ensure-rg] 复制 → ${d}`);
    } catch (e) {
      console.warn(`[ensure-rg] 复制到 ${d} 失败: ${e.message || e}`);
    }
  }
  const ver = execFileSync(primary, ["--version"], {
    encoding: "utf-8",
    timeout: 5000,
  }).trim();
  console.log(`[ensure-rg] 完成: ${primary} (${ver.split("\n")[0]})`);
}

main().catch((err) => {
  console.error("[ensure-rg] 失败:", err.message || err);
  process.exit(1);
});
