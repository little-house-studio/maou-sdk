#!/usr/bin/env node
/**
 * 确保 monorepo / 用户目录有 sqry 二进制（跨平台，不依赖 bash）。
 *
 * 优先从 GitHub Releases 下载预编译包（verivus-oss/sqry），
 * 避免 cargo install 在 Windows 上因 C 编译器 / 语言插件失败。
 *
 * 安装到：
 *   1) <repo>/vendor/bin/sqry[.exe]   （monorepo 开发）
 *   2) ~/.maou/bin/sqry[.exe]         （用户安装 / PATH 回退）
 *
 * 用法：
 *   node scripts/ensure-sqry.mjs
 *   node scripts/ensure-sqry.mjs --force
 *   node scripts/ensure-sqry.mjs --user   # 只装到 ~/.maou/bin
 *
 * 环境变量：
 *   MAOU_SQRY_VERSION=v29.0.3  固定版本（默认 GitHub latest）
 *   MAOU_SQRY_SKIP=1           跳过
 *   MAOU_SQRY_DEST=path        覆盖目标文件路径
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
  renameSync,
} from "node:fs";
import { spawnSync, execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { platform, arch, homedir, tmpdir } from "node:os";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OWNER = "verivus-oss";
const REPO = "sqry";
const FORCE = process.argv.includes("--force");
const USER_ONLY = process.argv.includes("--user");
const IS_WIN = platform() === "win32";
const BIN = IS_WIN ? "sqry.exe" : "sqry";

if (process.env.MAOU_SQRY_SKIP === "1") {
  console.log("[ensure-sqry] MAOU_SQRY_SKIP=1，跳过");
  process.exit(0);
}

/**
 * 映射本机到 release asset 名。
 * SHA256SUMS 示例：
 *   sqry-windows-x86_64.exe
 *   sqry-29.0.3-windows-x86_64.zip
 *   sqry-macos-arm64 / sqry-macos-x86_64
 *   sqry-linux-x86_64 / sqry-linux-x86_64-musl
 *   sqry-linux-arm64 / sqry-linux-arm64-musl
 */
function preferredAssets() {
  const p = platform();
  const a = arch();
  const names = [];
  if (p === "win32" && a === "x64") {
    // 优先单文件 exe，zip 作为后备
    names.push("sqry-windows-x86_64.exe", "sqry-windows-x86_64.zip");
    // 部分 release 用带版本号 zip
    names.push("sqry-*-windows-x86_64.zip");
  } else if (p === "darwin" && a === "arm64") {
    names.push("sqry-macos-arm64");
  } else if (p === "darwin" && a === "x64") {
    names.push("sqry-macos-x86_64");
  } else if (p === "linux" && a === "arm64") {
    names.push("sqry-linux-arm64", "sqry-linux-arm64-musl");
  } else if (p === "linux" && a === "x64") {
    let musl = false;
    try {
      const out = execFileSync("ldd", ["--version"], { encoding: "utf-8" });
      musl = /musl/i.test(out);
    } catch {
      /* gnu */
    }
    if (musl) names.push("sqry-linux-x86_64-musl", "sqry-linux-x86_64");
    else names.push("sqry-linux-x86_64", "sqry-linux-x86_64-musl");
  } else {
    throw new Error(`不支持的平台: ${p}/${a}`);
  }
  return names;
}

function defaultDests() {
  const list = [];
  if (process.env.MAOU_SQRY_DEST) {
    list.push(process.env.MAOU_SQRY_DEST);
    return list;
  }
  const userBin = join(homedir(), ".maou", "bin", BIN);
  if (!USER_ONLY) {
    list.push(join(REPO_ROOT, "vendor", "bin", BIN));
  }
  list.push(userBin);
  // cargo 默认目录也写一份，便于 detectSqry / findSqryBinary 命中
  list.push(join(homedir(), ".cargo", "bin", BIN));
  return list;
}

async function latestTag() {
  if (process.env.MAOU_SQRY_VERSION) {
    const v = process.env.MAOU_SQRY_VERSION;
    return v.startsWith("v") ? v : `v${v}`;
  }
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "maou-sdk-ensure-sqry",
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
        "User-Agent": "maou-sdk-ensure-sqry",
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
      timeout: 8000,
    });
    return /sqry|\d+\.\d+/i.test(out);
  } catch {
    return false;
  }
}

function matchAsset(preferred, assets) {
  for (const pat of preferred) {
    if (pat.includes("*")) {
      const re = new RegExp(
        "^" + pat.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$",
      );
      const hit = assets.find((n) => re.test(n));
      if (hit) return hit;
    } else if (assets.includes(pat)) {
      return pat;
    }
  }
  // fuzzy：平台关键字 + sqry 开头，排除 lsp/mcp/vscode/sqryd
  const p = platform();
  const a = arch();
  const platKey =
    p === "win32"
      ? "windows"
      : p === "darwin"
        ? "macos"
        : "linux";
  const archKey = a === "arm64" ? "arm64" : "x86_64";
  return (
    assets.find(
      (n) =>
        n.startsWith("sqry-") &&
        !n.includes("lsp") &&
        !n.includes("mcp") &&
        !n.includes("vscode") &&
        !n.startsWith("sqryd-") &&
        n.includes(platKey) &&
        n.includes(archKey) &&
        (n.endsWith(".exe") || n.endsWith(".zip") || !n.includes(".")),
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
      else if (
        e === BIN ||
        e === "sqry" ||
        e === "sqry.exe" ||
        /^sqry(-windows-x86_64)?(\.exe)?$/i.test(e)
      ) {
        return p;
      }
    }
  }
  return null;
}

async function downloadToFile(url, filePath) {
  const res = await fetch(url, {
    headers: { "User-Agent": "maou-sdk-ensure-sqry" },
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
  // plain binary（无压缩）：直接复制
  throw new Error(`unsupported archive: ${archivePath}`);
}

async function installBinary(dest) {
  const tag = await latestTag();
  const assets = await listAssetNames(tag);
  const preferred = preferredAssets();
  // 展开带版本号的 zip 候选
  const expanded = preferred.flatMap((n) => {
    if (n.includes("*")) return [n];
    if (n.endsWith(".zip") && !/\d+\.\d+/.test(n)) {
      const ver = tag.replace(/^v/, "");
      return [n, n.replace("sqry-", `sqry-${ver}-`)];
    }
    return [n];
  });
  const assetName = matchAsset(expanded, assets);
  if (!assetName) {
    throw new Error(
      `No sqry asset for ${platform()}/${arch()} in ${tag}. Available: ${assets
        .filter((a) => a.startsWith("sqry-") && !a.includes("lsp") && !a.includes("mcp"))
        .join(", ")}`,
    );
  }

  const url = `https://github.com/${OWNER}/${REPO}/releases/download/${tag}/${assetName}`;
  console.log(`[ensure-sqry] 下载 ${url}`);
  const tmpRoot = join(tmpdir(), `maou-sqry-${Date.now()}`);
  mkdirSync(tmpRoot, { recursive: true });
  const archivePath = join(tmpRoot, assetName);
  try {
    await downloadToFile(url, archivePath);
    let binPath = archivePath;
    if (assetName.endsWith(".zip") || assetName.endsWith(".tar.gz") || assetName.endsWith(".tar.xz")) {
      const extractDir = join(tmpRoot, "out");
      extractArchive(archivePath, extractDir);
      binPath = findExtractedBinary(extractDir);
      if (!binPath) throw new Error(`archive 中未找到 ${BIN}`);
    } else if (!assetName.endsWith(".exe") && IS_WIN === false) {
      // 无后缀单文件二进制
      binPath = archivePath;
    } else if (assetName.endsWith(".exe")) {
      binPath = archivePath;
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
  for (const d of dests) {
    if (alreadyOk(d)) {
      console.log(`[ensure-sqry] 已就绪: ${d}`);
      return;
    }
  }

  console.log("[ensure-sqry] 安装 sqry（预编译二进制）…");
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
      console.log(`[ensure-sqry] 复制 → ${d}`);
    } catch (e) {
      console.warn(`[ensure-sqry] 复制到 ${d} 失败: ${e.message || e}`);
    }
  }
  const ver = execFileSync(primary, ["--version"], {
    encoding: "utf-8",
    timeout: 8000,
  }).trim();
  console.log(`[ensure-sqry] 完成: ${primary} (${ver.split("\n")[0]})`);
}

main().catch((err) => {
  console.error("[ensure-sqry] 失败:", err.message || err);
  process.exit(1);
});
