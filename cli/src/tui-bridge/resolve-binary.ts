/**
 * 定位 / 确保 maou-tui-ratatui 二进制（跨平台）。
 *
 * 搜索顺序：
 *   1. MAOU_TUI_BIN / 显式路径
 *   2. ~/.maou/bin（安装后稳定路径）
 *   3. CLI 包旁 tui-ratatui/target/{release,debug}
 *   4. monorepo 根 cli/tui-ratatui/target/…
 *   5. cwd 下 target
 *   6. PATH
 *
 * Windows：优先 .exe；mac/Linux 无后缀。
 * 无二进制且本机有 cargo 时，可 tryBuild 一次（不改变 Windows 默认 Ink 策略）。
 */

import {
  existsSync,
  mkdirSync,
  copyFileSync,
  chmodSync,
  constants as fsConstants,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

function isWin(): boolean {
  return process.platform === "win32";
}

/** 当前平台主文件名 */
export function ratatuiBinaryName(): string {
  return isWin() ? "maou-tui-ratatui.exe" : "maou-tui-ratatui";
}

/** 可执行则 true（存在 + 非目录） */
function isRunnable(p: string): boolean {
  try {
    if (!existsSync(p)) return false;
    // Windows 不强制 X_OK；POSIX 尽量可读可执行
    if (!isWin()) {
      // accessSync 在部分 FS 上对 symlink 挑剔，存在即接受
    }
    return true;
  } catch {
    return false;
  }
}

function packageCliRoot(): string {
  // dist/tui-bridge → cli；src/tui-bridge → cli
  return resolve(__dirname, "../..");
}

function findMonorepoCliRoot(from: string): string | null {
  let dir = from;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "cli", "tui-ratatui", "Cargo.toml");
    const alt = join(dir, "tui-ratatui", "Cargo.toml");
    if (existsSync(candidate)) return join(dir, "cli");
    if (existsSync(alt) && existsSync(join(dir, "package.json"))) {
      // already at cli/
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function userBinDir(): string {
  return join(homedir(), ".maou", "bin");
}

export function userBinPath(): string {
  return join(userBinDir(), ratatuiBinaryName());
}

/** 候选目录列表（去重） */
function searchDirs(): string[] {
  const cliRoot = packageCliRoot();
  const monoCli = findMonorepoCliRoot(cliRoot) ?? findMonorepoCliRoot(process.cwd());
  const dirs = [
    userBinDir(),
    join(cliRoot, "tui-ratatui", "target", "release"),
    join(cliRoot, "tui-ratatui", "target", "debug"),
    monoCli ? join(monoCli, "tui-ratatui", "target", "release") : "",
    monoCli ? join(monoCli, "tui-ratatui", "target", "debug") : "",
    join(process.cwd(), "tui-ratatui", "target", "release"),
    join(process.cwd(), "tui-ratatui", "target", "debug"),
    join(process.cwd(), "cli", "tui-ratatui", "target", "release"),
    join(process.cwd(), "cli", "tui-ratatui", "target", "debug"),
  ].filter(Boolean) as string[];
  return [...new Set(dirs.map((d) => resolve(d)))];
}

/** 解析已存在的二进制；找不到返回 null */
export function resolveRatatuiBinary(explicit?: string): string | null {
  // 显式路径：只认这一条（错误路径不静默落到别处）
  if (explicit != null && explicit !== "") {
    return isRunnable(explicit) ? explicit : null;
  }
  const envBin = process.env.MAOU_TUI_BIN?.trim();
  if (envBin && isRunnable(envBin)) return envBin;

  const names = isWin()
    ? ["maou-tui-ratatui.exe", "maou-tui-ratatui"]
    : ["maou-tui-ratatui", "maou-tui-ratatui.exe"];

  for (const d of searchDirs()) {
    for (const n of names) {
      const p = join(d, n);
      if (isRunnable(p)) return p;
    }
  }

  // PATH
  const which = spawnSync(isWin() ? "where" : "which", [ratatuiBinaryName()], {
    encoding: "utf-8",
    windowsHide: true,
  });
  if (which.status === 0) {
    const line = (which.stdout ?? "").split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    if (line && isRunnable(line)) return line;
  }

  return null;
}

function resolveCargo(): string | null {
  const names = isWin() ? ["cargo.exe", "cargo"] : ["cargo"];
  for (const n of names) {
    const w = spawnSync(isWin() ? "where" : "which", [n], {
      encoding: "utf-8",
      windowsHide: true,
    });
    if (w.status === 0) {
      const line = (w.stdout ?? "").split(/\r?\n/).map((s) => s.trim()).find(Boolean);
      if (line) return line;
    }
  }
  const homeCargo = join(
    homedir(),
    ".cargo",
    "bin",
    isWin() ? "cargo.exe" : "cargo",
  );
  if (existsSync(homeCargo)) return homeCargo;
  return null;
}

/** Cargo.toml 所在目录 */
function tuiManifestDir(): string | null {
  const cliRoot = packageCliRoot();
  const monoCli = findMonorepoCliRoot(cliRoot) ?? findMonorepoCliRoot(process.cwd());
  const candidates = [
    join(cliRoot, "tui-ratatui"),
    monoCli ? join(monoCli, "tui-ratatui") : "",
  ].filter(Boolean) as string[];
  for (const d of candidates) {
    if (existsSync(join(d, "Cargo.toml"))) return d;
  }
  return null;
}

/**
 * 编译 release 并安装到 ~/.maou/bin（若可能）。
 * @returns 二进制路径或 null
 */
export function tryBuildRatatuiBinary(opts?: {
  log?: (msg: string) => void;
}): string | null {
  const log = opts?.log ?? ((m: string) => process.stderr.write(`${m}\n`));
  const cargo = resolveCargo();
  if (!cargo) {
    log("[maou] 未找到 cargo，无法自动编译 maou-tui-ratatui");
    return null;
  }
  const dir = tuiManifestDir();
  if (!dir) {
    log("[maou] 未找到 tui-ratatui/Cargo.toml，跳过自动编译");
    return null;
  }
  log(`[maou] 正在编译 maou-tui-ratatui（release）…\n  cargo=${cargo}\n  dir=${dir}`);
  const r = spawnSync(
    cargo,
    ["build", "--release", "--manifest-path", join(dir, "Cargo.toml")],
    {
      cwd: dir,
      stdio: "inherit",
      env: process.env,
      windowsHide: true,
    },
  );
  if (r.status !== 0) {
    log(`[maou] cargo build 失败（exit ${r.status ?? "?"}）`);
    return null;
  }
  const built = join(dir, "target", "release", ratatuiBinaryName());
  if (!isRunnable(built)) {
    // Windows 有时只产出无后缀名
    const alt = join(dir, "target", "release", "maou-tui-ratatui");
    if (isRunnable(alt)) return installToUserBin(alt, log);
    log(`[maou] 编译完成但找不到 ${built}`);
    return null;
  }
  return installToUserBin(built, log);
}

function installToUserBin(src: string, log: (m: string) => void): string {
  try {
    const dest = userBinPath();
    mkdirSync(userBinDir(), { recursive: true });
    copyFileSync(src, dest);
    if (!isWin()) {
      try {
        chmodSync(dest, fsConstants.S_IRWXU | fsConstants.S_IRGRP | fsConstants.S_IXGRP | fsConstants.S_IROTH | fsConstants.S_IXOTH);
      } catch {
        /* ignore */
      }
    }
    log(`[maou] 已安装 TUI 二进制 → ${dest}`);
    return dest;
  } catch (e) {
    log(
      `[maou] 复制到 ~/.maou/bin 失败，直接使用编译产物：${e instanceof Error ? e.message : e}`,
    );
    return src;
  }
}

/**
 * 解析或尝试编译。
 * MAOU_TUI_NO_BUILD=1 时不自动编译。
 */
export function ensureRatatuiBinary(opts?: {
  explicit?: string;
  tryBuild?: boolean;
  log?: (msg: string) => void;
}): string | null {
  const found = resolveRatatuiBinary(opts?.explicit);
  if (found) return found;
  const allowBuild =
    opts?.tryBuild !== false && process.env.MAOU_TUI_NO_BUILD !== "1";
  if (!allowBuild) return null;
  return tryBuildRatatuiBinary({ log: opts?.log });
}
