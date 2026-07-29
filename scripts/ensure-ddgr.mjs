#!/usr/bin/env node
/**
 * 确保 ddgr（DuckDuckGo 搜索 CLI）可用，用于 search_internet 增强。
 *
 * 与 dcg / rg / sqry 不同：**ddgr 不是编译型二进制，是单文件 Python 脚本**
 * （jarun/ddgr，约 73 KB，无 pip 依赖，只要 Python ≥ 3.6）。
 * 所以这里直接抓 raw 文件，不走 Release 资产、不区分平台架构。
 *
 * 目标：
 *   1) <repo|bundle>/vendor/bin/ddgr
 *   2) ~/.maou/bin/ddgr
 *   Windows 额外写 ddgr.cmd（调 python 跑脚本；.py 本身不可直接执行）
 *
 * 用法：
 *   node scripts/ensure-ddgr.mjs
 *   node scripts/ensure-ddgr.mjs --user     # 只装到 ~/.maou/bin
 *   node scripts/ensure-ddgr.mjs --force
 *
 * 环境变量：
 *   MAOU_DDGR_DEST=path        覆盖目标文件路径
 *   MAOU_DDGR_VERSION=v2.2     指定版本（默认下面的 PINNED_TAG）
 *   MAOU_DDGR_SKIP=1           跳过
 *   MAOU_TARGET_PLATFORM       交叉打包目标平台（同其它 ensure-*）
 *   GITHUB_TOKEN               提高 API 限额
 */

import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  chmodSync,
  statSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { platform as osPlatform, arch as osArch, homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

/** 交叉打包：目标平台（默认本机） */
const platform = () => process.env.MAOU_TARGET_PLATFORM || osPlatform();
const arch = () => process.env.MAOU_TARGET_ARCH || osArch();
const CROSS = platform() !== osPlatform() || arch() !== osArch();

const FORCE = process.argv.includes("--force");
const USER_ONLY = process.argv.includes("--user");
const IS_WIN_TARGET = platform() === "win32";

/**
 * 钉死版本：ddgr 是搜索抓取脚本，上游 master 随时可能因 DDG 改版而变动。
 * 升级时改这里，别用 master —— 免得某天用户装到一个半坏的版本。
 */
const PINNED_TAG = process.env.MAOU_DDGR_VERSION || "v2.2";
const RAW_URL = `https://raw.githubusercontent.com/jarun/ddgr/${PINNED_TAG}/ddgr`;

if (process.env.MAOU_DDGR_SKIP === "1") {
  console.log("[ensure-ddgr] MAOU_DDGR_SKIP=1，跳过");
  process.exit(0);
}

function log(m) {
  console.log(`[ensure-ddgr] ${m}`);
}

/** 找一个可用的 Python ≥ 3.6；找不到返回 null */
function findPython() {
  const names = osPlatform() === "win32" ? ["python", "py", "python3"] : ["python3", "python"];
  for (const n of names) {
    const r = spawnSync(n, ["-c", "import sys; print(sys.version_info[0], sys.version_info[1])"], {
      encoding: "utf-8",
      timeout: 8000,
      windowsHide: true,
    });
    if (r.status === 0 && r.stdout) {
      const [maj, min] = r.stdout.trim().split(/\s+/).map(Number);
      if (maj > 3 || (maj === 3 && min >= 6)) return { cmd: n, version: `${maj}.${min}` };
    }
  }
  return null;
}

function defaultDests() {
  const name = "ddgr";
  if (process.env.MAOU_DDGR_DEST) return [process.env.MAOU_DDGR_DEST];
  const list = [];
  if (!USER_ONLY) list.push(join(REPO_ROOT, "vendor", "bin", name));
  list.push(join(homedir(), ".maou", "bin", name));
  return list;
}

function alreadyOk(dest) {
  if (FORCE) return false;
  try {
    if (!existsSync(dest) || statSync(dest).size < 10_000) return false;
    // 是不是我们认识的那个脚本（避免撞上别的同名文件）
    return readFileSync(dest, "utf-8").slice(0, 200).includes("python");
  } catch {
    return false;
  }
}

/**
 * Windows：ddgr 是 .py，双击/直接 spawn 都跑不起来，写一个 .cmd 转发。
 *
 * 两个都必须是「运行时才解析」的：
 *   - `%~dp0` = .cmd 自身所在目录 —— 打包机的绝对路径写进去，
 *     用户解压到别处就全废了
 *   - `python` 走 PATH 而不是写死解释器路径 —— 用户换 Python 版本仍然有效
 */
function writeWindowsShim(scriptPath) {
  const base = scriptPath.replace(/^.*[\\/]/, "");
  const shim = `@echo off\r\npython "%~dp0${base}" %*\r\n`;
  const cmdPath = `${scriptPath}.cmd`;
  writeFileSync(cmdPath, shim, "utf-8");
  return cmdPath;
}

async function main() {
  const dests = defaultDests();
  const primary = dests[0];

  if (alreadyOk(primary)) {
    log(`已存在: ${primary}`);
    process.exit(0);
  }

  // Python 检查：交叉打包时目标机器的 Python 我们管不着，只警告不阻断
  const py = CROSS ? null : findPython();
  if (!CROSS && !py) {
    log("未找到 Python >= 3.6 —— ddgr 装了也跑不起来");
    log("  search_internet 会走 HTTP fallback（仍可用，只是结果质量略低）");
    log("  想启用: macOS/Linux 一般自带 python3；Windows 见 https://python.org");
    log("  装好 Python 后重跑: node scripts/ensure-ddgr.mjs");
    process.exit(0); // 可选增强，不阻断安装
  }

  log(`下载 ${RAW_URL}`);
  const res = await fetch(RAW_URL, {
    headers: {
      "User-Agent": "maou-sdk-ensure-ddgr",
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`下载失败 ${res.status}: ${RAW_URL}`);
  const body = await res.text();
  if (body.length < 10_000 || !body.startsWith("#!")) {
    throw new Error(`下载内容异常（${body.length} 字节，非 Python 脚本）`);
  }

  for (const d of dests) {
    try {
      mkdirSync(dirname(d), { recursive: true });
      writeFileSync(d, body, "utf-8");
      if (!IS_WIN_TARGET) {
        try {
          chmodSync(d, 0o755);
        } catch {
          /* ignore */
        }
      } else {
        writeWindowsShim(d);
      }
      log(`写入 → ${d}${IS_WIN_TARGET ? "（含 .cmd shim）" : ""}`);
    } catch (e) {
      console.warn(`[ensure-ddgr] 写入 ${d} 失败: ${e.message || e}`);
    }
  }

  if (CROSS) {
    log(`完成: ${primary} (交叉目标 ${platform()}/${arch()}，跳过运行校验)`);
    return;
  }

  // 运行校验：确认 Python 真能跑起来它
  const r = spawnSync(primary, ["--version"], {
    encoding: "utf-8",
    timeout: 15_000,
    windowsHide: true,
  });
  const ver = (r.stdout ?? "").trim();
  if (r.status === 0 && ver) {
    log(`完成: ${primary} (ddgr ${ver.split("\n")[0]}, python ${py?.version})`);
  } else {
    log(`已写入但运行校验未通过 —— search_internet 会走 HTTP fallback`);
    log(`  ${(r.stderr ?? "").trim().split("\n")[0] || "无输出"}`);
  }
}

main().catch((err) => {
  // 可选增强：失败不阻断
  console.warn(`[ensure-ddgr] 失败: ${err.message || err}`);
  console.warn("[ensure-ddgr] search_internet 将走 HTTP fallback（仍可用）");
  process.exit(0);
});
