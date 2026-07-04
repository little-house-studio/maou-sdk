/**
 * IsolationRunner — git worktree 隔离执行（P2-2）。
 *
 * 职责：
 *   在独立 git worktree 里运行子 Agent，让子 Agent 对工作区的改动
 *   与主工作区完全隔离；子 Agent 结束后可选择：
 *     - mergeBack: 把改动 merge 回主分支
 *     - patchBack: 不 merge，只生成 patch 文件（供主 Agent 审查/应用）
 *     - removeWorktree: 直接丢弃 worktree（改动不回收）
 *
 * 设计：
 *   - 纯 git CLI 封装（exec/spawnSync），不引入 simple-git 等依赖。
 *   - worktree 创建在主仓库的 `.maou/worktrees/<agentName>/` 下，
 *     与 .maou 运行时状态同目录（git-ignored），避免污染主分支。
 *   - baseBranch 指定 worktree 起点（默认 HEAD）。
 *   - worktree 内新建一个临时分支（`maou/isolated/<agentName>/<ts>`），
 *     子 Agent 在此分支上提交；mergeBack 时 fast-forward 或 no-ff 合并到 targetBranch。
 *
 * 与 SubagentExecutor 协作（P2-2 接入点）：
 *   SubagentExecutor.fork 检测 ForkOptions.isolated=true →
 *   调 IsolationRunner.createWorktree() → 把返回的 path 作为子 Agent 的
 *   projectRoot 传给 runFn（runFn 的 options.projectRoot 字段）。
 *   子 Agent 结束后由 executor 调 mergeBack / patchBack / removeWorktree。
 *
 * 不依赖 SubagentExecutor 也可独立使用（harness 可直接调）。
 */

import { exec } from "node:child_process";
import { mkdirSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

/** git 命令执行结果 */
interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** createWorktree 的返回 */
export interface WorktreeHandle {
  /** worktree 在磁盘上的绝对路径（作为子 Agent 的 projectRoot） */
  path: string;
  /** worktree 内的临时分支名 */
  branch: string;
  /** 基线分支（worktree 起点） */
  baseBranch: string;
  /** agent 名（用于命名 + 日志） */
  agentName: string;
  /** 创建时间戳 */
  createdAt: number;
}

/** mergeBack 结果 */
export interface MergeBackResult {
  ok: boolean;
  message: string;
  /** 合并目标分支 */
  targetBranch?: string;
  /** 合并产生的 commit（如有） */
  commit?: string;
}

/** patchBack 结果 */
export interface PatchBackResult {
  ok: boolean;
  message: string;
  /** patch 文件路径（ok 时有值） */
  patchFile?: string;
  /** patch 内容字节数 */
  bytes?: number;
}

/** worktree 根目录名（相对主仓库根） */
const WORKTREE_DIR_NAME = ".maou/worktrees";

/** 默认 git 超时 30s */
const GIT_TIMEOUT_MS = 30_000;

/** 最大 stdout/stderr buffer（10MB，diff 可能较大） */
const GIT_MAX_BUFFER = 10 * 1024 * 1024;

/**
 * IsolationRunner —— git worktree 隔离执行器。
 *
 * 一个实例绑定一个主仓库根路径（projectRoot）。可在同一仓库上创建多个 worktree。
 */
export class IsolationRunner {
  /** 主仓库根路径（git 仓库根） */
  private readonly projectRoot: string;
  /** worktree 存放根目录（<projectRoot>/.maou/worktrees/） */
  private readonly worktreeDir: string;
  /** 日志函数 */
  private readonly log: (level: string, message: string) => void;

  constructor(opts: {
    projectRoot: string;
    log?: (level: string, message: string) => void;
  }) {
    this.projectRoot = resolve(opts.projectRoot);
    this.worktreeDir = join(this.projectRoot, WORKTREE_DIR_NAME);
    this.log = opts.log ?? (() => {});
  }

  /**
   * 创建一个隔离 worktree。
   *
   * 步骤：
   *   1. 确保 .maou/worktrees/ 存在
   *   2. 从 baseBranch 创建临时分支 `maou/isolated/<agentName>/<ts>`
   *   3. `git worktree add <path> <branch>`
   *
   * @param baseBranch worktree 起点（默认 "HEAD"，即当前主仓库的 HEAD）
   * @param agentName 子 Agent 名（用于命名 worktree 目录 + 分支）
   * @returns worktree 句柄（path 用于子 Agent projectRoot）
   */
  async createWorktree(baseBranch: string = "HEAD", agentName: string = "sub"): Promise<WorktreeHandle> {
    // 确保 worktree 根目录存在
    mkdirSync(this.worktreeDir, { recursive: true });

    const ts = Date.now().toString(36);
    const safeAgent = agentName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40) || "sub";
    const branch = `maou/isolated/${safeAgent}/${ts}`;
    const worktreePath = join(this.worktreeDir, `${safeAgent}-${ts}`);

    this.log("info", `[ISOLATION] 创建 worktree: agent=${agentName} base=${baseBranch} branch=${branch} path=${worktreePath}`);

    // 若 worktree 路径已存在（极小概率），先清理
    if (existsSync(worktreePath)) {
      await this._rmrf(worktreePath);
    }

    // git worktree add <path> -b <branch> <baseBranch>
    // -b 创建新分支；baseBranch 可以是分支名、tag、或 commitish（HEAD）
    const args = ["worktree", "add", worktreePath, "-b", branch];
    if (baseBranch && baseBranch !== "HEAD") {
      args.push(baseBranch);
    } else {
      args.push("HEAD");
    }
    const r = await this._runGit(args, this.projectRoot);
    if (r.code !== 0) {
      throw new Error(`git worktree add 失败: ${r.stderr || r.stdout || "(无输出)"}`);
    }

    return {
      path: worktreePath,
      branch,
      baseBranch,
      agentName,
      createdAt: Date.now(),
    };
  }

  /**
   * 把 worktree 内的改动 merge 回主仓库的目标分支。
   *
   * 步骤：
   *   1. 在 worktree 内 `git add -A && git commit`（若有未提交改动）
   *   2. 切回主仓库，`git merge --no-ff <branch>` 到 targetBranch
   *      （targetBranch 默认 = 主仓库当前分支）
   *   3. merge 后不自动删 worktree（调用方可再调 removeWorktree 清理）
   *
   * @param worktreePath worktree 路径（createWorktree 返回的 path）
   * @param targetBranch 合并目标分支（默认 = 主仓库当前分支）
   * @param message commit message（worktree 内自动提交 + merge commit）
   */
  async mergeBack(
    worktreePath: string,
    targetBranch?: string,
    message?: string,
  ): Promise<MergeBackResult> {
    if (!existsSync(worktreePath)) {
      return { ok: false, message: `worktree 路径不存在: ${worktreePath}` };
    }

    const msg = message || `merge: isolated agent changes from worktree`;

    // 1. 在 worktree 内提交未提交改动
    const addR = await this._runGit(["add", "-A"], worktreePath);
    if (addR.code !== 0) {
      return { ok: false, message: `worktree git add 失败: ${addR.stderr}` };
    }
    // commit（若无改动则跳过——git commit --allow-empty 保证总有 commit）
    const commitR = await this._runGit(
      ["commit", "--allow-empty", "-m", msg],
      worktreePath,
    );
    if (commitR.code !== 0) {
      // 可能是 nothing to commit（但 --allow-empty 应已处理）；其他错误才报错
      const lower = (commitR.stderr + commitR.stdout).toLowerCase();
      if (!lower.includes("nothing") && commitR.code !== 0) {
        return { ok: false, message: `worktree git commit 失败: ${commitR.stderr}` };
      }
    }

    // 2. 取 worktree 的分支名
    const branchR = await this._runGit(["rev-parse", "--abbrev-ref", "HEAD"], worktreePath);
    const branch = branchR.stdout.trim();
    if (branchR.code !== 0 || !branch) {
      return { ok: false, message: `无法获取 worktree 当前分支: ${branchR.stderr}` };
    }

    // 3. 在主仓库确定 targetBranch（默认当前分支）
    let target = targetBranch;
    if (!target) {
      const curR = await this._runGit(["rev-parse", "--abbrev-ref", "HEAD"], this.projectRoot);
      target = curR.stdout.trim();
      if (curR.code !== 0 || !target) {
        return { ok: false, message: `无法获取主仓库当前分支: ${curR.stderr}` };
      }
    }

    this.log("info", `[ISOLATION] mergeBack: branch=${branch} → target=${target}`);

    // 4. 主仓库 checkout target（若不在 target）+ merge
    const curTargetR = await this._runGit(["rev-parse", "--abbrev-ref", "HEAD"], this.projectRoot);
    const curTarget = curTargetR.stdout.trim();
    const needCheckout = target !== curTarget && curTarget !== "";
    if (needCheckout) {
      const coR = await this._runGit(["checkout", target], this.projectRoot);
      if (coR.code !== 0) {
        return { ok: false, message: `主仓库 checkout ${target} 失败: ${coR.stderr}` };
      }
    }

    const mergeR = await this._runGit(
      ["merge", "--no-ff", branch, "-m", `merge isolated worktree (${branch}) into ${target}`],
      this.projectRoot,
    );
    if (mergeR.code !== 0) {
      return {
        ok: false,
        message: `git merge 失败: ${mergeR.stderr || mergeR.stdout}`,
        targetBranch: target,
      };
    }

    // 取 merge commit
    const mcR = await this._runGit(["rev-parse", "HEAD"], this.projectRoot);
    const commit = mcR.stdout.trim() || undefined;

    return {
      ok: true,
      message: `已 merge ${branch} → ${target}`,
      targetBranch: target,
      commit,
    };
  }

  /**
   * 不 merge，只生成 patch 文件（供主 Agent 审查/手动应用）。
   *
   * 步骤：
   *   1. 在 worktree 内 `git add -A`（暂存所有改动，含 untracked）
   *   2. `git diff --cached` 生成 patch
   *   3. 写入主仓库的 .maou/worktrees/<agentName>.patch
   *
   * @param worktreePath worktree 路径
   * @param patchFile patch 输出路径（默认 <projectRoot>/.maou/worktrees/<agentName>-<ts>.patch）
   */
  async patchBack(
    worktreePath: string,
    patchFile?: string,
  ): Promise<PatchBackResult> {
    if (!existsSync(worktreePath)) {
      return { ok: false, message: `worktree 路径不存在: ${worktreePath}` };
    }

    // 1. 暂存所有改动（含 untracked：git add -A）
    const addR = await this._runGit(["add", "-A"], worktreePath);
    if (addR.code !== 0) {
      return { ok: false, message: `worktree git add 失败: ${addR.stderr}` };
    }

    // 2. 生成 patch（diff --cached 相对 HEAD）
    const diffR = await this._runGit(
      ["diff", "--cached", "--binary"], // --binary 支持二进制文件
      worktreePath,
    );
    if (diffR.code !== 0) {
      return { ok: false, message: `git diff 失败: ${diffR.stderr}` };
    }

    const patch = diffR.stdout;
    if (!patch.trim()) {
      return { ok: true, message: "worktree 无改动，patch 为空", patchFile: undefined, bytes: 0 };
    }

    // 3. 确定 patch 文件路径
    mkdirSync(this.worktreeDir, { recursive: true });
    const ts = Date.now().toString(36);
    const out = patchFile || join(this.worktreeDir, `patch-${ts}.patch`);
    try {
      writeFileSync(out, patch, "utf-8");
    } catch (err) {
      return {
        ok: false,
        message: `写 patch 文件失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    this.log("info", `[ISOLATION] patchBack: ${patch.length} bytes → ${out}`);

    return {
      ok: true,
      message: `patch 已生成: ${out}`,
      patchFile: out,
      bytes: Buffer.byteLength(patch, "utf-8"),
    };
  }

  /**
   * 移除 worktree（清理）。
   * `git worktree remove --force <path>`，并删除临时分支。
   *
   * @param worktreePath worktree 路径
   * @param deleteBranch 是否删除临时分支（默认 true）
   */
  async removeWorktree(worktreePath: string, deleteBranch: boolean = true): Promise<{ ok: boolean; message: string }> {
    if (!existsSync(worktreePath)) {
      return { ok: true, message: "worktree 路径不存在，跳过" };
    }

    // 取分支名（remove 前先记录，remove 后分支还在但 worktree 没了）
    let branch = "";
    try {
      const branchR = await this._runGit(["rev-parse", "--abbrev-ref", "HEAD"], worktreePath);
      branch = branchR.stdout.trim();
    } catch {
      // 忽略
    }

    // git worktree remove --force <path>
    const r = await this._runGit(
      ["worktree", "remove", "--force", worktreePath],
      this.projectRoot,
    );
    if (r.code !== 0) {
      // git remove 失败时兜底：直接 rm -rf
      this.log("warning", `[ISOLATION] git worktree remove 失败，兜底 rm -rf: ${r.stderr}`);
      await this._rmrf(worktreePath);
    }

    // 删除临时分支
    if (deleteBranch && branch && branch.startsWith("maou/isolated/")) {
      const delR = await this._runGit(
        ["branch", "-D", branch],
        this.projectRoot,
      );
      if (delR.code !== 0) {
        this.log("warning", `[ISOLATION] 删除临时分支 ${branch} 失败: ${delR.stderr}`);
      }
    }

    // 兜底：清理磁盘残留（worktree 目录可能因 --force 仍留空壳）
    if (existsSync(worktreePath)) {
      await this._rmrf(worktreePath);
    }

    return { ok: true, message: `worktree 已移除${branch ? `（分支 ${branch} 已删）` : ""}` };
  }

  /**
   * 列出当前仓库的所有 maou 隔离 worktree（分支名前缀 maou/isolated/）。
   */
  async listWorktrees(): Promise<Array<{ path: string; branch: string; agentName: string }>> {
    const r = await this._runGit(["worktree", "list", "--porcelain"], this.projectRoot);
    if (r.code !== 0) return [];
    const result: Array<{ path: string; branch: string; agentName: string }> = [];
    let curPath = "";
    let curBranch = "";
    for (const line of r.stdout.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("worktree ")) {
        curPath = trimmed.slice("worktree ".length).trim();
      } else if (trimmed.startsWith("branch ")) {
        curBranch = trimmed.slice("branch ".length).trim();
        // 去掉 refs/heads/ 前缀
        curBranch = curBranch.replace(/^refs\/heads\//, "");
      } else if (trimmed === "" && curPath) {
        if (curBranch.startsWith("maou/isolated/")) {
          const parts = curBranch.split("/");
          const agentName = parts[2] ?? "(unknown)";
          result.push({ path: curPath, branch: curBranch, agentName });
        }
        curPath = "";
        curBranch = "";
      }
    }
    // 处理末尾未空行结束的条目
    if (curPath && curBranch.startsWith("maou/isolated/")) {
      const parts = curBranch.split("/");
      const agentName = parts[2] ?? "(unknown)";
      result.push({ path: curPath, branch: curBranch, agentName });
    }
    return result;
  }

  // ── 内部 ──

  /** 执行 git 命令（async，exec 封装） */
  private _runGit(args: string[], cwd: string): Promise<GitResult> {
    return new Promise((resolve) => {
      const cmd = ["git", ...args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ");
      exec(
        cmd,
        { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER, encoding: "utf-8" },
        (error, stdout, stderr) => {
          resolve({
            code: error ? (typeof error.code === "number" ? error.code : 1) : 0,
            stdout: (stdout ?? "").trim(),
            stderr: (stderr ?? "").trim(),
          });
        },
      );
    });
  }

  /** rm -rf 兜底（git worktree remove 失败时） */
  private _rmrf(target: string): Promise<void> {
    return new Promise((resolve) => {
      try {
        rmSync(target, { recursive: true, force: true });
      } catch {
        // 忽略
      }
      resolve();
    });
  }
}
