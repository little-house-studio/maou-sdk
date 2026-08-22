#!/usr/bin/env node
/**
 * 开发者一键环境 —— 跨平台（macOS / Linux / Windows 都跑这一条）。
 *
 *   pnpm setup:dev
 *
 * 做的事：
 *   1. 校验 Node >= 20 / pnpm@10（缺 pnpm 用 corepack 装到 ~/.local/bin）
 *   2. pnpm install
 *   3. pnpm -r build（rustc ≥ 1.88 才本机编原生件，否则拉预编译）
 *   4. 补齐 dcg / rg / sqry 到 <repo>/scripts/vendor/bin
 *   5. 备好 maou-tui-ratatui（rustc 够才编，否则下载预编译）
 *   6. 把 `maou` 启动器写到 ~/.maou/bin，并写入 shell rc
 *   7. maou doctor --check
 *
 * 与终端用户安装器的区别：这里跑真构建、`maou` 指向源码树，改代码 →
 * `pnpm -r build` 就能立刻生效；用户那边是解压即用的预编译包。
 *
 * 参数：
 *   --skip-install   跳过 pnpm install
 *   --skip-build     跳过 pnpm -r build
 *   --no-link        不写 ~/.maou/bin/maou
 *   --no-doctor      结束时不跑 doctor
 */

import { existsSync, mkdirSync, writeFileSync, chmodSync, copyFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, platform } from "node:os";
import { ensureMaouBinOnPath } from "./lib/ensure-maou-path.mjs";
import { MIN_RUSTC_LABEL, probeRustc } from "./lib/rustc-version.mjs";
import { vendorBinDir } from "./lib/vendor-bin.mjs";

const PINNED_PNPM = "10.15.1";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const IS_WIN = platform() === "win32";
const argv = process.argv.slice(2);
const has = (f) => argv.includes(`--${f}`);

const MAOU_HOME = process.env.MAOU_HOME || join(homedir(), ".maou");
const BIN_DIR = join(MAOU_HOME, "bin");

let warnings = 0;

function log(m) {
  process.stdout.write(`${m}\n`);
}
function step(m) {
  process.stdout.write(`\n▸ ${m}\n`);
}
function warn(m) {
  warnings++;
  process.stdout.write(`  △ ${m}\n`);
}
function die(m) {
  process.stderr.write(`\n✗ ${m}\n`);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? REPO_ROOT,
    stdio: opts.quiet ? ["ignore", "pipe", "pipe"] : "inherit",
    env: { ...process.env, ...(opts.env ?? {}) },
    encoding: "utf-8",
    // Windows 上 pnpm/npm 是 .cmd，必须 shell
    shell: IS_WIN && /^(pnpm|npm|npx|cargo|corepack)$/.test(cmd),
    windowsHide: true,
  });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim() };
}

function onPath(cmd) {
  const r = spawnSync(IS_WIN ? "where" : "which", [cmd], {
    encoding: "utf-8",
    windowsHide: true,
    env: process.env,
  });
  return r.status === 0 && Boolean(r.stdout?.trim());
}

function hasCargo() {
  if (onPath("cargo")) return true;
  return existsSync(join(homedir(), ".cargo", "bin", IS_WIN ? "cargo.exe" : "cargo"));
}

function userLocalBin() {
  return IS_WIN ? join(homedir(), "AppData", "Local", "pnpm") : join(homedir(), ".local", "bin");
}

function corepackHome() {
  return (
    process.env.COREPACK_HOME ||
    (IS_WIN
      ? join(homedir(), "AppData", "Local", "node", "corepack")
      : join(homedir(), ".local", "share", "corepack"))
  );
}

function prependPath(dir) {
  const sep = IS_WIN ? ";" : ":";
  const cur = process.env.PATH ?? "";
  if (`${sep}${cur}${sep}`.includes(`${sep}${dir}${sep}`)) return;
  process.env.PATH = `${dir}${sep}${cur}`;
}

function pnpmMajor(ver) {
  const m = /^(\d+)/.exec(String(ver ?? "").trim());
  return m ? parseInt(m[1], 10) : 0;
}

function pnpmInstallHint() {
  const localBin = userLocalBin();
  return IS_WIN
    ? `corepack enable --install-directory "${localBin}" && corepack prepare pnpm@${PINNED_PNPM} --activate\n  或: npm i -g pnpm@${PINNED_PNPM}`
    : `export COREPACK_HOME="$HOME/.local/share/corepack"\n    mkdir -p "$COREPACK_HOME" ~/.local/bin\n    export PATH="$HOME/.local/bin:$PATH"\n    corepack enable --install-directory ~/.local/bin\n    corepack prepare pnpm@${PINNED_PNPM} --activate\n  或: npm i -g pnpm@${PINNED_PNPM}`;
}

function ensurePnpm() {
  const localBin = userLocalBin();
  const home = corepackHome();
  mkdirSync(localBin, { recursive: true });
  mkdirSync(home, { recursive: true });
  process.env.COREPACK_HOME = home;
  prependPath(localBin);

  const havePnpm = () => onPath("pnpm") || onPath("pnpm.cmd");
  if (!havePnpm()) {
    log(`  pnpm 未找到，用 corepack 安装 pnpm@${PINNED_PNPM}（写入 ${localBin}，不需要 root）…`);
    if (!onPath("corepack") && !onPath("corepack.cmd")) {
      die(`需要 pnpm@${PINNED_PNPM}（本机没有 corepack）。\n  ${pnpmInstallHint()}`);
    }
    const enable = run("corepack", ["enable", "--install-directory", localBin], { quiet: true });
    const prep = run("corepack", ["prepare", `pnpm@${PINNED_PNPM}`, "--activate"], { quiet: true });
    if (!enable.ok || !prep.ok || !havePnpm()) {
      die(`corepack 未能装上 pnpm@${PINNED_PNPM}。\n  ${pnpmInstallHint()}`);
    }
  }

  let v = run("pnpm", ["--version"], { quiet: true });
  if (pnpmMajor(v.out) >= 11) {
    log(`  检测到 pnpm ${v.out}（需要 Node ≥ 22.13）。本仓库钉 pnpm@${PINNED_PNPM}，正在切换…`);
    if (onPath("corepack") || onPath("corepack.cmd")) {
      run("corepack", ["enable", "--install-directory", localBin], { quiet: true });
      run("corepack", ["prepare", `pnpm@${PINNED_PNPM}`, "--activate"]);
      prependPath(localBin);
      v = run("pnpm", ["--version"], { quiet: true });
    }
    if (pnpmMajor(v.out) >= 11) {
      die(
        `pnpm ${v.out} 不能用（Node 20 上 pnpm 11 会因 node:sqlite 起不来）。请改用 pnpm@${PINNED_PNPM}：\n  ${pnpmInstallHint()}`,
      );
    }
  }
  log(`  pnpm ${v.out || "?"} ✓`);
}

// ─────────────────────────── 步骤 ───────────────────────────

function checkPrereqs() {
  step("环境检查");
  const major = parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (major < 20) die(`需要 Node.js >= 20，当前 ${process.versions.node}`);
  log(`  Node ${process.versions.node} ✓`);

  ensurePnpm();

  const rustc = probeRustc();
  if (!hasCargo()) {
    log("  Rust/cargo ✗（原生组件走预编译下载）");
  } else if (rustc.ok) {
    log(`  rustc ${rustc.version} ✓（原生组件本机编译，需要 ≥ ${MIN_RUSTC_LABEL}）`);
  } else {
    log(
      `  rustc ${rustc.version ?? "?"} △（本机编需要 ≥ ${MIN_RUSTC_LABEL}，将走预编译，不浪费时间编失败）`,
    );
  }
}

function install() {
  if (has("skip-install")) return;
  step("pnpm install");
  if (run("pnpm", ["install"]).ok) return;
  warn("pnpm install 失败（若上次中断留下半截 node_modules，正在重试）…");
  if (!run("pnpm", ["install"]).ok) {
    die(
      "pnpm install 失败。若目录不完整，删掉再装：\n    rm -rf node_modules\n    pnpm install\n  然后重跑 pnpm setup:dev",
    );
  }
}

function build() {
  if (has("skip-build")) return;
  step("pnpm -r build");
  if (!run("pnpm", ["-r", "run", "build"]).ok) {
    die("pnpm -r build 失败 —— 修完再跑一次 pnpm setup:dev");
  }
}

/** dcg / rg / sqry → <repo>/scripts/vendor/bin */
function vendorTools() {
  step("外部工具（dcg / rg / sqry / ddgr）");
  const jobs = [
    ["ensure-dcg.mjs", "dcg", "危险命令门"],
    ["ensure-rg.mjs", "rg", "grep 加速"],
    ["ensure-sqry.mjs", "sqry", "find_code"],
    ["ensure-ddgr.mjs", "ddgr", "search_internet 增强（需 Python ≥ 3.6）"],
  ];
  for (const [script, name, why] of jobs) {
    const p = join(REPO_ROOT, "scripts", script);
    if (!existsSync(p)) continue;
    const r = run(process.execPath, [p], { quiet: true });
    if (r.ok) log(`  ${name} ✓`);
    else warn(`${name} 获取失败 —— ${why} 会降级（可稍后重跑 node scripts/${script}）`);
  }
}

/** maou-tui-ratatui：rustc ≥ 1.88 才本机编，否则下载预编译 */
function tuiBinary() {
  step("Ratatui TUI 二进制");
  const exe = IS_WIN ? ".exe" : "";
  const built = join(REPO_ROOT, "cli", "tui-ratatui", "target", "release", `maou-tui-ratatui${exe}`);
  const dest = join(BIN_DIR, `maou-tui-ratatui${exe}`);
  const rustc = probeRustc();

  if (hasCargo() && rustc.ok) {
    log("  cargo build --release（首次约 1-3 分钟）…");
    const ok = run("cargo", [
      "build",
      "--release",
      "--manifest-path",
      join(REPO_ROOT, "cli", "tui-ratatui", "Cargo.toml"),
    ]).ok;
    if (ok && existsSync(built)) {
      mkdirSync(BIN_DIR, { recursive: true });
      copyFileSync(built, dest);
      if (!IS_WIN) {
        try {
          chmodSync(dest, 0o755);
        } catch {
          /* ignore */
        }
      }
      log(`  已编译并安装 → ${dest}`);
      return;
    }
    warn("cargo build 失败，回退下载预编译");
  } else if (hasCargo() && !rustc.ok) {
    log(`  rustc ${rustc.version ?? "?"} < ${MIN_RUSTC_LABEL}，跳过本机编译，下载预编译`);
  }

  const p = join(REPO_ROOT, "scripts", "ensure-maou-tui.mjs");
  if (existsSync(p) && run(process.execPath, [p], { quiet: true }).ok && existsSync(dest)) {
    log(`  已下载预编译 → ${dest}`);
    return;
  }
  warn("TUI 二进制不可用 —— maou coding 起不来。装 Rust 后重跑，或检查 GitHub 可达性");
}

/** ~/.maou/bin/maou → 本源码树的 cli/dist/index.js */
function linkLauncher() {
  if (has("no-link")) return;
  step("链接 maou → 本源码树");
  const cliDist = join(REPO_ROOT, "cli", "dist", "index.js");
  if (!existsSync(cliDist)) {
    warn(`${cliDist} 不存在（构建未完成？）—— 跳过链接`);
    return;
  }
  mkdirSync(BIN_DIR, { recursive: true });

  if (IS_WIN) {
    const cmd = `@echo off
setlocal
set "CLI_JS=%MAOU_CLI_JS%"
if "%CLI_JS%"=="" set "CLI_JS=${cliDist}"
if not exist "%CLI_JS%" (
  echo maou: CLI entry not found: %CLI_JS% 1>&2
  echo   re-run: pnpm setup:dev 1>&2
  exit /b 127
)
set "PATH=${vendorBinDir(REPO_ROOT)};%PATH%"
node "%CLI_JS%" %*
exit /b %ERRORLEVEL%
`;
    writeFileSync(join(BIN_DIR, "maou.cmd"), cmd, "utf-8");
    log(`  ${join(BIN_DIR, "maou.cmd")} ✓`);
  } else {
    const sh = `#!/bin/sh
# generated by scripts/setup-dev.mjs — 指向源码树，改代码后 pnpm -r build 即生效
CLI_JS="\${MAOU_CLI_JS:-${cliDist}}"
if [ ! -f "$CLI_JS" ]; then
  echo "maou: CLI entry not found: $CLI_JS" >&2
  echo "  re-run: pnpm setup:dev" >&2
  exit 127
fi
command -v node >/dev/null 2>&1 || { echo "maou: need Node >= 20 on PATH" >&2; exit 127; }
PATH="${vendorBinDir(REPO_ROOT)}:$PATH"
export PATH
exec node "$CLI_JS" "$@"
`;
    const wrap = join(BIN_DIR, "maou");
    writeFileSync(wrap, sh, "utf-8");
    try {
      chmodSync(wrap, 0o755);
    } catch {
      /* ignore */
    }
    log(`  ${wrap} ✓`);
  }

  ensureMaouBinOnPath(BIN_DIR, { log });
  if (!onPath("maou") && !onPath("maou.cmd")) {
    log("");
    log(
      IS_WIN
        ? `  当前窗口还没有 PATH。新开 PowerShell，或: $env:Path = "${BIN_DIR};$env:Path"`
        : `  当前这个终端还没有 PATH，请执行：\n    export PATH="${BIN_DIR}:$PATH"\n  或新开一个终端（已写入 shell rc）。`,
    );
  }
}

function doctor() {
  if (has("no-doctor")) return;
  step("maou doctor --check");
  const cliDist = join(REPO_ROOT, "cli", "dist", "index.js");
  if (!existsSync(cliDist)) {
    warn("cli/dist 缺失，跳过 doctor");
    return;
  }
  run(process.execPath, [cliDist, "doctor", "--check"]);
}

// ──────────────────────────── main ──────────────────────────

log("");
log("  Maou 开发环境安装（源码树）");
log(`  ${REPO_ROOT}`);

checkPrereqs();
install();
build();
vendorTools();
tuiBinary();
linkLauncher();
doctor();

log("");
if (warnings === 0) {
  log("✓ 开发环境就绪");
} else {
  log(`△ 开发环境基本就绪（${warnings} 项降级，见上面 △）`);
}
log("");
log("  maou setup       配置 API（需要交互式 TTY；非 TTY 会跳过，不是安装失败）");
log("  maou coding      在当前目录起编程 Agent");
log("  pnpm -r build    改完代码重新构建");
log("  pnpm bundle      打一个免构建预编译包到 .release/");
log("");
