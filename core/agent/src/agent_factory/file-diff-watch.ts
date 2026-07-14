/**
 * 会话级文件 diff 监听名单（变更感知）
 *
 * 设计（coding-agent/DESIGN.md）：
 * - 进入：agent 用 reader / edit_file / write_file 触碰文件 → 入名单并刷新 baseline
 * - 退出：连续 maxIdleRounds 轮未触碰；或累计 maxChangeNotices 次「有改动」通知却从未再触碰
 * - 用户新消息：对比 baseline，把有改动的文件以 XML 注入 before_user（可选、可忽略）
 *
 * 性能：只存 mtime/size/lineCount，不存全文；mtime+size 未变则跳过读盘。
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

// ─── 配置 ──────────────────────────────────────────────────────────────────

export interface FileDiffWatchConfig {
  projectRoot: string;
  /** 连续多少 agent 轮未触碰则移出（默认 200） */
  maxIdleRounds?: number;
  /** 累计多少次「有改动」通知却未再触碰则移出（默认 5） */
  maxChangeNoticesWithoutTouch?: number;
  /** 计为触碰的工具名 */
  touchTools?: readonly string[];
}

const DEFAULT_TOUCH_TOOLS = ["reader", "write_file", "edit_file"] as const;

// ─── 内部状态 ──────────────────────────────────────────────────────────────

interface FileBaseline {
  mtimeMs: number;
  size: number;
  lineCount: number;
  exists: boolean;
}

interface WatchEntry {
  absPath: string;
  relPath: string;
  lastTouchAt: number;
  /** 自上次 agent 触碰以来经过的 agent 轮次数 */
  roundsSinceTouch: number;
  /** 自上次 agent 触碰以来发出的「有改动」通知次数 */
  changeNoticesSinceTouch: number;
  baseline: FileBaseline;
  /** 本轮是否已被触碰（round end 时清零计数用） */
  touchedThisRound: boolean;
}

// ─── gitignore 简化匹配（与 tools/diff-collector 同口径）──────────────────

const PATH_BLACKLIST = [
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)\.cache\//,
  /(^|\/)\.maou\//,
  /(^|\/)\.git\//,
  /\.map$/,
  /\.tsbuildinfo$/,
  /(^|\/)package-lock\.json$/,
  /(^|\/)yarn\.lock$/,
  /(^|\/)pnpm-lock\.yaml$/,
];

function readGitignorePatterns(root: string): string[] {
  const p = join(root, ".gitignore");
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, "utf-8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
  } catch {
    return [];
  }
}

export function isIgnoredPath(relPath: string, gitignorePatterns: string[]): boolean {
  const normalized = relPath.replace(/\\/g, "/");
  for (const re of PATH_BLACKLIST) {
    if (re.test(normalized)) return true;
  }
  for (const pat of gitignorePatterns) {
    const clean = pat.replace(/^\/+|\/+$/g, "").replace(/^\*\//, "");
    if (!clean) continue;
    if (normalized.includes(clean) || normalized.endsWith(clean.replace(/^\*\./, "."))) {
      return true;
    }
    // 简单 glob: *.ext
    if (clean.startsWith("*.") && normalized.endsWith(clean.slice(1))) return true;
  }
  return false;
}

// ─── 文件快照 ──────────────────────────────────────────────────────────────

function countLines(content: string): number {
  if (!content) return 0;
  let n = 1;
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) n++;
  }
  // 末尾换行不额外计空行
  if (content.endsWith("\n") && n > 1) n--;
  return n;
}

function snapshotFile(absPath: string): FileBaseline {
  if (!existsSync(absPath)) {
    return { mtimeMs: 0, size: 0, lineCount: 0, exists: false };
  }
  try {
    const st = statSync(absPath);
    if (!st.isFile()) {
      return { mtimeMs: st.mtimeMs, size: st.size, lineCount: 0, exists: false };
    }
    // 大文件只 stat，不读全文计行（上限 2MB）
    if (st.size > 2 * 1024 * 1024) {
      return { mtimeMs: st.mtimeMs, size: st.size, lineCount: -1, exists: true };
    }
    const content = readFileSync(absPath, "utf-8");
    return {
      mtimeMs: st.mtimeMs,
      size: st.size,
      lineCount: countLines(content),
      exists: true,
    };
  } catch {
    return { mtimeMs: 0, size: 0, lineCount: 0, exists: false };
  }
}

function baselineChanged(a: FileBaseline, b: FileBaseline): boolean {
  if (a.exists !== b.exists) return true;
  if (!a.exists) return false;
  return a.mtimeMs !== b.mtimeMs || a.size !== b.size;
}

function formatAge(ms: number): string {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function formatLineDelta(before: FileBaseline, after: FileBaseline): string {
  if (!after.exists && before.exists) return "deleted";
  if (after.exists && !before.exists) {
    return after.lineCount >= 0 ? `added · ${after.lineCount} lines` : "added";
  }
  if (before.lineCount < 0 || after.lineCount < 0) {
    const d = after.size - before.size;
    const sign = d >= 0 ? "+" : "";
    return `size ${sign}${d}B`;
  }
  const d = after.lineCount - before.lineCount;
  const sign = d >= 0 ? "+" : "";
  return `lines ${before.lineCount}→${after.lineCount} (Δ${sign}${d})`;
}

// ─── 工具参数抽路径 ────────────────────────────────────────────────────────

export function extractFilePathsFromToolParams(
  toolName: string,
  params: Record<string, unknown> | undefined | null,
): string[] {
  if (!params || typeof params !== "object") return [];
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string" && v.trim()) out.push(v.trim());
  };
  push(params.path);
  push(params.file_path);
  push(params.filePath);
  push(params.target);
  push(params.file);
  // 少数工具可能传 files: string[]
  if (Array.isArray(params.files)) {
    for (const f of params.files) push(f);
  }
  return out;
}

// ─── 主类 ──────────────────────────────────────────────────────────────────

export class FileDiffWatch {
  readonly projectRoot: string;
  readonly maxIdleRounds: number;
  readonly maxChangeNoticesWithoutTouch: number;
  readonly touchTools: Set<string>;

  /** sessionId → relPath → entry */
  private sessions = new Map<string, Map<string, WatchEntry>>();
  private gitignoreCache: { root: string; mtime: number; patterns: string[] } | null = null;

  constructor(cfg: FileDiffWatchConfig) {
    this.projectRoot = resolve(cfg.projectRoot);
    this.maxIdleRounds = cfg.maxIdleRounds ?? 200;
    this.maxChangeNoticesWithoutTouch = cfg.maxChangeNoticesWithoutTouch ?? 5;
    this.touchTools = new Set(cfg.touchTools ?? DEFAULT_TOUCH_TOOLS);
  }

  private gitignore(): string[] {
    const gi = join(this.projectRoot, ".gitignore");
    let mtime = 0;
    try {
      mtime = existsSync(gi) ? statSync(gi).mtimeMs : 0;
    } catch {
      mtime = 0;
    }
    if (this.gitignoreCache && this.gitignoreCache.root === this.projectRoot && this.gitignoreCache.mtime === mtime) {
      return this.gitignoreCache.patterns;
    }
    const patterns = readGitignorePatterns(this.projectRoot);
    this.gitignoreCache = { root: this.projectRoot, mtime, patterns };
    return patterns;
  }

  private resolveRel(userPath: string): { absPath: string; relPath: string } | null {
    const abs = isAbsolute(userPath)
      ? resolve(userPath)
      : resolve(this.projectRoot, userPath);
    // 必须在项目根下
    const rel = relative(this.projectRoot, abs);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
    return { absPath: abs, relPath: rel.replace(/\\/g, "/") };
  }

  private sessionMap(sessionId: string): Map<string, WatchEntry> {
    let m = this.sessions.get(sessionId);
    if (!m) {
      m = new Map();
      this.sessions.set(sessionId, m);
    }
    return m;
  }

  /** 是否为触碰类工具 */
  isTouchTool(name: string): boolean {
    return this.touchTools.has(name);
  }

  /**
   * 工具成功执行后调用：把文件加入/刷新名单，baseline = 触碰后磁盘状态。
   */
  noteToolTouch(
    sessionId: string,
    toolName: string,
    params: Record<string, unknown> | undefined | null,
  ): void {
    if (!sessionId || !this.isTouchTool(toolName)) return;
    const paths = extractFilePathsFromToolParams(toolName, params);
    if (!paths.length) return;
    const gi = this.gitignore();
    const map = this.sessionMap(sessionId);
    const now = Date.now();

    for (const p of paths) {
      const resolved = this.resolveRel(p);
      if (!resolved) continue;
      if (isIgnoredPath(resolved.relPath, gi)) continue;

      const baseline = snapshotFile(resolved.absPath);
      const prev = map.get(resolved.relPath);
      if (prev) {
        prev.lastTouchAt = now;
        prev.roundsSinceTouch = 0;
        prev.changeNoticesSinceTouch = 0;
        prev.baseline = baseline;
        prev.touchedThisRound = true;
      } else {
        map.set(resolved.relPath, {
          absPath: resolved.absPath,
          relPath: resolved.relPath,
          lastTouchAt: now,
          roundsSinceTouch: 0,
          changeNoticesSinceTouch: 0,
          baseline,
          touchedThisRound: true,
        });
      }
    }
  }

  /**
   * 每个 agent 轮次结束调用：未触碰文件 rounds++，超阈移出。
   */
  onAgentRoundEnd(sessionId: string): void {
    const map = this.sessions.get(sessionId);
    if (!map || map.size === 0) return;
    const toRemove: string[] = [];
    for (const [rel, e] of map) {
      if (e.touchedThisRound) {
        e.touchedThisRound = false;
        e.roundsSinceTouch = 0;
      } else {
        e.roundsSinceTouch += 1;
        if (e.roundsSinceTouch >= this.maxIdleRounds) {
          toRemove.push(rel);
        }
      }
    }
    for (const r of toRemove) map.delete(r);
  }

  /**
   * 用户新消息前调用：对比 baseline，生成 before_user XML；更新 baseline；按规则移出。
   * 返回空串表示无需注入。
   */
  consumeUserTurnDiffs(sessionId: string): string {
    const map = this.sessions.get(sessionId);
    if (!map || map.size === 0) return "";

    const gi = this.gitignore();
    const now = Date.now();
    const lines: string[] = [];
    const removeAfter: string[] = [];

    for (const [rel, e] of map) {
      if (isIgnoredPath(rel, gi)) {
        removeAfter.push(rel);
        continue;
      }

      const cur = snapshotFile(e.absPath);
      if (!baselineChanged(e.baseline, cur)) {
        continue; // 无改动，不通知、不累计「更改消息」
      }

      const age = formatAge(now - e.lastTouchAt);
      const delta = formatLineDelta(e.baseline, cur);
      lines.push(`- ${rel} · ${delta} · last_agent_touch ${age} ago`);

      // 通知发出后刷新 baseline，避免同一改动重复报
      e.baseline = cur;
      e.changeNoticesSinceTouch += 1;
      if (e.changeNoticesSinceTouch >= this.maxChangeNoticesWithoutTouch) {
        removeAfter.push(rel);
      }
    }

    for (const r of removeAfter) map.delete(r);

    if (lines.length === 0) return "";

    // 可选、可忽略；不敦促 agent 必须打开
    return [
      `<file_change_notice optional="true">`,
      `<!-- optional: ignore if not relevant; no action required -->`,
      `Informational only (you may ignore): since the last user message, some files you previously read/edited appear changed on disk.`,
      `Paths are project-relative. .gitignore-matched paths are excluded.`,
      ``,
      ...lines,
      `</file_change_notice>`,
    ].join("\n");
  }

  /** 测试/调试：名单大小 */
  watchedCount(sessionId: string): number {
    return this.sessions.get(sessionId)?.size ?? 0;
  }

  /** 测试：列出名单 relPath */
  listWatched(sessionId: string): string[] {
    return [...(this.sessions.get(sessionId)?.keys() ?? [])];
  }

  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}
