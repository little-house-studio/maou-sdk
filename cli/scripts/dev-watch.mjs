#!/usr/bin/env node
/**
 * CLI 开发热重启（安静版）
 *
 * 为什么不用 `tsx watch`：
 *   - tsx / Node 的 Restart 日志、MaxListenersWarning 写进同一 TTY
 *   - 会撕裂 Ink 备用屏，看起来像「调试信息狂冒」
 *
 * 本脚本：
 *   - 只监视 cli/src 下的 .ts / .tsx
 *   - 子进程跑 tsx（静默 Node 警告）
 *   - 变更时：恢复终端 → 杀子进程 → 再起
 *   - 重启提示走 stderr 一行，且先退出备用屏，尽量不脏主屏
 */

import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { resolve, dirname, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(__dirname, "..");
const SRC = resolve(CLI_ROOT, "src");
const ENTRY = resolve(CLI_ROOT, "src/index.tsx");

const WATCH_EXTS = new Set([".ts", ".tsx"]);
const DEBOUNCE_MS = 250;

/** 退出备用屏 + 关鼠标 + 显光标（与 useExitGuard 一致） */
function restoreTerminal() {
  try {
    process.stdout.write(
      "\x1b[?25h\x1b[?1049l\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l\x1b[0m\n",
    );
  } catch { /* ignore */ }
}

let child = null;
let restarting = false;
let debounceTimer = null;
let generation = 0;

function log(msg) {
  // 只在非备用屏时有用；重启前已 restore
  process.stderr.write(`\x1b[2m[maou-dev]\x1b[0m ${msg}\n`);
}

function start() {
  generation += 1;
  const gen = generation;
  const args = [ENTRY, ...process.argv.slice(2)];
  child = spawn("npx", ["tsx", ...args], {
    cwd: CLI_ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "production",
      NODE_NO_WARNINGS: "1",
      // 抑制一些库的 debug
      DEBUG: "",
      TSX_TSCONFIG_PATH: resolve(CLI_ROOT, "tsconfig.json"),
    },
    // macOS / linux：独立进程组，便于整组杀掉
    detached: process.platform !== "win32",
  });

  child.on("exit", (code, signal) => {
    if (gen !== generation) return; // 已被新一代取代
    child = null;
    if (restarting) return;
    // 用户正常退出
    restoreTerminal();
    process.exit(code ?? (signal ? 1 : 0));
  });

  child.on("error", (err) => {
    log(`spawn 失败: ${err.message}`);
    restoreTerminal();
    process.exit(1);
  });
}

function killChild() {
  if (!child || !child.pid) return;
  try {
    if (process.platform !== "win32") {
      // 杀整个进程组
      process.kill(-child.pid, "SIGTERM");
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    try { child.kill("SIGKILL"); } catch { /* ignore */ }
  }
  child = null;
}

function scheduleRestart(reason) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    restarting = true;
    restoreTerminal();
    log(`reload ← ${reason}`);
    killChild();
    // 稍等让端口/tty 释放
    setTimeout(() => {
      restarting = false;
      start();
    }, 80);
  }, DEBOUNCE_MS);
}

function shouldReload(filename) {
  if (!filename) return true; // 某些平台只给目录事件
  const ext = extname(filename);
  if (!WATCH_EXTS.has(ext)) return false;
  // 忽略测试与类型生成噪音
  if (filename.includes(".test.") || filename.endsWith(".d.ts")) return false;
  return true;
}

// recursive watch src（macOS / Node 支持）
try {
  watch(SRC, { recursive: true }, (event, filename) => {
    const name = filename ? String(filename) : "";
    if (!shouldReload(name)) return;
    const rel = name ? relative(CLI_ROOT, resolve(SRC, name)) : "src/";
    scheduleRestart(`${event} ${rel}`);
  });
} catch (err) {
  log(`无法监视 src/: ${err.message}，退化为无 watch 单次运行`);
}

// 信号：先杀子进程再退
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    restarting = true;
    restoreTerminal();
    killChild();
    process.exit(0);
  });
}

log(`watching ${relative(process.cwd(), SRC)}  ·  entry ${relative(process.cwd(), ENTRY)}`);
start();
