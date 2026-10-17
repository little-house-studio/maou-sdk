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
 *   2. 路径含 ..、通配、home/根顶层、源码树根、.git → 不放行
 *   3. 整树 discard（git restore .）仍拒绝
 */

import { homedir } from "node:os";

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

function normSlash(p: string): string {
  let s = p.trim().replace(/\\/g, "/");
  if (s.length > 1) s = s.replace(/\/+$/, "");
  return s;
}

function expandUserPath(raw: string): string {
  const p = raw.trim();
  const home = normSlash(homedir());
  if (p === "~" || p === "$HOME") return home;
  if (p.startsWith("~/") || p.startsWith("~\\")) return normSlash(home + "/" + p.slice(2));
  if (p.startsWith("$HOME/") || p.startsWith("$HOME\\")) {
    return normSlash(home + "/" + p.slice(6));
  }
  return normSlash(p);
}

/** home 之下的路径段；不是该 home 下则 null。 */
function restUnderHome(abs: string): string[] | null {
  const home = normSlash(homedir());
  const n = normSlash(abs);
  if (n === home) return [];
  if (n.startsWith(`${home}/`)) {
    return n.slice(home.length + 1).split("/").filter(Boolean);
  }
  return null;
}

/** `/Users/<name>/...` 或 `/home/<name>/...` 在用户目录之后的段。 */
function restUnderHomeShaped(abs: string): string[] | null {
  const n = normSlash(abs);
  const m = n.match(/^\/(?:Users|home)\/([^/]+)(?:\/(.*))?$/);
  if (!m) return null;
  return (m[2] || "").split("/").filter(Boolean);
}

function restAfterHome(abs: string): string[] | null {
  return restUnderHome(abs) ?? restUnderHomeShaped(abs);
}

function isSafeRmRfTarget(raw: string): boolean {
  let p = raw.trim();
  if (!p || p === "." || p === ".." || p === "*" || p === "./*" || p.includes("*")) {
    return false;
  }
  if (p.includes("..")) return false;
  if (p === "/" || p === "~" || p === "$HOME") return false;
  const expanded = expandUserPath(p);
  if (expanded === "/" ) return false;
  if (expanded.startsWith("/")) {
    return /^\/(tmp|var\/tmp)(\/|$)/.test(expanded);
  }
  p = expanded.replace(/^\.\//, "");
  const parts = p.split(/[/\\]+/).filter(Boolean);
  if (parts.length === 0) return false;
  if (parts.some((seg) => seg.toLowerCase() === ".git")) return false;

  const base = parts[parts.length - 1]!.toLowerCase();
  if (SAFE_RM_RF_BASENAMES.has(base)) return true;
  if (parts.some((seg) => seg.toLowerCase() === "node_modules")) return true;
  if (base.endsWith(".egg-info")) return true;
  return false;
}

const DISPOSABLE_FIRST = new Set([
  "testdata",
  "tmp",
  "temp",
  "scratch",
  "fixtures",
  ".maou",
  ".cache",
]);

const SOURCE_FIRST = new Set([
  "src",
  "lib",
  "app",
  "apps",
  "core",
  "cli",
  "packages",
  "agent-products",
  "docs",
  "include",
  "source",
]);

function isDisposableSeg(seg: string): boolean {
  const s = seg.toLowerCase();
  if (SAFE_RM_RF_BASENAMES.has(s)) return true;
  if (s.endsWith(".egg-info")) return true;
  return /(?:^|[._-])(tmp|temp|cache|out|build|scratch|probe|screenshot)s?$/.test(s);
}

/** 具体子路径：相对临时/产物树，或 home 下 >=2 段且无通配/穿越的绝对路径 */
function isConcreteProjectSubpath(raw: string): boolean {
  const p = raw.trim();
  if (!p || p === "." || p === ".." || p.includes("*") || p.includes("..")) return false;
  if (p === "/" || p === "~" || p === "$HOME") return false;

  const looksAbs =
    p.startsWith("/") ||
    p.startsWith("~") ||
    p.startsWith("$HOME/") ||
    p.startsWith("$HOME\\");
  if (looksAbs) {
    const expanded = expandUserPath(p);
    const rest = restAfterHome(expanded);
    if (!rest || rest.length < 2) return false;
    if (rest.some((seg) => seg.toLowerCase() === ".git")) return false;
    return true;
  }

  let rel = p.replace(/^\.\//, "");
  const parts = rel.split(/[/\\]+/).filter(Boolean);
  if (parts.length < 2) return false;
  if (parts.some((seg) => seg.toLowerCase() === ".git")) return false;
  const first = parts[0]!.toLowerCase();
  const last = parts[parts.length - 1]!.toLowerCase();
  if (SAFE_RM_RF_BASENAMES.has(first) || DISPOSABLE_FIRST.has(first)) return true;
  if (isDisposableSeg(last)) return true;
  if (SOURCE_FIRST.has(first)) return false;
  return false;
}

function isRmWithRf(tokens: string[]): boolean {
  const head = tokens[0] ?? "";
  if (head !== "rm" && !/(?:^|\/)rm$/.test(head)) return false;
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
    if (targets.length > 0 && targets.length <= 15) {
      const allArtifacts = targets.every(isSafeRmRfTarget);
      const allConcrete = targets.every((t) => isSafeRmRfTarget(t) || isConcreteProjectSubpath(t));
      if (allArtifacts) {
        return {
          id: "maou.allow:rm-rf-artifacts",
          reason: `允许删除可重建产物/依赖目录：${targets.join(", ")}`,
        };
      }
      if (allConcrete) {
        return {
          id: "maou.allow:rm-rf-concrete-subpath",
          reason: `允许删除项目内具体临时/产物子路径：${targets.join(", ")}`,
        };
      }
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

  // ── 纯文本处理 awk/gawk（含 printf %% 合法转义）──────────────
  // DCG 有时把 awk 格式串 / stdin 分析误判为 deny；只读巡检管道常见。
  // 含破坏性关键词时不放行。
  if (
    (/(?:^|[|&;]\s*)(?:\/[\w./-]+\/)?(?:g?awk|mawk)\b/.test(cmd) ||
      /\|\s*(?:g?awk|mawk)\b/.test(cmd)) &&
    !/\b(rm|mkfs|dd\b|DROP\s|TRUNCATE\s|FLUSHALL|curl\b[^|\n]*\|\s*(?:ba)?sh|wget\b[^|\n]*\|\s*(?:ba)?sh)\b/i.test(
      cmd,
    )
  ) {
    return {
      id: "maou.allow:awk-text-processing",
      reason:
        "允许 awk/gawk 文本处理（printf 中 %% 为合法字面量 %，非语法错误）",
    };
  }

  // ── 只读进程/系统巡检（ps | head | awk 等）──────────────────
  if (
    /(?:^|[;&]\s*)(?:ps|top|vm_stat|sysctl|df|du|uname|whoami|id|uptime|sw_vers)\b/.test(
      cmd,
    ) &&
    !/\b(rm|mkfs|dd\b|DROP\s|curl\b[^|\n]*\|\s*(?:ba)?sh)\b/i.test(cmd)
  ) {
    // 整条以只读工具开头，或管道链中主操作是 ps/top 等
    if (/^(?:ps|top|vm_stat|sysctl|df|du|uname|whoami|id|uptime|sw_vers)\b/.test(cmd) ||
        /(?:&&|\|)\s*(?:ps|top|vm_stat|sysctl|df)\b/.test(cmd) ||
        /^(?:echo|printf)\b.*\|\s*(?:ps|awk|head|tail)\b/.test(cmd) ||
        /^ps\b/.test(cmd) ||
        /(?:^|&&\s*)ps\s/.test(cmd)) {
      return {
        id: "maou.allow:readonly-sysinfo",
        reason: "允许只读系统/进程巡检（ps/top/vm_stat/df 等）",
      };
    }
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
