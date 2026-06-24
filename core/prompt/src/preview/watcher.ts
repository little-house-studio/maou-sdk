/**
 * Prompt 文件监听 + 自动重编译（类 Vite HMR）
 *
 * 监听 promptRoot 目录文件变化，自动重新编译并推送预览。
 */

import { watch, type FSWatcher } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { PromptCompiler } from "../compiler/prompt-compiler.js";
import type { CompileResult } from "../compiler/types.js";

// ─── 类型 ──────────────────────────────────────────────────────────────────

export interface WatchOptions {
  /** debounce 延迟（毫秒），默认 300ms */
  debounceMs?: number;
  /** 入口文件（可选，默认用 PromptCompiler 的 entrypoint） */
  entrypoint?: string;
  /** 是否忽略 .git 目录（默认 true） */
  ignoreDotGit?: boolean;
}

export interface WatchCallback {
  (result: CompileResult): void;
}

export interface WatchErrorCallback {
  (error: Error): void;
}

// ─── PromptWatcher ─────────────────────────────────────────────────────────

export class PromptWatcher {
  private compiler: PromptCompiler;
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private debounceMs: number;
  private entrypoint?: string;
  private ignoreDotGit: boolean;
  private callbacks: WatchCallback[] = [];
  private errorCallbacks: WatchErrorCallback[] = [];

  constructor(compiler: PromptCompiler, options: WatchOptions = {}) {
    this.compiler = compiler;
    this.debounceMs = options.debounceMs ?? 300;
    this.entrypoint = options.entrypoint;
    this.ignoreDotGit = options.ignoreDotGit ?? true;
  }

  /**
   * 开始监听
   */
  start(): void {
    if (this.watcher) return;

    this.watcher = watch(
      this.compiler.promptRoot,
      { recursive: true },
      (eventType, filename) => {
        if (!filename) return;
        if (this.ignoreDotGit && filename.includes(".git")) return;
        this.scheduleRecompile();
      },
    );

    this.watcher.on("error", (err) => {
      this.errorCallbacks.forEach((cb) => cb(err));
    });
  }

  /**
   * 停止监听
   */
  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  /**
   * 注册重编译回调
   */
  onRecompile(callback: WatchCallback): this {
    this.callbacks.push(callback);
    return this;
  }

  /**
   * 注册错误回调
   */
  onError(callback: WatchErrorCallback): this {
    this.errorCallbacks.push(callback);
    return this;
  }

  /**
   * 立即触发一次编译（不等文件变化）
   */
  compileOnce(): CompileResult {
    return this.doCompile();
  }

  // ── 内部方法 ─────────────────────────────────────────────────────────────

  private scheduleRecompile(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      try {
        const result = this.doCompile();
        this.callbacks.forEach((cb) => cb(result));
      } catch (err) {
        this.errorCallbacks.forEach((cb) => cb(err instanceof Error ? err : new Error(String(err))));
      }
      this.debounceTimer = null;
    }, this.debounceMs);
  }

  private doCompile(): CompileResult {
    const startTime = Date.now();
    const includedFiles: string[] = [];
    const executedScripts: string[] = [];
    const warnings: string[] = [];

    const content = this.compiler.compile(this.entrypoint);
    const elapsedMs = Date.now() - startTime;

    // 提取警告信息（从内容中解析）
    const warningMatches = content.matchAll(/\[(文件未找到|循环引用跳过|脚本执行不支持): [^\]]+\]/g);
    for (const match of warningMatches) {
      warnings.push(match[0]);
    }

    return {
      content,
      entryPath: this.compiler.resolveEntryPath(this.entrypoint),
      elapsedMs,
      includedFiles,
      executedScripts,
      warnings,
    };
  }
}
