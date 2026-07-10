/**
 * diff 收集器 —— 主 agent loop 完成后，收集相对上次的文件变更。
 *
 * 用 git diff --stat 算增删行数 + 过滤不该传的文件（.gitignore + 编译产物黑名单）。
 * 供 loop_report 附带 diff 信息给 supervisor，让验收有真实依据（不只看主 agent 文字汇报）。
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** 编译产物/不该传 diff 的文件黑名单（即使 .gitignore 没写也过滤） */
const DIFF_BLACKLIST = [
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)\.cache\//,
  /(^|\/)\.maou\//, // agent 配置/ session 等运行时状态
  /\.map$/,
  /\.tsbuildinfo$/,
  /(^|\/)package-lock\.json$/,
  /(^|\/)yarn\.lock$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)\.git\//,
];

/** 读取 .gitignore 的 pattern（简化版：只取行，不去解析复杂语法） */
function readGitignore(root: string): string[] {
  const giPath = join(root, ".gitignore");
  if (!existsSync(giPath)) return [];
  try {
    return readFileSync(giPath, "utf-8")
      .split("\n")
      .map(l => l.trim())
      .filter(l => l && !l.startsWith("#"));
  } catch {
    return [];
  }
}

/** 判断文件是否该被过滤（黑名单或 .gitignore 命中） */
function shouldFilter(filePath: string, gitignorePatterns: string[]): boolean {
  for (const re of DIFF_BLACKLIST) {
    if (re.test(filePath)) return true;
  }
  // 简化 .gitignore 匹配：pattern 作为子串或路径段匹配
  for (const pat of gitignorePatterns) {
    const clean = pat.replace(/^\/+|\/+$/g, "");
    if (!clean) continue;
    if (filePath.includes(clean)) return true;
  }
  return false;
}

export interface DiffEntry {
  path: string;
  added: number;
  deleted: number;
  status: "added" | "modified" | "deleted";
}

export interface DiffSummary {
  entries: DiffEntry[];
  totalAdded: number;
  totalDeleted: number;
  filesChanged: number;
  raw: string; // git diff --stat 原始输出（供 debug）
}

/**
 * 收集 workingDir 相对上次快照的 diff。
 *
 * 实现方式：在 workingDir 跑 git diff（HEAD vs 工作区/暂存区）。
 * - 若不是 git 仓库 → 返回空（调用方降级为不附 diff）
 * - 过滤黑名单 + .gitignore 命中的文件
 *
 * 注：只算文件级 + 增删行数，不传具体代码内容（避免 diff 过大）。
 */
export function collectDiff(workingDir: string): DiffSummary {
  const empty: DiffSummary = { entries: [], totalAdded: 0, totalDeleted: 0, filesChanged: 0, raw: "" };
  try {
    // 确认是 git 仓库
    execSync("git rev-parse --is-inside-work-tree", { cwd: workingDir, stdio: "ignore", timeout: 3000 });
  } catch {
    return empty;
  }

  let rawStat = "";
  try {
    // --numstat 给出 "added\tdeleted\tpath"，比 --stat 更易解析
    rawStat = execSync("git diff --numstat HEAD", {
      cwd: workingDir,
      encoding: "utf-8",
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    }).trim();
  } catch {
    // 可能没有 HEAD（空仓库首次提交前），改用 diff --cached + 未跟踪文件
    try {
      rawStat = execSync("git diff --numstat --cached", {
        cwd: workingDir, encoding: "utf-8", timeout: 5000, maxBuffer: 1024 * 1024,
      }).trim();
    } catch { return empty; }
  }

  const gitignorePatterns = readGitignore(workingDir);
  const entries: DiffEntry[] = [];
  let totalAdded = 0, totalDeleted = 0;

  for (const line of rawStat.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const addedStr = parts[0]!;
    const deletedStr = parts[1]!;
    const path = parts.slice(2).join("\t");
    // 二进制文件 git 输出 "-\t-\tpath"
    const added = addedStr === "-" ? 0 : (parseInt(addedStr, 10) || 0);
    const deleted = deletedStr === "-" ? 0 : (parseInt(deletedStr, 10) || 0);
    if (shouldFilter(path, gitignorePatterns)) continue;
    const status: DiffEntry["status"] = addedStr === "0" && deletedStr === "0"
      ? "modified"
      : (line.startsWith("0\t0\t") ? "modified" : "modified");
    entries.push({ path, added, deleted, status: "modified" });
    totalAdded += added;
    totalDeleted += deleted;
  }

  // 也收集未跟踪的新文件（git diff 不含 untracked）
  try {
    const untracked = execSync("git ls-files --others --exclude-standard", {
      cwd: workingDir, encoding: "utf-8", timeout: 5000, maxBuffer: 1024 * 1024,
    }).trim();
    for (const path of untracked.split("\n")) {
      if (!path.trim()) continue;
      if (shouldFilter(path, gitignorePatterns)) continue;
      // 新文件：added = 行数（wc -l），deleted = 0
      let added = 0;
      try {
        const wc = execSync(`wc -l ${JSON.stringify(path)}`, { cwd: workingDir, encoding: "utf-8", timeout: 3000 });
        const m = wc.match(/(\d+)/);
        if (m) added = parseInt(m[1]!, 10) || 0;
      } catch { /* ignore */ }
      entries.push({ path, added, deleted: 0, status: "added" });
      totalAdded += added;
    }
  } catch { /* ignore */ }

  return {
    entries,
    totalAdded,
    totalDeleted,
    filesChanged: entries.length,
    raw: rawStat,
  };
}

/** 把 DiffSummary 格式化成给 supervisor 看的文本 */
export function formatDiffForReport(diff: DiffSummary): string {
  if (diff.entries.length === 0) return "本轮无文件变更。";
  const lines = [`本轮文件变更（${diff.filesChanged} 个文件，+${diff.totalAdded}/-${diff.totalDeleted} 行）：`];
  for (const e of diff.entries) {
    const tag = e.status === "added" ? "新增" : e.status === "deleted" ? "删除" : "修改";
    lines.push(`  ${tag} ${e.path} (+${e.added}/-${e.deleted})`);
  }
  return lines.join("\n");
}
