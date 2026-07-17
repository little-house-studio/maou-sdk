/**
 * maou update —— Git 拉取 + 本机构建（clone 安装用户）。
 *
 * 机制：
 *   1. findSdkGitRoot（.git + pnpm-workspace）
 *   2. --check：fetch + ahead/behind，不要求干净工作区，不 pull/build
 *   3. 默认：干净工作区 → fetch → ff-only pull（若 behind）→ build-native
 *   4. --force：stash -u → pull → build（提示自行 stash pop）
 *   5. --no-build：只 pull 不构建
 *   6. 不杀 TUI / 不自动重启
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { platform } from "node:os";
import { findSdkGitRoot } from "./repo-root.js";

export interface UpdateOptions {
  force?: boolean;
  keepTarget?: boolean;
  check?: boolean;
  /** 只 git，不跑 build-native */
  noBuild?: boolean;
}

function log(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

function run(
  cmd: string,
  args: string[],
  cwd: string,
): { ok: boolean; stdout: string; stderr: string; status: number | null } {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: "utf-8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  return {
    ok: r.status === 0,
    stdout: (r.stdout ?? "").trim(),
    stderr: (r.stderr ?? "").trim(),
    status: r.status,
  };
}

function runInherit(cmd: string, args: string[], cwd: string): boolean {
  const r = spawnSync(cmd, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
    // Windows: 仅对 .ps1 走 powershell，不要全局 shell:true 以免拆坏参数
  });
  return r.status === 0;
}

function git(cwd: string, args: string[]) {
  return run("git", args, cwd);
}

export async function runUpdate(opts: UpdateOptions = {}): Promise<boolean> {
  log("══════════════════════════════════════");
  log("  Maou Update · Git 拉取 + 本机构建");
  log("══════════════════════════════════════");

  const root = findSdkGitRoot();
  if (!root) {
    log("❌ 找不到 maou-sdk Git 仓库根（需同时有 .git 与 pnpm-workspace.yaml）。");
    log("   仅支持：git clone 安装的源码树。");
    log("   确认 maou 包装脚本指向该 monorepo 的 cli/dist/index.js。");
    return false;
  }
  log(`仓库: ${root}`);

  if (!git(root, ["--version"]).ok) {
    log("❌ 需要 git 在 PATH 中");
    return false;
  }

  const branch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).stdout || "?";
  const headShort = git(root, ["rev-parse", "--short", "HEAD"]).stdout || "?";
  const remoteUrl =
    git(root, ["config", "--get", "remote.origin.url"]).stdout ||
    git(root, ["remote", "get-url", "origin"]).stdout ||
    "(no origin)";
  log(`分支: ${branch} @ ${headShort}`);
  log(`远程: ${remoteUrl}`);

  if (branch === "HEAD") {
    log("△ Detached HEAD — pull 可能失败；请先 checkout 分支");
  }

  const status = git(root, ["status", "--porcelain"]);
  const dirty = status.stdout.length > 0;

  // --check：允许脏工作区，只 fetch + 比较
  if (opts.check) {
    log("[update] git fetch（--check）…");
    if (!runInherit("git", ["fetch", "--prune"], root)) {
      log("❌ git fetch 失败");
      return false;
    }
    reportAheadBehind(root);
    if (dirty) log("△ 工作区有本地改动（--check 未修改任何文件）");
    log("（--check：不 pull、不构建）");
    return true;
  }

  if (dirty && !opts.force) {
    log("❌ 工作区有未提交改动，拒绝覆盖。");
    log("   提交/贮藏后重试，或：maou update --force（git stash -u，需自行 stash pop）");
    log(status.stdout.slice(0, 800));
    return false;
  }

  log("[update] git fetch…");
  if (!runInherit("git", ["fetch", "--prune"], root)) {
    log("❌ git fetch 失败（网络 / 权限 / remote）");
    return false;
  }

  const ab = reportAheadBehind(root);

  if (dirty && opts.force) {
    log("[update] --force: git stash push -u -m maou-update-auto");
    if (!runInherit("git", ["stash", "push", "-u", "-m", "maou-update-auto"], root)) {
      log("❌ stash 失败");
      return false;
    }
    log("  完成后如需恢复本地改动: git stash pop");
  }

  // 仅 behind 时 pull；ahead-only 拒绝 ff-only 空转误导
  if (ab.upstream) {
    if (ab.behind === 0 && ab.ahead === 0) {
      log("✓ 已与 upstream 同步");
    } else if (ab.behind > 0) {
      log(`[update] git pull --ff-only（落后 ${ab.behind} 提交）…`);
      if (!runInherit("git", ["pull", "--ff-only"], root)) {
        log("❌ git pull --ff-only 失败（历史分叉时需手动处理）");
        return false;
      }
    } else if (ab.ahead > 0 && ab.behind === 0) {
      log(`△ 本地超前 upstream ${ab.ahead} 提交 — 跳过 pull（不会 push）`);
    }
  } else {
    log("[update] 无 upstream，尝试 git pull --ff-only…");
    if (!runInherit("git", ["pull", "--ff-only"], root)) {
      log("△ pull 失败（可设置: git branch -u origin/<branch>）");
      // 无 upstream 时不强制失败，继续 build 当前树
    }
  }

  const after = git(root, ["rev-parse", "--short", "HEAD"]).stdout || "?";
  log(`[update] HEAD: ${after}`);

  if (opts.noBuild) {
    log("（--no-build：跳过构建）");
    log("✓ Git 步骤完成。若需构建: 去掉 --no-build 重新 maou update");
    return true;
  }

  // build
  const isWin = platform() === "win32";
  let buildOk = false;
  if (isWin) {
    const ps1 = join(root, "scripts", "build-native.ps1");
    if (!existsSync(ps1)) {
      log("❌ 缺少 scripts/build-native.ps1");
      return false;
    }
    const args = ["-ExecutionPolicy", "Bypass", "-File", ps1];
    if (opts.keepTarget) args.push("-KeepTarget");
    log(`[update] build: build-native.ps1`);
    buildOk = runInherit("powershell", args, root);
  } else {
    const sh = join(root, "scripts", "build-native.sh");
    if (!existsSync(sh)) {
      log("❌ 缺少 scripts/build-native.sh");
      return false;
    }
    const args = [sh];
    if (opts.keepTarget) args.push("--keep-target");
    log(`[update] build: build-native.sh`);
    buildOk = runInherit("bash", args, root);
  }

  if (!buildOk) {
    log("❌ 构建失败。");
    return false;
  }

  const dist = join(root, "cli", "dist", "index.js");
  if (!existsSync(dist)) {
    log("❌ 构建后仍无 cli/dist/index.js（Core 未就绪）");
    return false;
  }

  // 轻量 doctor 摘要（不 autoInstall）
  log("");
  log("[update] 构建后检查…");
  try {
    const { ensureDependencies } = await import("./deps-check.js");
    const dep = await ensureDependencies({ autoInstall: false, quiet: true });
    log(
      `  Core: ${dep.tiers.core ? "✓" : "✗"}  Terminal: ${dep.tiers.terminal ? "✓" : "△"}  dcg: ${dep.tiers.dcg ? "✓" : "△"}  sqry: ${dep.tiers.sqry ? "✓" : "△"}`,
    );
    if (!dep.tiers.core) {
      log("❌ Core 仍未就绪，请 maou doctor");
      return false;
    }
  } catch (e) {
    log(`  doctor 摘要跳过: ${e}`);
  }

  log("");
  log("✓ 更新完成。");
  log("  请退出正在运行的 maou coding，再执行：");
  log("    maou doctor");
  log("    maou coding");
  log("  （不会自动杀进程/重启 TUI。）");
  if (opts.force && dirty) log("  若用了 --force：git stash pop 恢复本地改动");
  log("");
  return true;
}

function reportAheadBehind(root: string): {
  upstream: string | null;
  ahead: number;
  behind: number;
} {
  const up = git(root, ["rev-parse", "--abbrev-ref", "@{u}"]);
  if (!up.ok || !up.stdout) {
    log("△ 未设置 upstream（git branch -u origin/<branch>）");
    return { upstream: null, ahead: 0, behind: 0 };
  }
  const counts = git(root, ["rev-list", "--left-right", "--count", "HEAD...@{u}"]);
  // format: "<ahead>\t<behind>" for left-right HEAD...@{u}
  let ahead = 0;
  let behind = 0;
  if (counts.ok) {
    const parts = counts.stdout.split(/\s+/);
    ahead = parseInt(parts[0] ?? "0", 10) || 0;
    behind = parseInt(parts[1] ?? "0", 10) || 0;
  }
  if (ahead === 0 && behind === 0) {
    log(`✓ 与 ${up.stdout} 同步`);
  } else {
    log(`  相对 ${up.stdout}: 本地超前 ${ahead} / 落后 ${behind}`);
  }
  return { upstream: up.stdout, ahead, behind };
}

/** 测试用 */
export { findSdkGitRoot as findSdkRepoRoot };
