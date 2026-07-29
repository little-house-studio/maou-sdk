#!/usr/bin/env node
/**
 * 打一个「免构建」自包含运行时包（bundle）。
 *
 * 产物解压即用：用户只要有 Node >= 20，无需 git / pnpm / Rust / VS Build Tools，
 * 也不跑任何 tsc / cargo。
 *
 *   <out>/maou-<version>-<platform>/
 *     RELEASE.json          ← 标记 bundle 形态（CLI 据此关闭所有构建路径）
 *     package.json dist/    ← 已编译的 CLI
 *     node_modules/         ← 全部生产依赖（hoisted，无 symlink 依赖）
 *     scripts/ensure-*.mjs  ← doctor 自修复用（只下载，不编译）
 *     vendor/bin/           ← dcg / rg / sqry / maou-tui-ratatui（本平台）
 *     bin/maou[.cmd]        ← 启动器
 *   <out>/maou-<version>-<platform>.tar.gz|.zip
 *   <out>/maou-<version>-<platform>.tar.gz.sha256
 *
 * 用法：
 *   node scripts/build-release-bundle.mjs
 *   node scripts/build-release-bundle.mjs --channel stable --tag v0.1.0
 *   node scripts/build-release-bundle.mjs --skip-build      # 复用已有 dist
 *   node scripts/build-release-bundle.mjs --no-archive      # 只出目录
 *
 * 必须在目标平台上跑（原生二进制不跨平台）—— CI 用 matrix 覆盖三系统。
 */

import {
  existsSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
  statSync,
  chmodSync,
  createReadStream,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { platform, arch } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const IS_WIN = platform() === "win32";

// ─────────────────────────── args ───────────────────────────

const argv = process.argv.slice(2);
function flag(name) {
  return argv.includes(`--${name}`);
}
function opt(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--")) return argv[i + 1];
  return fallback;
}

const OUT_DIR = resolve(opt("out", join(REPO_ROOT, ".release")));
const CHANNEL = opt("channel", process.env.MAOU_CHANNEL || "dev");
const SKIP_BUILD = flag("skip-build");
const SKIP_INSTALL = flag("skip-install");
const NO_ARCHIVE = flag("no-archive");
const KEEP_STAGE = flag("keep-stage");

function log(msg) {
  process.stdout.write(`[bundle] ${msg}\n`);
}
function die(msg) {
  process.stderr.write(`[bundle] ERROR: ${msg}\n`);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? REPO_ROOT,
    stdio: opts.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: { ...process.env, ...(opts.env ?? {}) },
    encoding: "utf-8",
    shell: IS_WIN && /^(pnpm|npm|npx)$/.test(cmd),
    windowsHide: true,
  });
  return {
    ok: r.status === 0,
    status: r.status,
    stdout: (r.stdout ?? "").trim(),
    stderr: (r.stderr ?? "").trim(),
  };
}

// ─────────────────────── platform naming ────────────────────

const SUPPORTED = new Set([
  "darwin-arm64",
  "darwin-x64",
  "linux-x64",
  "linux-arm64",
  "win32-x64",
  "win32-arm64",
]);

/**
 * 目标平台。默认本机；`--target darwin-x64` 用于交叉打包
 * （JS 部分与平台无关，原生件由 --engine / --tui 注入，
 *   dcg/rg/sqry 由 ensure-* 的 MAOU_TARGET_* 按目标下载）。
 */
function resolveTarget() {
  const t = opt("target", process.env.MAOU_TARGET || `${platform()}-${arch()}`);
  if (!SUPPORTED.has(t)) die(`不支持的目标平台: ${t}（可选: ${[...SUPPORTED].join(", ")}）`);
  return t;
}

const PLATFORM_TAG = resolveTarget();
const [TARGET_OS, TARGET_ARCH] = PLATFORM_TAG.split("-");
const IS_CROSS = PLATFORM_TAG !== `${platform()}-${arch()}`;

/** terminal-engine .node 的 napi triple（与 load.mjs 探测一致） */
const TRIPLE =
  TARGET_OS === "darwin"
    ? `darwin-${TARGET_ARCH}`
    : TARGET_OS === "linux"
      ? `linux-${TARGET_ARCH}-gnu`
      : `win32-${TARGET_ARCH}-msvc`;

/** 目标平台的可执行后缀（不是本机的） */
const EXE = TARGET_OS === "win32" ? ".exe" : "";
/** 目标平台的归档格式 */
const TARGET_IS_WIN = TARGET_OS === "win32";

/** 传给 ensure-dcg/rg/sqry，让它们按目标平台而不是本机下载 */
const TARGET_ENV = IS_CROSS
  ? { MAOU_TARGET_PLATFORM: TARGET_OS, MAOU_TARGET_ARCH: TARGET_ARCH }
  : {};

// ───────────────────────── metadata ─────────────────────────

function gitInfo() {
  const commit = run("git", ["rev-parse", "HEAD"], { capture: true });
  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { capture: true });
  return {
    commit: commit.ok ? commit.stdout : "unknown",
    branch: branch.ok ? branch.stdout : "unknown",
  };
}

function cliVersion() {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "cli", "package.json"), "utf-8"));
  const v = String(pkg.version ?? "0.0.0");
  if (!/^\d+\.\d+\.\d+/.test(v)) {
    die(
      `cli/package.json version "${v}" 不是合法 semver —— 自更新依赖版本比较，请改成如 0.1.0`,
    );
  }
  return v;
}

// ────────────────────────── fs utils ────────────────────────

function rmrf(p) {
  // 只允许删 OUT_DIR / 仓库内 .release 子路径，避免脚本被误用删掉别的东西
  const abs = resolve(p);
  const inOut = abs === OUT_DIR || abs.startsWith(OUT_DIR + sep);
  if (!inOut) die(`拒绝删除 ${abs}（只允许清理 ${OUT_DIR} 内路径）`);
  rmSync(abs, { recursive: true, force: true });
}

function copyDir(src, dest, filter) {
  if (!existsSync(src)) return 0;
  mkdirSync(dest, { recursive: true });
  let n = 0;
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, entry.name);
    const d = join(dest, entry.name);
    if (filter && !filter(s, entry)) continue;
    if (entry.isDirectory()) n += copyDir(s, d, filter);
    else if (entry.isFile()) {
      copyFileSync(s, d);
      n++;
    }
  }
  return n;
}

function sha256File(p) {
  return new Promise((res, rej) => {
    const h = createHash("sha256");
    createReadStream(p)
      .on("error", rej)
      .on("data", (c) => h.update(c))
      .on("end", () => res(h.digest("hex")));
  });
}

function sizeOf(p) {
  try {
    return statSync(p).size;
  } catch {
    return 0;
  }
}

// ─────────────────────────── steps ──────────────────────────

function stepBuildJs() {
  if (SKIP_BUILD) {
    log("--skip-build：跳过 pnpm build");
    return;
  }
  if (!SKIP_INSTALL) {
    log("pnpm install…");
    const frozen = existsSync(join(REPO_ROOT, "pnpm-lock.yaml"));
    const r = run("pnpm", frozen ? ["install", "--frozen-lockfile"] : ["install"]);
    if (!r.ok) die("pnpm install 失败");
  }
  log("pnpm -r run build…");
  if (!run("pnpm", ["-r", "run", "build"]).ok) die("pnpm -r build 失败");
}

/** 保证 terminal-engine .node 存在（--engine 显式注入时跳过） */
function stepEnsureTerminalEngine() {
  if (opt("engine", "")) return; // 由 stepInjectNatives 处理
  if (IS_CROSS) {
    log(`⚠ 交叉目标 ${PLATFORM_TAG}：必须用 --engine <path> 注入 .node`);
    return;
  }
  const engineDir = join(REPO_ROOT, "terminal-engine");
  const has = () =>
    existsSync(engineDir) &&
    readdirSync(engineDir).some((f) => f.endsWith(".node") && sizeOf(join(engineDir, f)) > 10_000);
  if (has()) {
    log("terminal-engine .node 已存在");
    return;
  }
  log("ensure-terminal-engine…");
  run(process.execPath, [join(REPO_ROOT, "scripts", "ensure-terminal-engine.mjs")]);
  if (!has()) {
    log("⚠ terminal-engine .node 缺失 —— 包内将不含终端引擎（use_terminal 降级）");
  }
}

/**
 * 注入 CI 上单独编好的原生件（交叉打包必须；同平台可选，用来省一次下载）。
 *   --engine path/to/terminal_engine.<triple>.node
 *   --tui    path/to/maou-tui-ratatui[.exe]
 */
function stepInjectNatives(bundleDir) {
  const enginePath = opt("engine", "");
  if (enginePath) {
    if (!existsSync(enginePath)) die(`--engine 文件不存在: ${enginePath}`);
    const teDir = join(bundleDir, "node_modules", "@little-house-studio", "terminal-engine");
    if (!existsSync(teDir)) die("bundle 内无 terminal-engine 包，无法注入 .node");
    // 先清掉 deploy 带进来的本机 .node，再写目标平台的（下划线 + 连字符两种名字）
    for (const f of readdirSync(teDir)) {
      if (f.endsWith(".node")) rmSync(join(teDir, f), { force: true });
    }
    copyFileSync(enginePath, join(teDir, `terminal_engine.${TRIPLE}.node`));
    copyFileSync(enginePath, join(teDir, `terminal-engine.${TRIPLE}.node`));
    log(`注入 engine: ${enginePath} → terminal_engine.${TRIPLE}.node`);
  }

  const tuiPath = opt("tui", "");
  if (tuiPath) {
    if (!existsSync(tuiPath)) die(`--tui 文件不存在: ${tuiPath}`);
    const vendorBin = join(bundleDir, "vendor", "bin");
    mkdirSync(vendorBin, { recursive: true });
    const dest = join(vendorBin, `maou-tui-ratatui${EXE}`);
    copyFileSync(tuiPath, dest);
    if (!TARGET_IS_WIN) {
      try {
        chmodSync(dest, 0o755);
      } catch {
        /* ignore */
      }
    }
    log(`注入 tui: ${tuiPath} → vendor/bin/maou-tui-ratatui${EXE}`);
  }
}

function stepDeploy(bundleDir) {
  // pnpm deploy 的目标路径按 CWD 解析；用相对路径最稳
  const relOut = relative(REPO_ROOT, bundleDir).split(sep).join("/");
  log(`pnpm deploy → ${relOut}`);
  const r = run("pnpm", [
    "deploy",
    "--filter=@little-house-studio/cli",
    "--prod",
    "--legacy",
    // hoisted：产出扁平 node_modules，几乎无 symlink，跨平台打包/解压不丢结构
    "--config.node-linker=hoisted",
    relOut,
  ]);
  if (!r.ok) die("pnpm deploy 失败");
  if (!existsSync(join(bundleDir, "dist", "index.js"))) {
    die("deploy 后缺少 dist/index.js");
  }
}

/** ensure-*.mjs → <bundle>/scripts （doctor 自修复只下载不编译） */
function stepCopyScripts(bundleDir) {
  const src = join(REPO_ROOT, "scripts");
  const dest = join(bundleDir, "scripts");
  mkdirSync(dest, { recursive: true });
  const wanted = [
    "ensure-dcg.mjs",
    "ensure-rg.mjs",
    "ensure-sqry.mjs",
    "ensure-ddgr.mjs",
    "ensure-terminal-engine.mjs",
    "ensure-maou-tui.mjs",
  ];
  let n = 0;
  for (const f of wanted) {
    const s = join(src, f);
    if (existsSync(s)) {
      copyFileSync(s, join(dest, f));
      n++;
    }
  }
  log(`scripts: ${n} 个 ensure-*.mjs`);
}

/** dcg / rg / sqry / maou-tui-ratatui → <bundle>/vendor/bin */
function stepVendorBinaries(bundleDir) {
  const vendorBin = join(bundleDir, "vendor", "bin");
  mkdirSync(vendorBin, { recursive: true });
  const got = {};

  const ensures = [
    { name: "dcg", script: "ensure-dcg.mjs", destEnv: "MAOU_DCG_DEST" },
    { name: "rg", script: "ensure-rg.mjs", destEnv: "MAOU_RG_DEST" },
    { name: "sqry", script: "ensure-sqry.mjs", destEnv: "MAOU_SQRY_DEST" },
    { name: "ddgr", script: "ensure-ddgr.mjs", destEnv: "MAOU_DDGR_DEST", noExe: true, minSize: 10_000 },
  ];
  for (const e of ensures) {
    // ddgr 是 Python 脚本，任何平台都不带 .exe（Windows 另有同名 .cmd shim）
    const suffix = e.noExe ? "" : EXE;
    const dest = join(vendorBin, `${e.name}${suffix}`);
    const script = join(REPO_ROOT, "scripts", e.script);
    if (!existsSync(script)) continue;
    log(`vendor: ${e.name}…`);
    run(process.execPath, [script, "--force"], {
      env: { [e.destEnv]: dest, ...TARGET_ENV },
    });
    if (existsSync(dest) && sizeOf(dest) > (e.minSize ?? 10_000)) {
      if (!TARGET_IS_WIN) {
        try {
          chmodSync(dest, 0o755);
        } catch {
          /* ignore */
        }
      }
      got[e.name] = `${e.name}${suffix}`;
    } else {
      log(`⚠ vendor: ${e.name} 未获取到（该能力将降级）`);
      got[e.name] = null;
    }
  }

  // maou-tui-ratatui：--tui 已注入则跳过；否则本仓产物 → 预编译下载
  const tuiName = `maou-tui-ratatui${EXE}`;
  const tuiDest = join(vendorBin, tuiName);
  if (opt("tui", "")) {
    got.tui = existsSync(tuiDest) ? tuiName : null;
    return got;
  }
  const localCandidates = IS_CROSS
    ? []
    : [
        join(REPO_ROOT, "cli", "tui-ratatui", "target", "release", tuiName),
        join(REPO_ROOT, "target", "release", tuiName),
      ];
  let tuiSrc = localCandidates.find((p) => existsSync(p));
  if (!tuiSrc) {
    log("vendor: maou-tui-ratatui（下载预编译）…");
    const script = join(REPO_ROOT, "scripts", "ensure-maou-tui.mjs");
    if (existsSync(script)) {
      run(process.execPath, [script, "--force"], {
        env: { MAOU_TUI_DEST: vendorBin, ...TARGET_ENV },
      });
      if (existsSync(tuiDest) && sizeOf(tuiDest) > 100_000) tuiSrc = tuiDest;
    }
  }
  if (tuiSrc && tuiSrc !== tuiDest) {
    copyFileSync(tuiSrc, tuiDest);
  }
  if (tuiSrc) {
    if (!TARGET_IS_WIN) {
      try {
        chmodSync(tuiDest, 0o755);
      } catch {
        /* ignore */
      }
    }
    got.tui = tuiName;
    log(`vendor: maou-tui-ratatui ← ${tuiSrc}`);
  } else {
    got.tui = null;
    log("⚠ vendor: maou-tui-ratatui 缺失 —— TUI 将不可用");
  }

  return got;
}

/** 校验 deploy 产物里 terminal-engine 的 .node 确实是本平台的 */
function stepVerifyEngine(bundleDir) {
  const teDir = join(
    bundleDir,
    "node_modules",
    "@little-house-studio",
    "terminal-engine",
  );
  if (!existsSync(teDir)) {
    log("⚠ bundle 内无 terminal-engine 包");
    return null;
  }
  const nodes = readdirSync(teDir).filter((f) => f.endsWith(".node"));
  const mine = nodes.find((f) => f.includes(TRIPLE));
  if (!mine) {
    log(`⚠ bundle 内 terminal-engine 无 ${TRIPLE} 产物（现有: ${nodes.join(", ") || "无"}）`);
    return null;
  }
  // 其它平台的 .node 是死重量，删掉
  for (const f of nodes) {
    if (f !== mine && !f.includes(TRIPLE)) rmSync(join(teDir, f), { force: true });
  }
  log(`terminal-engine: ${mine}`);
  return mine;
}

function stepLaunchers(bundleDir) {
  const binDir = join(bundleDir, "bin");
  mkdirSync(binDir, { recursive: true });

  // POSIX：解析自身真实路径（兼容 symlink），把 vendor/bin 前置到 PATH
  const sh = `#!/bin/sh
# maou launcher (bundle) —— 自解析根目录，不依赖 CWD
set -e
src="$0"
while [ -h "$src" ]; do
  dir=$(cd -P "$(dirname "$src")" && pwd)
  src=$(readlink "$src")
  case "$src" in /*) ;; *) src="$dir/$src" ;; esac
done
ROOT=$(cd -P "$(dirname "$src")/.." && pwd)

NODE="\${MAOU_NODE:-}"
if [ -z "$NODE" ] && [ -x "$ROOT/../../runtime/node/bin/node" ]; then
  NODE="$ROOT/../../runtime/node/bin/node"
fi
[ -z "$NODE" ] && NODE=node
command -v "$NODE" >/dev/null 2>&1 || {
  echo "maou: 需要 Node.js >= 20（未在 PATH 找到 node）" >&2
  exit 1
}

PATH="$ROOT/vendor/bin:$PATH"
export PATH
export MAOU_BUNDLE_ROOT="$ROOT"
exec "$NODE" "$ROOT/dist/index.js" "$@"
`;
  writeFileSync(join(binDir, "maou"), sh, "utf-8");
  if (!IS_WIN) {
    // 宿主是 POSIX 才能打 exec 位；Windows 宿主交叉打 POSIX 包的场景本项目不支持
    try {
      chmodSync(join(binDir, "maou"), 0o755);
    } catch {
      /* ignore */
    }
  }

  const cmd = `@echo off
setlocal
set "ROOT=%~dp0.."
set "NODE=%MAOU_NODE%"
if "%NODE%"=="" if exist "%ROOT%\\..\\..\\runtime\\node\\node.exe" set "NODE=%ROOT%\\..\\..\\runtime\\node\\node.exe"
if "%NODE%"=="" set "NODE=node"
set "PATH=%ROOT%\\vendor\\bin;%PATH%"
set "MAOU_BUNDLE_ROOT=%ROOT%"
"%NODE%" "%ROOT%\\dist\\index.js" %*
exit /b %ERRORLEVEL%
`;
  writeFileSync(join(binDir, "maou.cmd"), cmd, "utf-8");

  // PowerShell 里 .cmd 参数转义偶尔坑，附一个 .ps1
  const ps1 = `$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Node = if ($env:MAOU_NODE) { $env:MAOU_NODE } else { "node" }
$env:PATH = "$Root\\vendor\\bin;$env:PATH"
$env:MAOU_BUNDLE_ROOT = $Root
& $Node "$Root\\dist\\index.js" @args
exit $LASTEXITCODE
`;
  writeFileSync(join(binDir, "maou.ps1"), ps1, "utf-8");
  log("launchers: bin/maou, bin/maou.cmd, bin/maou.ps1");
}

function stepManifest(bundleDir, meta) {
  const manifest = {
    schema: 1,
    product: "maou",
    version: meta.version,
    channel: CHANNEL,
    commit: meta.commit,
    branch: meta.branch,
    platform: PLATFORM_TAG,
    builtAt: new Date().toISOString(),
    repo: process.env.MAOU_NATIVE_REPO || "little-house-studio/maou-sdk",
    releaseTag: opt("tag", CHANNEL === "stable" ? `v${meta.version}` : "bundle-dev"),
    node: process.versions.node,
    bundled: {
      terminalEngine: meta.engine,
      tui: meta.vendor.tui ?? null,
      dcg: meta.vendor.dcg ?? null,
      rg: meta.vendor.rg ?? null,
      sqry: meta.vendor.sqry ?? null,
      // ddgr 是 Python 脚本：包里有 ≠ 用户机器上能跑（要 Python ≥ 3.6）
      ddgr: meta.vendor.ddgr ?? null,
    },
  };
  writeFileSync(
    join(bundleDir, "RELEASE.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf-8",
  );
  return manifest;
}

/**
 * 打包：unix → tar.gz，windows → zip。
 *
 * 资产名**不带版本**（`maou-<platform>.tar.gz`）—— 安装器/更新器可以在不预先
 * 知道版本号的情况下直接拼出下载地址；版本信息在包内 RELEASE.json 和
 * Release 级 manifest.json 里。解压出来的目录**带版本**，便于多版本并存与回滚。
 */
function stepArchive(bundleDir, bundleName, archiveBase) {
  if (NO_ARCHIVE) {
    log("--no-archive：跳过打包");
    return null;
  }
  const parent = dirname(bundleDir);
  if (TARGET_IS_WIN) {
    const out = join(OUT_DIR, `${archiveBase}.zip`);
    rmSync(out, { force: true });
    // 7z（GH runner 自带）→ bsdtar → Compress-Archive
    const has7z = run("7z", ["i"], { capture: true }).ok;
    if (has7z) {
      const r = run("7z", ["a", "-tzip", "-mx=6", out, bundleName], { cwd: parent });
      if (r.ok && existsSync(out)) return out;
    }
    const tarZip = run("tar", ["-a", "-c", "-f", out, bundleName], { cwd: parent });
    if (tarZip.ok && existsSync(out)) return out;
    const ps = run("powershell", [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path '${bundleDir}' -DestinationPath '${out}' -Force`,
    ]);
    if (ps.ok && existsSync(out)) return out;
    die("zip 打包失败（7z / tar / Compress-Archive 都不可用）");
  }
  const out = join(OUT_DIR, `${archiveBase}.tar.gz`);
  rmSync(out, { force: true });
  const r = run("tar", ["-czf", out, "-C", parent, bundleName]);
  if (!r.ok || !existsSync(out)) die("tar 打包失败");
  return out;
}

// ──────────────────────────── main ──────────────────────────

async function main() {
  log(
    `目标 ${PLATFORM_TAG} · triple ${TRIPLE}` +
      (IS_CROSS ? ` · 交叉打包（宿主 ${platform()}-${arch()}）` : ""),
  );

  stepBuildJs();
  stepEnsureTerminalEngine();

  const version = cliVersion();
  const { commit, branch } = gitInfo();
  const bundleName = `maou-${version}-${PLATFORM_TAG}`;
  const stageDir = join(OUT_DIR, "stage");
  const bundleDir = join(stageDir, bundleName);

  mkdirSync(OUT_DIR, { recursive: true });
  rmrf(stageDir);
  mkdirSync(stageDir, { recursive: true });

  stepDeploy(bundleDir);
  stepInjectNatives(bundleDir);
  const engine = stepVerifyEngine(bundleDir);
  stepCopyScripts(bundleDir);
  const vendor = stepVendorBinaries(bundleDir);
  stepLaunchers(bundleDir);
  const manifest = stepManifest(bundleDir, { version, commit, branch, engine, vendor });

  const archiveBase = `maou-${PLATFORM_TAG}`;
  const archive = stepArchive(bundleDir, bundleName, archiveBase);
  if (archive) {
    const sum = await sha256File(archive);
    const assetName = `${archiveBase}${TARGET_IS_WIN ? ".zip" : ".tar.gz"}`;
    writeFileSync(`${archive}.sha256`, `${sum}  ${assetName}\n`, "utf-8");

    // 单平台 manifest；CI 的 publish job 会把各平台合并成 Release 级 manifest.json
    writeFileSync(
      join(OUT_DIR, `manifest-${PLATFORM_TAG}.json`),
      JSON.stringify(
        {
          platform: PLATFORM_TAG,
          version: manifest.version,
          channel: manifest.channel,
          commit: manifest.commit,
          releaseTag: manifest.releaseTag,
          asset: assetName,
          dirName: bundleName,
          sha256: sum,
          size: sizeOf(archive),
          builtAt: manifest.builtAt,
          bundled: manifest.bundled,
        },
        null,
        2,
      ) + "\n",
      "utf-8",
    );

    log(`归档: ${archive} (${(sizeOf(archive) / 1024 / 1024).toFixed(1)} MB)`);
    log(`sha256: ${sum}`);
  }

  if (!KEEP_STAGE && archive) {
    // 归档已产出，stage 目录只是中间物
    log("清理 stage（--keep-stage 可保留用于本地试跑）");
    rmrf(stageDir);
  } else {
    log(`bundle 目录: ${bundleDir}`);
  }

  log("");
  log("完成。");
  log(`  版本 ${manifest.version} / ${manifest.channel} / ${manifest.commit.slice(0, 7)}`);
  const mark = (v) => (v ? "✓" : "✗");
  const b = manifest.bundled;
  log(
    `  内置: engine=${mark(b.terminalEngine)} tui=${mark(b.tui)} ` +
      `dcg=${mark(b.dcg)} rg=${mark(b.rg)} sqry=${mark(b.sqry)} ddgr=${mark(b.ddgr)}`,
  );
  if (b.ddgr) log("  注：ddgr 是 Python 脚本，用户机器需有 Python ≥ 3.6 才生效");
}

main().catch((e) => {
  die(e instanceof Error ? (e.stack ?? e.message) : String(e));
});
