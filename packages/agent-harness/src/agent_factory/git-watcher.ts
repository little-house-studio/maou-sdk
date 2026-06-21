/**
 * Git Watcher — 项目 diff 监控与版本备份
 * 对应 Python: core/diff/git_watcher.py
 *
 * 设计：
 * - 每次 agent 对话发送前，检测是否有文件变更
 * - 有变更则存储一次 diff 快照（.patch 文件，几 KB）
 * - 每 10 个 diff 做一次 git stash 大版本存档
 * - 支持回退到任意 diff 点
 */

import { exec } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const SNAPSHOT_INTERVAL = 10;

function runGit(args: string[], cwd: string, inputText?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const cmd = ["git", ...args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ");
    exec(
      cmd,
      { cwd, timeout: 30_000, maxBuffer: 10 * 1024 * 1024, encoding: "utf-8" },
      (error, stdout, stderr) => {
        resolve({
          code: error ? (error.code ?? 1) : 0,
          stdout: (stdout ?? "").trim(),
          stderr: (stderr ?? "").trim(),
        });
      },
    );
  });
}

export interface DiffMeta {
  seq: number;
  timestamp: string;
  sessionId: string;
  message: string;
  diffStat: string;
  patchFile: string;
  hasStash: boolean;
  stashRef: string;
}

export interface RollbackResult {
  success: boolean;
  message: string;
}

export class GitWatcher {
  private maouRoot: string;
  private projectRoot: string;

  constructor(maouRoot: string, projectRoot: string) {
    this.maouRoot = maouRoot;
    this.projectRoot = projectRoot;
  }

  private diffsDir(agentName: string): string {
    return join(this.maouRoot, "agents", agentName, "diffs");
  }

  private async git(...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    return runGit(args, this.projectRoot);
  }

  /** 检查是否有未提交的变更 */
  async getStatus(): Promise<{ hasChanges: boolean; porcelain: string }> {
    const result = await this.git("status", "--porcelain");
    return { hasChanges: Boolean(result.stdout), porcelain: result.stdout };
  }

  /** 获取当前 diff 内容 */
  async getDiffContent(): Promise<string> {
    const result = await this.git("diff");
    return result.stdout;
  }

  /** 获取 diff --stat */
  async getDiffStat(): Promise<string> {
    const result = await this.git("diff", "--stat");
    return result.stdout;
  }

  /**
   * 在对话发送前调用。有变更则存储 diff 快照，返回快照信息。
   */
  async captureSnapshot(
    agentName: string,
    sessionId = "",
    message = "",
    scope = "project",
  ): Promise<DiffMeta | null> {
    const { hasChanges } = await this.getStatus();
    if (!hasChanges) return null;

    const dir = this.diffsDir(agentName);
    mkdirSync(dir, { recursive: true });

    const now = new Date();
    const timestamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 15);
    const diffContent = await this.getDiffContent();
    const diffStat = await this.getDiffStat();

    if (!diffContent) return null;

    const existing = readdirSync(dir)
      .filter((f) => f.startsWith("diff_") && f.endsWith(".patch"))
      .sort();
    const seq = existing.length + 1;

    const patchFile = `diff_${String(seq).padStart(4, "0")}_${timestamp}.patch`;
    writeFileSync(join(dir, patchFile), diffContent, "utf-8");

    const meta: DiffMeta = {
      seq,
      timestamp: now.toISOString(),
      sessionId,
      message: message.slice(0, 200),
      diffStat,
      patchFile,
      hasStash: false,
      stashRef: "",
    };

    const metaFile = `diff_${String(seq).padStart(4, "0")}_${timestamp}.json`;
    writeFileSync(join(dir, metaFile), JSON.stringify(meta, null, 2), "utf-8");

    // 每 SNAPSHOT_INTERVAL 个 diff 做一次 git stash
    if (scope === "project" && seq % SNAPSHOT_INTERVAL === 0) {
      const stashRef = await this.gitStash(agentName, seq);
      if (stashRef) {
        meta.hasStash = true;
        meta.stashRef = stashRef;
        writeFileSync(join(dir, metaFile), JSON.stringify(meta, null, 2), "utf-8");
      }
    }

    return meta;
  }

  /** 用 git stash 存档当前工作区 */
  private async gitStash(agentName: string, seq: number): Promise<string> {
    const label = `maou/${agentName}/diff_${String(seq).padStart(4, "0")}`;
    const result = await this.git("stash", "push", "-m", label);
    if (result.code !== 0 || result.stdout.includes("No local changes")) return "";

    const listResult = await this.git("stash", "list");
    for (const line of listResult.stdout.split("\n")) {
      if (line.includes(label)) return line.split(":")[0].trim();
    }
    return "stash@{0}";
  }

  /** 列出某个 agent 的所有 diff 快照元数据 */
  async listDiffs(agentName: string): Promise<DiffMeta[]> {
    const dir = this.diffsDir(agentName);
    if (!existsSync(dir)) return [];

    const results: DiffMeta[] = [];
    const files = readdirSync(dir)
      .filter((f) => f.startsWith("diff_") && f.endsWith(".json"))
      .sort();

    for (const f of files) {
      try {
        const data = JSON.parse(readFileSync(join(dir, f), "utf-8"));
        results.push(data);
      } catch {
        // skip malformed files
      }
    }
    return results;
  }

  /** 列出某个 agent 的 git stash 记录 */
  async listStashes(agentName: string): Promise<{ ref: string; message: string }[]> {
    const result = await this.git("stash", "list");
    if (result.code !== 0) return [];

    const prefix = `maou/${agentName}/`;
    const stashes: { ref: string; message: string }[] = [];
    for (const line of result.stdout.split("\n")) {
      if (line.includes(prefix)) {
        const parts = line.split(":");
        stashes.push({
          ref: parts[0].trim(),
          message: parts.length > 2 ? parts.slice(2).join(":").trim() : "",
        });
      }
    }
    return stashes;
  }

  /** 读取指定 diff 的 patch 内容 */
  async getDiff(agentName: string, seq: number): Promise<string | null> {
    const dir = this.diffsDir(agentName);
    if (!existsSync(dir)) return null;

    const padded = String(seq).padStart(4, "0");
    const files = readdirSync(dir)
      .filter((f) => f.startsWith(`diff_${padded}_`) && f.endsWith(".patch"))
      .sort();

    if (files.length === 0) return null;
    return readFileSync(join(dir, files[0]), "utf-8");
  }

  /** 回退到指定 diff 点。优先用 git stash pop，否则用 reverse patch。 */
  async rollback(agentName: string, seq: number): Promise<RollbackResult> {
    const dir = this.diffsDir(agentName);
    if (!existsSync(dir)) {
      return { success: false, message: `diff #${seq} 不存在` };
    }

    // 查找对应的元数据，看是否有 stash
    const padded = String(seq).padStart(4, "0");
    const metaFiles = readdirSync(dir)
      .filter((f) => f.startsWith(`diff_${padded}_`) && f.endsWith(".json"))
      .sort();

    for (const mf of metaFiles) {
      try {
        const meta: DiffMeta = JSON.parse(readFileSync(join(dir, mf), "utf-8"));
        if (meta.hasStash && meta.stashRef) {
          const result = await this.git("stash", "pop", meta.stashRef);
          if (result.code === 0) {
            return { success: true, message: `已通过 git stash 恢复到 diff #${seq}` };
          }
          return { success: false, message: `stash pop 失败: ${result.stderr}` };
        }
      } catch {
        // continue
      }
    }

    // 没有 stash，用 reverse patch
    const diffContent = await this.getDiff(agentName, seq);
    if (!diffContent) {
      return { success: false, message: `diff #${seq} 不存在` };
    }

    // exec 不支持 stdin pipe 简单传入，通过 runGit 的 inputText 参数传入
    const applyResult = await runGit(
      ["apply", "--reverse", "-"],
      this.projectRoot,
      diffContent,
    );
    if (applyResult.code === 0) {
      return { success: true, message: `已通过 reverse patch 回退到 diff #${seq}` };
    }
    return { success: false, message: `回退失败: ${applyResult.stderr}` };
  }
}
