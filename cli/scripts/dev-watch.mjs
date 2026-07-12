#!/usr/bin/env node
/**
 * CLI 开发热重启（安静 + 稳）
 *
 * 修复点：
 *  1. 不用 detached —— 子进程留在前台 TTY 组，能收 SIGWINCH（resize）
 *  2. 不用 npx —— 直接 node + tsx/cli，进程树短、可精确 kill
 *  3. kill 后等 exit 再 start —— 避免双实例抢 TTY
 *  4. 超时 SIGKILL —— 防止子进程卡死不退
 *  5. filename 为空不重启 —— 避免 macOS 目录事件误触发
 *  6. 忽略编辑器临时文件（.swp / ~ / .tmp …）
 *  7. Ctrl+C：先交给子进程清终端；连按两次强制退
 *  8. 子进程崩溃：自动再起（开发体验），非 restart 路径
 *  9. 重启前 restore 终端，避免备用屏/鼠标残留
 */

import { spawn } from "node:child_process";
import { watch, existsSync } from "node:fs";
import { resolve, dirname, extname, relative, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(__dirname, "..");
const SRC = resolve(CLI_ROOT, "src");
const ENTRY = resolve(CLI_ROOT, "src/index.tsx");
const require = createRequire(import.meta.url);

const WATCH_EXTS = new Set([".ts", ".tsx"]);
const DEBOUNCE_MS = 300;
const KILL_WAIT_MS = 1500;
const CRASH_BACKOFF_MS = 800;

/** 解析本地 tsx CLI（避免 npx 多一层进程） */
function resolveTsxCli() {
  try {
    return require.resolve("tsx/cli");
  } catch {
    const bin = join(CLI_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
    if (existsSync(bin)) return bin;
    throw new Error("找不到 tsx，请在 cli 目录 pnpm/npm install");
  }
}

const TSX_CLI = resolveTsxCli();

function restoreTerminal() {
  try {
    // 显光标、退备用屏、关各档鼠标、reset SGR
    process.stdout.write(
      "\x1b[?25h\x1b[?1049l\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l\x1b[0m\x1b[?7h",
    );
  } catch { /* ignore */ }
}

let child = null;
let childPid = null;
let restarting = false;
let debounceTimer = null;
let generation = 0;
let sigintCount = 0;
let crashCount = 0;

function log(msg) {
  try {
    process.stderr.write(`\x1b[2m[maou-dev]\x1b[0m ${msg}\n`);
  } catch { /* ignore */ }
}

function start() {
  generation += 1;
  const gen = generation;
  const userArgs = process.argv.slice(2);

  child = spawn(
    process.execPath,
    [TSX_CLI, ENTRY, ...userArgs],
    {
      cwd: CLI_ROOT,
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV || "production",
        NODE_NO_WARNINGS: "1",
        DEBUG: "",
        FORCE_COLOR: process.env.FORCE_COLOR ?? "1",
      },
      // 必须 false：同前台进程组才能收 SIGWINCH
      detached: false,
    },
  );
  childPid = child.pid ?? null;
  // 稳定运行 5s 后清零崩溃计数
  const stableTimer = setTimeout(() => { crashCount = 0; }, 5000);

  child.on("exit", (code, signal) => {
    clearTimeout(stableTimer);
    if (gen !== generation) return; // 已被新一代取代
    child = null;
    childPid = null;

    if (restarting) return;

    // 正常/用户中断：父进程跟随退出
    if (signal === "SIGINT" || code === 130) {
      restoreTerminal();
      process.exit(130);
    }
    if (signal === "SIGTERM" || code === 143) {
      restoreTerminal();
      process.exit(code ?? 143);
    }

    // 崩溃：开发模式自动再起（限次防死循环）
    if (code !== 0 && code !== null) {
      crashCount += 1;
      if (crashCount <= 5) {
        log(`子进程退出 code=${code}，${CRASH_BACKOFF_MS}ms 后重启 (${crashCount}/5)`);
        restoreTerminal();
        setTimeout(() => {
          if (gen === generation && !restarting) start();
        }, CRASH_BACKOFF_MS);
        return;
      }
      log(`崩溃次数过多，停止自动重启`);
    }

    restoreTerminal();
    process.exit(code ?? 0);
  });

  child.on("error", (err) => {
    if (gen !== generation) return;
    log(`spawn 失败: ${err.message}`);
    child = null;
    childPid = null;
    restoreTerminal();
    process.exit(1);
  });
}

/**
 * 杀当前子进程并等待其真正退出（或超时 SIGKILL）。
 * @returns {Promise<void>}
 */
function killChildAndWait() {
  return new Promise((resolveKill) => {
    if (!child || !childPid) {
      resolveKill();
      return;
    }
    const c = child;
    const pid = childPid;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      child = null;
      childPid = null;
      resolveKill();
    };

    const onExit = () => finish();
    c.once("exit", onExit);

    try {
      c.kill("SIGTERM");
    } catch {
      finish();
      return;
    }

    // 超时强杀
    const t = setTimeout(() => {
      try { c.kill("SIGKILL"); } catch { /* ignore */ }
      // 再给一点时间
      setTimeout(finish, 100);
    }, KILL_WAIT_MS);

    c.once("exit", () => clearTimeout(t));
  });
}

function scheduleRestart(reason) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void doRestart(reason);
  }, DEBOUNCE_MS);
}

let pendingRestartReason = null;

async function doRestart(reason) {
  if (restarting) {
    // 重启进行中又有变更：结束后再来一轮
    pendingRestartReason = reason;
    return;
  }
  restarting = true;
  sigintCount = 0;
  crashCount = 0;
  restoreTerminal();
  log(`reload ← ${reason}`);
  await killChildAndWait();
  await new Promise((r) => setTimeout(r, 60));
  restarting = false;
  start();
  if (pendingRestartReason) {
    const r = pendingRestartReason;
    pendingRestartReason = null;
    scheduleRestart(r);
  }
}

function isJunkName(name) {
  // vim/emacs/vscode 临时文件、编译中间物
  if (!name) return true;
  const base = name.split(/[/\\]/).pop() || name;
  if (base.startsWith(".")) return true; // .DS_Store / .swp 等
  if (base.endsWith("~")) return true;
  if (base.endsWith(".swp") || base.endsWith(".swo")) return true;
  if (base.endsWith(".tmp") || base.endsWith(".temp")) return true;
  if (base.endsWith(".map")) return true;
  if (base.includes(".test.") || base.includes(".spec.")) return false; // 测试改了也可 reload
  return false;
}

function shouldReload(filename) {
  // macOS 有时对目录事件 filename 为 null —— 不要因此全量重启
  if (!filename) return false;
  const name = String(filename);
  if (isJunkName(name)) return false;
  const ext = extname(name);
  if (!WATCH_EXTS.has(ext)) return false;
  if (name.endsWith(".d.ts")) return false;
  return true;
}

// ── 监视 src ──────────────────────────────────────────────
try {
  watch(SRC, { recursive: true }, (event, filename) => {
    const name = filename ? String(filename) : "";
    if (!shouldReload(name)) return;
    const rel = name ? relative(CLI_ROOT, resolve(SRC, name)) : "src/";
    scheduleRestart(`${event} ${rel}`);
  });
} catch (err) {
  log(`无法监视 src/: ${err.message}，退化为无 watch`);
}

// ── 信号 ──────────────────────────────────────────────────
// SIGWINCH：父进程收到时转发给子进程（同组通常已收到，转发无害）
process.on("SIGWINCH", () => {
  if (childPid) {
    try { process.kill(childPid, "SIGWINCH"); } catch { /* ignore */ }
  }
});

// Ctrl+C：第一次交给子进程清场；500ms 内第二次强制退
process.on("SIGINT", () => {
  sigintCount += 1;
  if (sigintCount >= 2 || !child) {
    restarting = true;
    restoreTerminal();
    void killChildAndWait().then(() => process.exit(130));
    return;
  }
  // 第一次：让子进程自己的 SIGINT handler（exitGuard）跑
  // 若子进程未退，稍后再检查
  setTimeout(() => {
    if (child && sigintCount === 1) {
      // 子进程没退干净
      restoreTerminal();
      void killChildAndWait().then(() => process.exit(130));
    }
  }, 600);
});

process.on("SIGTERM", () => {
  restarting = true;
  restoreTerminal();
  void killChildAndWait().then(() => process.exit(143));
});

process.on("SIGHUP", () => {
  restarting = true;
  restoreTerminal();
  void killChildAndWait().then(() => process.exit(129));
});

// 父进程异常也恢复终端
process.on("uncaughtException", (err) => {
  restoreTerminal();
  process.stderr.write(`[maou-dev] uncaught: ${err?.stack ?? err}\n`);
  void killChildAndWait().then(() => process.exit(1));
});

log(`watching ${relative(process.cwd(), SRC)}`);
log(`tsx ${relative(process.cwd(), TSX_CLI)} → ${relative(process.cwd(), ENTRY)}`);
start();
