/**
 * BakeFile — 文件 diff 监听与增量注入
 *
 * 三种模式：
 * - listen: 仅监听变化，不注入内容
 * - diff: 链式 diff + 折叠（默认），保护 Prompt Cache
 * - snapshot: 字段级快照（高频变化文件专用）
 * - full: 每次完整注入
 *
 * 链式 diff 策略：
 * - diff 追加到 before_user，不修改前缀 → 缓存命中
 * - 累积超过 maxPendingDiffs 时自动折叠为完整版本
 * - 折叠重置缓存，但只重置一次
 */

import { readFileSync, statSync, existsSync } from "node:fs";

// ─── 类型 ──────────────────────────────────────────────────────────────────

/** BakeFile 模式 */
export type BakeMode = "listen" | "diff" | "snapshot" | "full";

/** BakeFile 构造选项 */
export interface BakeFileOptions {
  /** xml 标签名 */
  tag: string;
  /** 文件路径（绝对或相对） */
  path: string;
  /** 提示词 */
  hint: string;
  /** 预设方案 */
  mode?: BakeMode;
  /** 链式 diff 最大累积数（默认 3） */
  maxPendingDiffs?: number;
}

/** diff 条目 */
interface DiffEntry {
  /** diff 版本号 */
  version: number;
  /** diff 内容（结构化文本） */
  content: string;
}

/** 文件类型推断 */
type FileType = "structured" | "code" | "text";

// ─── BakeFile 类 ──────────────────────────────────────────────────────────

export class BakeFile {
  readonly tag: string;
  readonly path: string;
  readonly hint: string;
  readonly mode: BakeMode;
  readonly maxPendingDiffs: number;

  private _commitHash: string | null = null;
  private _snapshot: string | null = null;
  private _pendingDiffs: DiffEntry[] = [];
  private _diffVersion = 0;

  constructor(opts: BakeFileOptions) {
    this.tag = opts.tag;
    this.path = opts.path;
    this.hint = opts.hint;
    this.mode = opts.mode ?? "diff";
    this.maxPendingDiffs = opts.maxPendingDiffs ?? 3;
  }

  // ── 属性 ──

  /** 上次 commit 的文件 hash（调试/回溯用） */
  get commitHash(): string | null {
    return this._commitHash;
  }

  /** 是否有增量（对比当前 vs 上次 commit） */
  get hasChanges(): boolean {
    if (!this._commitHash) return existsSync(this.path);
    return this.computeHash() !== this._commitHash;
  }

  // ── 核心方法 ──

  /**
   * commit() — 存档当前文件状态为基准
   * 等同 git commit，创建快照点
   */
  commit(): void {
    if (!existsSync(this.path)) return;
    this._snapshot = this.readFileContent();
    this._commitHash = this.computeHash();
    this._pendingDiffs = [];
  }

  /**
   * read() — 读取文件完整内容，带 xml 标签
   */
  read(): string {
    const content = this.readFileContent();
    return `<${this.tag}>\n${content}\n</${this.tag}>`;
  }

  /**
   * diff() — 返回增量内容，无变化返回 null
   *
   * 输出格式按文件类型自动选择：
   * - structured (JSON/YAML/TOML): 字段级对比
   * - code (TS/Python/Go): 函数/语义块级对比
   * - text (Markdown/日志): 段落级对比
   */
  diff(): string | null {
    if (this.mode === "listen") return null;
    if (this.mode === "full") return this.read();

    if (!this.hasChanges) return null;

    const currentContent = this.readFileContent();
    const oldContent = this._snapshot ?? "";

    if (!oldContent) {
      // 首次：返回完整内容
      return this.read();
    }

    // 检查是否需要折叠
    if (this.mode === "diff" && this._pendingDiffs.length >= this.maxPendingDiffs) {
      this.foldDiffs();
    }

    // 生成结构化 diff
    const diffContent = this.generateStructuredDiff(oldContent, currentContent);
    if (!diffContent) return null;

    this._diffVersion++;
    const entry: DiffEntry = {
      version: this._diffVersion,
      content: diffContent,
    };
    this._pendingDiffs.push(entry);

    if (this.mode === "snapshot") {
      // snapshot 模式：只注入变化字段的当前值
      return `<${this.tag} mode="snapshot">\n${diffContent}\n</${this.tag}>`;
    }

    // diff 模式：链式 diff
    return `<${this.tag}_diff v="${entry.version}">\n${diffContent}\n</${this.tag}_diff>`;
  }

  // ── 快速版 ──

  /**
   * bake() — commit() 后返回完整文件内容，带 xml
   * 可直接 add 到 bakeblock
   */
  bake(): string {
    this.commit();
    return this.read();
  }

  /**
   * update() — 返回本次 diff 内容后 commit()，带 xml
   * 可直接 add 到 before_user
   */
  update(): string | null {
    const result = this.diff();
    if (result) this.commit();
    return result;
  }

  // ── 内部方法 ──

  /** 读取文件原始内容 */
  private readFileContent(): string {
    if (!existsSync(this.path)) return "";
    return readFileSync(this.path, "utf-8");
  }

  /** 计算文件内容 hash（简单实现，生产环境可用 crypto） */
  private computeHash(): string {
    const content = this.readFileContent();
    // 简单 hash：长度 + 首尾各 64 字符 + mtime
    let mtime = "";
    try {
      mtime = statSync(this.path).mtimeMs.toString();
    } catch {}
    const len = content.length;
    const head = content.slice(0, 64);
    const tail = content.slice(-64);
    return `${len}:${head}:${tail}:${mtime}`;
  }

  /** 折叠：用当前完整文件替换烘焙区旧版本 + 清空 pendingDiffs */
  private foldDiffs(): void {
    this._snapshot = this.readFileContent();
    this._commitHash = this.computeHash();
    this._pendingDiffs = [];
  }

  /** 推断文件类型 */
  private inferFileType(): FileType {
    const ext = this.path.split(".").pop()?.toLowerCase() ?? "";
    if (["json", "yaml", "yml", "toml", "ini", "env"].includes(ext)) return "structured";
    if (["ts", "tsx", "js", "jsx", "py", "go", "rs", "java", "kt", "rb"].includes(ext)) return "code";
    return "text";
  }

  /**
   * 生成结构化 diff
   *
   * 按文件类型选择格式：
   * - structured: 字段级对比（需要 deep-diff 库，这里用简单实现）
   * - code: 函数/语义块级对比（git diff + 正则归组）
   * - text: 段落级对比
   */
  private generateStructuredDiff(oldContent: string, newContent: string): string | null {
    const fileType = this.inferFileType();

    if (fileType === "structured") {
      return this.structuredDiff(oldContent, newContent);
    }
    if (fileType === "code") {
      return this.codeDiff(oldContent, newContent);
    }
    return this.paragraphDiff(oldContent, newContent);
  }

  /** 结构化文件 diff：字段级对比 */
  private structuredDiff(oldContent: string, newContent: string): string | null {
    try {
      const oldObj = this.parseStructured(oldContent);
      const newObj = this.parseStructured(newContent);
      if (!oldObj || !newObj) return this.fallbackLineDiff(oldContent, newContent);

      const changes = this.deepDiff(oldObj, newObj, "");
      if (changes.length === 0) return null;
      return `变更字段：\n${changes.join("\n")}`;
    } catch {
      return this.fallbackLineDiff(oldContent, newContent);
    }
  }

  /** 代码文件 diff：函数/语义块级对比 */
  private codeDiff(oldContent: string, newContent: string): string | null {
    const lineDiff = this.fallbackLineDiff(oldContent, newContent);
    if (!lineDiff) return null;
    // 简单实现：直接用行级 diff，后续可用正则归组到函数
    return `变更：\n${lineDiff}`;
  }

  /** 纯文本文件 diff：段落级对比 */
  private paragraphDiff(oldContent: string, newContent: string): string | null {
    const oldParagraphs = oldContent.split(/\n\s*\n/);
    const newParagraphs = newContent.split(/\n\s*\n/);

    const changes: string[] = [];
    const maxLen = Math.max(oldParagraphs.length, newParagraphs.length);

    for (let i = 0; i < maxLen; i++) {
      const oldP = oldParagraphs[i];
      const newP = newParagraphs[i];
      if (oldP === undefined && newP !== undefined) {
        changes.push(`  第${i + 1}段: 新增 "${newP.slice(0, 50)}..."`);
      } else if (oldP !== undefined && newP === undefined) {
        changes.push(`  第${i + 1}段: 删除 "${oldP.slice(0, 50)}..."`);
      } else if (oldP !== newP) {
        changes.push(`  第${i + 1}段: 变更`);
      }
    }

    if (changes.length === 0) return null;
    return `变更段落：\n${changes.join("\n")}`;
  }

  /** 行级 diff（fallback） */
  private fallbackLineDiff(oldContent: string, newContent: string): string | null {
    const oldLines = oldContent.split("\n");
    const newLines = newContent.split("\n");
    const changes: string[] = [];

    const maxLen = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < maxLen; i++) {
      if (oldLines[i] !== newLines[i]) {
        if (i >= oldLines.length) {
          changes.push(`  + ${newLines[i]}`);
        } else if (i >= newLines.length) {
          changes.push(`  - ${oldLines[i]}`);
        } else {
          changes.push(`  - ${oldLines[i]}\n  + ${newLines[i]}`);
        }
      }
    }

    if (changes.length === 0) return null;
    return changes.join("\n");
  }

  /** 解析结构化文件内容为对象 */
  private parseStructured(content: string): Record<string, unknown> | null {
    const ext = this.path.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "json") {
      return JSON.parse(content) as Record<string, unknown>;
    }
    // YAML/TOML 需要额外库，这里 fallback 到 null
    return null;
  }

  /** 简单 deep diff（生产环境建议用 deep-diff 库） */
  private deepDiff(oldObj: unknown, newObj: unknown, path: string): string[] {
    const changes: string[] = [];

    if (typeof oldObj !== typeof newObj) {
      changes.push(`  ${path || "(root)"}: ${JSON.stringify(oldObj)} → ${JSON.stringify(newObj)}`);
      return changes;
    }

    if (typeof newObj === "object" && newObj !== null && !Array.isArray(newObj)) {
      const oldRec = oldObj as Record<string, unknown>;
      const newRec = newObj as Record<string, unknown>;
      const allKeys = new Set([...Object.keys(oldRec), ...Object.keys(newRec)]);

      for (const key of allKeys) {
        const keyPath = path ? `${path}.${key}` : key;
        if (!(key in oldRec)) {
          changes.push(`  ${keyPath}: 新增 ${JSON.stringify(newRec[key])}`);
        } else if (!(key in newRec)) {
          changes.push(`  ${keyPath}: 删除 ${JSON.stringify(oldRec[key])}`);
        } else if (oldRec[key] !== newRec[key]) {
          if (typeof oldRec[key] === "object" && typeof newRec[key] === "object") {
            changes.push(...this.deepDiff(oldRec[key], newRec[key], keyPath));
          } else {
            changes.push(`  ${keyPath}: ${JSON.stringify(oldRec[key])} → ${JSON.stringify(newRec[key])}`);
          }
        }
      }
    } else if (oldObj !== newObj) {
      changes.push(`  ${path || "(root)"}: ${JSON.stringify(oldObj)} → ${JSON.stringify(newObj)}`);
    }

    return changes;
  }
}

// ── 简易版工厂函数 ────────────────────────────────────────────────────────

/**
 * bake() — 简易版，一行创建 BakeFile
 *
 * 默认 mode 为链式 diff，maxPendingDiffs=3
 * 后续自动在压缩等情况下自动渲染，每次 user 发送时自动注入更新内容
 */
export function bake(
  tag: string,
  path: string,
  hint: string,
  mode?: BakeMode,
): BakeFile {
  return new BakeFile({ tag, path, hint, mode: mode ?? "diff" });
}
