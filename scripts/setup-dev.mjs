#!/usr/bin/env node
/**
 * 开发者一键环境 —— 跨平台（macOS / Linux / Windows 都跑这一条）。
 *
 *   pnpm setup:dev
 *
 * 做的事：
 *   1. 校验 Node >= 20 / pnpm
 *   2. pnpm install
 *   3. pnpm -r build（terminal-engine 有 Rust 就本机编，没有就拉预编译）
 *   4. 补齐 dcg / rg / sqry 到 <repo>/vendor/bin
 *   5. 备好 maou-tui-ratatui（有 cargo 就编，否则下载预编译）
 *   6. 把 `maou` 启动器写到 ~/.maou/bin，指向**这个源码树**
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
    shell: IS_WIN && /^(pnpm|npm|npx|cargo)$/.test(cmd),
    windowsHide: true,
  });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim() };
}

function onPath(cmd) {
  const r = spawnSync(IS_WIN ? "where" : "which", [cmd], {
    encoding: "utf-8",
    windowsHide: true,
  });
  return r.status === 0 && Boolean(r.stdout?.trim());
}

function hasCargo() {
  if (onPath("cargo")) return true;
  return existsSync(join(homedir(), ".cargo", "bin", IS_WIN ? "cargo.exe" : "cargo"));
}

// ─────────────────────────── 步骤 ───────────────────────────

function checkPrereqs() {
  step("环境检查");
  const major = parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (major < 20) die(`需要 Node.js >= 20，当前 ${process.versions.node}`);
  log(`  Node ${process.versions.node} ✓`);

  if (!onPath("pnpm") && !onPath("pnpm.cmd")) {
    log("  pnpm 未找到，尝试 corepack enable…");
    if (!run("corepack", ["enable"], { quiet: true }).ok || !onPath("pnpm")) {
      die("需要 pnpm。安装: npm i -g pnpm");
    }
  }
  const v = run("pnpm", ["--version"], { quiet: true });
  log(`  pnpm ${v.out || "?"} ✓`);
  log(`  Rust/cargo ${hasCargo() ? "✓（原生组件本机编译）" : "✗（原生组件走预编译下载）"}`);
}

function install() {
  if (has("skip-install")) return;
  step("pnpm install");
  if (!run("pnpm", ["install"]).ok) die("pnpm install 失败");
}

function build() {
  if (has("skip-build")) return;
  step("pnpm -r build");
  if (!run("pnpm", ["-r", "run", "build"]).ok) {
    die("pnpm -r build 失败 —— 修完再跑一次 pnpm setup:dev");
  }
}

/** dcg / rg / sqry → <repo>/vendor/bin */
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

/** maou-tui-ratatui：有 cargo 就编，否则下载预编译 */
function tuiBinary() {
  step("Ratatui TUI 二进制");
  const exe = IS_WIN ? ".exe" : "";
  const built = join(REPO_ROOT, "cli", "tui-ratatui", "target", "release", `maou-tui-ratatui${exe}`);
  const dest = join(BIN_DIR, `maou-tui-ratatui${exe}`);

  if (hasCargo()) {
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
set "PATH=${join(REPO_ROOT, "vendor", "bin")};%PATH%"
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
PATH="${join(REPO_ROOT, "vendor", "bin")}:$PATH"
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

  if (!onPath("maou")) {
    log("");
    log(
      IS_WIN
        ? `  ${BIN_DIR} 还不在 PATH —— 加进用户 PATH 后开新窗口`
        : `  ${BIN_DIR} 还不在 PATH：\n    export PATH="${BIN_DIR}:$PATH"`,
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
log("  maou setup       配置 API");
log("  maou coding      在当前目录起编程 Agent");
log("  pnpm -r build    改完代码重新构建");
log("  pnpm bundle      打一个免构建预编译包到 .release/");
log("");
