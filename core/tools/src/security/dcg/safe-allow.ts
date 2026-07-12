/**
 * Maou 对 DCG deny 的「安全操作放行」层。
 *
 * DCG 会拦许多开发中合法操作（rm -rf dist、git restore 单文件等）。
 * 本模块在 **DCG 已判定 deny 之后** 做二次审查：
 *   - 命中安全白名单 → 覆盖为 allow（记录 reason）
 *   - 否则保持 deny
 *
 * 设计原则：
 *   1. 只放行「可重建 / 局部 / 明确意图」的操作
 *   2. 路径含 ..、绝对路径到非 tmp、源码目录、.git 等 → 不放行
 *   3. 整树 discard（git restore .）仍拒绝
 */

export interface MaouSafeAllowHit {
  id: string;
  reason: string;
}

/** 可安全 rm -rf 的目录/产物名（整段 path 的最后一级，或整路径等于该名） */
const SAFE_RM_RF_BASENAMES = new Set([
  "dist",
  "build",
  "out",
  "output",
  "target",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  ".parcel-cache",
  ".vite",
  ".eslintcache",
  "node_modules",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".tox",
  "htmlcov",
  "storybook-static",
  ".output",
  "tmp",
  "temp",
  ".tmp",
  ".temp",
]);

function normalizeCmd(cmd: string): string {
  return cmd.trim().replace(/\s+/g, " ");
}

/** 拆 shell 风格参数（简化：不考虑复杂引号嵌套，够用日常 agent 命令） */
function tokenize(cmd: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cmd)) !== null) {
    tokens.push(m[1] ?? m[2] ?? m[3] ?? "");
  }
  return tokens;
}

function isSafeRmRfTarget(raw: string): boolean {
  let p = raw.trim();
  if (!p || p === "." || p === ".." || p === "*" || p === "./*" || p.includes("*")) {
    return false;
  }
  // 拒绝路径穿越与家目录/系统根
  if (p.includes("..")) return false;
  if (p === "/" || p === "~" || p.startsWith("~/") || p.startsWith("~\\")) return false;
  // 绝对路径：仅 /tmp /var/tmp
  if (p.startsWith("/")) {
    return /^\/(tmp|var\/tmp)(\/|$)/.test(p);
  }
  p = p.replace(/^\.\//, "");
  const parts = p.split(/[/\\]+/).filter(Boolean);
  if (parts.length === 0) return false;
  // 任何一段是 .git → 拒绝
  if (parts.some((seg) => seg.toLowerCase() === ".git")) return false;

  const base = parts[parts.length - 1]!.toLowerCase();
  // 最后一级是已知可重建产物/依赖目录 → 允许（含 monorepo 深路径 core/tools/dist）
  if (SAFE_RM_RF_BASENAMES.has(base)) return true;
  // node_modules 下任意子路径（缓存等）
  if (parts.some((seg) => seg.toLowerCase() === "node_modules")) return true;
  if (base.endsWith(".egg-info")) return true;
  return false;
}

function isRmWithRf(tokens: string[]): boolean {
  if (tokens[0] !== "rm") return false;
  // 收集所有以 - 开头的 flag
  const flags = tokens.slice(1).filter((t) => t.startsWith("-") && !t.startsWith("--"));
  const joined = flags.join("");
  // 需要同时有 r/R 与 f
  const hasR = /[rR]/.test(joined);
  const hasF = /f/.test(joined);
  return hasR && hasF;
}

function rmRfTargets(tokens: string[]): string[] {
  return tokens.slice(1).filter((t) => !t.startsWith("-"));
}

/** 是否「仅还原暂存区」的 restore（安全） */
function isStagedOnlyRestore(cmd: string): boolean {
  return /\bgit\s+restore\b/.test(cmd) && /--staged\b/.test(cmd) && !/--worktree\b/.test(cmd);
}

/**
 * 单文件/少量文件的 worktree restore/checkout discard。
 * 拒绝：`.`、`*`、无路径、路径含 `..`、一次超过 20 个文件
 */
function isSafeGitDiscardPaths(cmd: string): MaouSafeAllowHit | null {
  const c = normalizeCmd(cmd);

  // git restore [--source=...] [--worktree] [--] paths...
  let m = c.match(/^git\s+restore(?:\s+--source=\S+)?(?:\s+--worktree)?(?:\s+--staged)?(?:\s+--)?\s+(.+)$/);
  if (m && !isStagedOnlyRestore(c)) {
    // 若带 --staged 且 --worktree，仍算 worktree 改动
    const paths = tokenize(m[1]!);
    if (pathsSafeForDiscard(paths)) {
      return {
        id: "maou.allow:git-restore-paths",
        reason: "允许丢弃指定文件的未提交改动（非整树 .）；可用 git 历史/重做恢复工作流",
      };
    }
  }

  // git checkout -- paths  / git checkout HEAD -- paths
  m = c.match(/^git\s+checkout(?:\s+HEAD)?\s+--\s+(.+)$/);
  if (m) {
    const paths = tokenize(m[1]!);
    if (pathsSafeForDiscard(paths)) {
      return {
        id: "maou.allow:git-checkout-discard-paths",
        reason: "允许 checkout -- 丢弃指定文件的本地修改（非整树）",
      };
    }
  }

  return null;
}

function pathsSafeForDiscard(paths: string[]): boolean {
  if (paths.length === 0 || paths.length > 20) return false;
  for (const p of paths) {
    if (!p || p === "." || p === ".." || p === "*" || p.includes("*")) return false;
    if (p.includes("..")) return false;
    if (p === "/" || p.startsWith("~/")) return false;
  }
  return true;
}

/**
 * 检查命令是否属于「DCG 会误伤、但开发中安全且需要」的放行集合。
 */
export function matchMaouSafeAllow(command: string): MaouSafeAllowHit | null {
  const cmd = normalizeCmd(command);
  if (!cmd) return null;

  // ── rm -rf 仅产物/依赖目录 ─────────────────────────────────
  const tokens = tokenize(cmd);
  // 允许前缀：yes | rm -rf ...
  let rmTokens = tokens;
  if (tokens[0] === "yes" && tokens[1] === "|" && tokens[2] === "rm") {
    rmTokens = tokens.slice(2);
  }
  if (isRmWithRf(rmTokens)) {
    const targets = rmRfTargets(rmTokens);
    if (targets.length > 0 && targets.length <= 15 && targets.every(isSafeRmRfTarget)) {
      return {
        id: "maou.allow:rm-rf-artifacts",
        reason: `允许删除可重建产物/依赖目录：${targets.join(", ")}`,
      };
    }
  }

  // ── find 仅在产物目录下 -delete ────────────────────────────
  // find dist -type f -delete / find ./coverage ... -delete
  if (/^find\s+/.test(cmd) && /\s-delete\b/.test(cmd)) {
    const afterFind = cmd.replace(/^find\s+/, "");
    const first = tokenize(afterFind)[0] ?? "";
    if (first && isSafeRmRfTarget(first)) {
      return {
        id: "maou.allow:find-delete-under-artifact",
        reason: `允许在产物目录内 find -delete：${first}`,
      };
    }
  }

  // ── git 局部 discard ───────────────────────────────────────
  const discard = isSafeGitDiscardPaths(cmd);
  if (discard) return discard;

  // ── git branch -D <name> 本地分支 ──────────────────────────
  // 仅单分支名，无远程
  if (/^git\s+branch\s+-D\s+[A-Za-z0-9._/+\-@]+$/.test(cmd) && !cmd.includes("..")) {
    return {
      id: "maou.allow:git-branch-force-delete-local",
      reason: "允许强制删除单个本地分支（-D）；远程删除仍受其它规则约束",
    };
  }

  // ── git stash drop [stash@{n}] ─────────────────────────────
  if (/^git\s+stash\s+drop(?:\s+stash@\{\d+\})?$/.test(cmd)) {
    return {
      id: "maou.allow:git-stash-drop-one",
      reason: "允许丢弃一条 stash（stash drop）；stash clear 仍拒绝",
    };
  }

  // ── git push --force-with-lease 已是 DCG allow；force 仍拒 ──

  // ── git clean：只放行 dry-run ────────────────────────────────
  if (/^git\s+clean\s+(-[a-zA-Z]*n[a-zA-Z]*|--dry-run)\b/.test(cmd)) {
    return {
      id: "maou.allow:git-clean-dry-run",
      reason: "允许 git clean dry-run 预览",
    };
  }

  return null;
}

/**
 * DCG deny 后尝试安全放行。
 * @returns allow 命中信息；null 表示仍应 deny
 */
export function tryOverrideDcgDeny(command: string): MaouSafeAllowHit | null {
  return matchMaouSafeAllow(command);
}
