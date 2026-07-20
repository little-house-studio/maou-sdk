#!/usr/bin/env node
/**
 * 确保 maou-tui-ratatui 预编译二进制在 ~/.maou/bin（或 MAOU_TUI_BIN）。
 *
 * 用法：
 *   node scripts/ensure-maou-tui.mjs
 *   node scripts/ensure-maou-tui.mjs --force
 *
 * 环境变量：
 *   MAOU_NATIVE_SKIP=1
 *   MAOU_NATIVE_REPO / MAOU_NATIVE_TAG  同 ensure-terminal-engine
 *   MAOU_TUI_BIN=绝对路径              已存在则跳过
 */

import {
  existsSync,
  mkdirSync,
  copyFileSync,
  createWriteStream,
  chmodSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { platform, arch, homedir } from "node:os";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FORCE = process.argv.includes("--force");
const OWNER_REPO =
  process.env.MAOU_NATIVE_REPO || "little-house-studio/maou-sdk";
const RELEASE_TAG = process.env.MAOU_NATIVE_TAG || "native-prebuilds";

if (process.env.MAOU_NATIVE_SKIP === "1") {
  console.log("[ensure-maou-tui] MAOU_NATIVE_SKIP=1，跳过");
  process.exit(0);
}

function assetAndDest() {
  const p = platform();
  const a = arch();
  const userBin = join(homedir(), ".maou", "bin");
  if (p === "darwin" && a === "arm64") {
    return {
      asset: "maou-tui-ratatui-darwin-arm64",
      dest: join(userBin, "maou-tui-ratatui"),
    };
  }
  if (p === "darwin" && a === "x64") {
    return {
      asset: "maou-tui-ratatui-darwin-x64",
      dest: join(userBin, "maou-tui-ratatui"),
    };
  }
  if (p === "linux" && a === "x64") {
    return {
      asset: "maou-tui-ratatui-linux-x64",
      dest: join(userBin, "maou-tui-ratatui"),
    };
  }
  if (p === "linux" && a === "arm64") {
    return {
      asset: "maou-tui-ratatui-linux-arm64",
      dest: join(userBin, "maou-tui-ratatui"),
    };
  }
  if (p === "win32" && a === "x64") {
    return {
      asset: "maou-tui-ratatui-win32-x64.exe",
      dest: join(userBin, "maou-tui-ratatui.exe"),
    };
  }
  if (p === "win32" && a === "arm64") {
    return {
      asset: "maou-tui-ratatui-win32-arm64.exe",
      dest: join(userBin, "maou-tui-ratatui.exe"),
    };
  }
  throw new Error(`不支持的平台: ${p}/${a}`);
}

function alreadyOk(dest) {
  if (FORCE) return false;
  if (process.env.MAOU_TUI_BIN && existsSync(process.env.MAOU_TUI_BIN)) {
    return true;
  }
  try {
    return existsSync(dest) && statSync(dest).size > 100_000;
  } catch {
    return false;
  }
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "maou-sdk-ensure-maou-tui",
      ...(process.env.GITHUB_TOKEN
        ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
        : {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  return res.json();
}

async function main() {
  const { asset, dest } = assetAndDest();
  if (alreadyOk(dest)) {
    console.log(`[ensure-maou-tui] 已存在: ${dest}`);
    process.exit(0);
  }

  try {
    console.log(
      `[ensure-maou-tui] 下载 ${OWNER_REPO}@${RELEASE_TAG} / ${asset}`,
    );
    const api = `https://api.github.com/repos/${OWNER_REPO}/releases/tags/${encodeURIComponent(RELEASE_TAG)}`;
    const release = await fetchJson(api);
    const hit = (release.assets || []).find((a) => a.name === asset);
    if (!hit) {
      throw new Error(`Release 无资产 ${asset}`);
    }
    const res = await fetch(hit.browser_download_url, {
      headers: {
        "User-Agent": "maou-sdk-ensure-maou-tui",
        ...(process.env.GITHUB_TOKEN
          ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
          : {}),
      },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`download ${res.status}`);
    mkdirSync(dirname(dest), { recursive: true });
    const tmp = `${dest}.tmp-${process.pid}`;
    await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
    try {
      if (existsSync(dest)) unlinkSync(dest);
    } catch {
      /* */
    }
    copyFileSync(tmp, dest);
    try {
      unlinkSync(tmp);
    } catch {
      /* */
    }
    if (platform() !== "win32") {
      try {
        chmodSync(dest, 0o755);
      } catch {
        /* */
      }
    }
    console.log(`[ensure-maou-tui] 已就绪: ${dest}`);
  } catch (e) {
    console.warn(
      `[ensure-maou-tui] 预编译不可用: ${e instanceof Error ? e.message : e}\n` +
        "  可稍后: node scripts/ensure-maou-tui.mjs\n" +
        "  或本机构建: bash scripts/build-native.sh（需 Rust）",
    );
  }
  process.exit(0);
}

main().catch((e) => {
  console.warn("[ensure-maou-tui]", e);
  process.exit(0);
});
