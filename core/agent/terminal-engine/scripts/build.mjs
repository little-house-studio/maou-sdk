#!/usr/bin/env node
/**
 * terminal-engine 构建 —— 不强依赖全局 `napi` CLI。
 *
 * 顺序：
 *   1. 已有本平台 .node 且没传 --force → 跳过（CI 先 cargo 编好再 pnpm build 时走这里）
 *   2. PATH 上有 napi → napi build（顺带生成 index.cjs / index.d.ts）
 *   3. 否则 cargo build --release + 把 cdylib 复制成 terminal_engine.<triple>.node
 *
 * 运行时入口是 load.mjs，它直接 require .node，不依赖 napi 生成的 JS glue，
 * 所以第 3 条产出的包是完整可用的。
 *
 * 用法：
 *   node scripts/build.mjs            # 默认 release
 *   node scripts/build.mjs --debug
 *   node scripts/build.mjs --force    # 忽略已有 .node 重编
 */

import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { platform, arch } from "node:os";
import { MIN_RUSTC_LABEL, probeRustc } from "../../../../scripts/lib/rustc-version.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = resolve(__dirname, "..");
const DEBUG = process.argv.includes("--debug");
const FORCE = process.argv.includes("--force");
const PROFILE = DEBUG ? "debug" : "release";

function log(m) {
  process.stdout.write(`[terminal-engine] ${m}\n`);
}
function die(m) {
  process.stderr.write(`[terminal-engine] ERROR: ${m}\n`);
  process.exit(1);
}

/** napi triple，与 load.mjs 的探测顺序一致 */
function triple() {
  const p = platform();
  const a = arch();
  if (p === "darwin") return `darwin-${a}`;
  if (p === "linux") return `linux-${a}-gnu`;
  if (p === "win32") return `win32-${a}-msvc`;
  die(`不支持的平台: ${p}-${a}`);
  return "";
}

/** cargo 产出的动态库文件名 */
function cdylibName() {
  const p = platform();
  if (p === "darwin") return "libterminal_engine.dylib";
  if (p === "linux") return "libterminal_engine.so";
  return "terminal_engine.dll";
}

function hasNodeArtifact() {
  try {
    return readdirSync(PKG_DIR).some(
      (f) => f.endsWith(".node") && statSync(join(PKG_DIR, f)).size > 10_000,
    );
  } catch {
    return false;
  }
}

function onPath(cmd) {
  const which = platform() === "win32" ? "where" : "which";
  const r = spawnSync(which, [cmd], { encoding: "utf-8", windowsHide: true });
  return r.status === 0 && Boolean(r.stdout?.trim());
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: PKG_DIR,
    stdio: "inherit",
    env: process.env,
    windowsHide: true,
    shell: platform() === "win32" && /^(napi|npx)$/.test(cmd),
    ...opts,
  });
  return r.status === 0;
}

function buildWithNapi() {
  const args = ["build", "--platform", "--js", "index.cjs", "--dts", "index.d.ts"];
  if (!DEBUG) args.splice(1, 0, "--release");
  log(`napi ${args.join(" ")}`);
  return run("napi", args);
}

function buildWithCargo() {
  const args = ["build"];
  if (!DEBUG) args.push("--release");
  log(`cargo ${args.join(" ")}（无 napi CLI，走原生回退）`);
  if (!run("cargo", args)) return false;

  const targetDir = process.env.CARGO_TARGET_DIR || join(PKG_DIR, "target");
  const src = join(targetDir, PROFILE, cdylibName());
  if (!existsSync(src)) {
    die(`cargo 构建完成但找不到产物: ${src}`);
  }
  const t = triple();
  mkdirSync(PKG_DIR, { recursive: true });
  // 下划线 + 连字符两种命名都写一份，load.mjs 两种都认
  copyFileSync(src, join(PKG_DIR, `terminal_engine.${t}.node`));
  copyFileSync(src, join(PKG_DIR, `terminal-engine.${t}.node`));
  log(`产出 terminal_engine.${t}.node`);
  return true;
}

function main() {
  if (!FORCE && hasNodeArtifact()) {
    log(".node 已存在，跳过（--force 可强制重编）");
    return;
  }
  if (!existsSync(join(PKG_DIR, "Cargo.toml"))) {
    die("缺少 Cargo.toml");
  }
  if (!onPath("cargo")) {
    // 没有 Rust 也别让整个 monorepo 构建挂掉：预编译包/ensure 脚本可以补上
    log("⚠ 未找到 cargo —— 跳过原生构建");
    log("  预编译获取: node scripts/ensure-terminal-engine.mjs");
    log("  或安装 Rust: https://rustup.rs");
    return;
  }

  const rustc = probeRustc();
  if (!rustc.ok) {
    log(`⚠ rustc ${rustc.version ?? "?"} < ${MIN_RUSTC_LABEL} —— 跳过本机编译（旧 cargo 会编失败）`);
    log("  预编译获取: node scripts/ensure-terminal-engine.mjs");
    log(`  或升级 rustc ≥ ${MIN_RUSTC_LABEL}: rustup update`);
    return;
  }

  if (onPath("napi") && buildWithNapi() && hasNodeArtifact()) {
    log("napi 构建完成");
    return;
  }
  if (!buildWithCargo()) {
    if (FORCE) die("构建失败");
    log("⚠ cargo 构建失败 —— 跳过（可用 node scripts/ensure-terminal-engine.mjs 拉预编译）");
    return;
  }
  log("构建完成");
}

main();
