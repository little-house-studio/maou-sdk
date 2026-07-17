/**
 * Prompt 编译器 —— 递归解析 {{file.md}} 包含指令，剥离 <description> 块。
 * 对应 Python: core/agent/prompt/compiler/compiler.py
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, relative, dirname, posix, join, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as os from "node:os";

// ─── 类型 ──────────────────────────────────────────────────────────────────

export interface PromptCompilerOptions {
  /** prompt 根目录 */
  promptRoot: string;
  /** 项目根目录（脚本执行 cwd），默认 process.cwd() */
  projectRoot?: string;
  /** 入口文件名，默认 SYSTEM.md */
  entrypoint?: string;
  /** 最大递归深度，默认 10 */
  maxDepth?: number;
  /** 每层最大迭代次数，默认 100 */
  maxIterationsPerLevel?: number;
}

// ─── 脚本执行缓存（进程内 + 文件，TTL 30 分钟）────────────────────
// 解决 BEFORE_USER.md 调用 get-weather.py 每次都 spawn Python + HTTP 串行耗时 ~1.9s 的问题。

const SCRIPT_CACHE_TTL_MS = 30 * 60 * 1000;
const SCRIPT_CACHE_DIR = join(os.homedir(), ".maou", "cache", "scripts");
const scriptMemCache = new Map<string, { value: string | null; expiresAt: number }>();

/** 跨平台 Python 可执行文件（Windows 常见 py / python） */
function resolvePythonBin(): string {
  const candidates =
    process.platform === "win32"
      ? ["py", "python", "python3"]
      : ["python3", "python"];
  for (const c of candidates) {
    try {
      const args = c === "py" ? ["-3", "--version"] : ["--version"];
      execFileSync(c, args, { stdio: "ignore", timeout: 3000 });
      return c === "py" ? "py" : c;
    } catch {
      /* next */
    }
  }
  return process.platform === "win32" ? "python" : "python3";
}

function scriptCacheKey(scriptPath: string): string {
  return createHash("sha1").update(scriptPath).digest("hex");
}

function getScriptCache(scriptPath: string): string | null | undefined {
  const key = scriptCacheKey(scriptPath);
  const now = Date.now();

  // 进程内缓存
  const mem = scriptMemCache.get(key);
  if (mem && mem.expiresAt > now) return mem.value;

  // 文件缓存
  const file = join(SCRIPT_CACHE_DIR, `${key}.json`);
  try {
    if (!existsSync(file)) return undefined;
    const raw = JSON.parse(readFileSync(file, "utf-8")) as {
      value: string | null;
      scriptPath: string;
      expiresAt: number;
    };
    if (raw.scriptPath !== scriptPath || raw.expiresAt <= now) return undefined;
    // 回填进程内缓存
    scriptMemCache.set(key, { value: raw.value, expiresAt: raw.expiresAt });
    return raw.value;
  } catch {
    return undefined;
  }
}

function setScriptCache(scriptPath: string, value: string | null): void {
  const key = scriptCacheKey(scriptPath);
  const expiresAt = Date.now() + SCRIPT_CACHE_TTL_MS;
  scriptMemCache.set(key, { value, expiresAt });
  try {
    mkdirSync(SCRIPT_CACHE_DIR, { recursive: true });
    writeFileSync(
      join(SCRIPT_CACHE_DIR, `${key}.json`),
      JSON.stringify({ scriptPath, value, expiresAt }),
      "utf-8",
    );
  } catch {
    // 文件缓存写入失败不影响进程内缓存
  }
}

// ─── 实现 ──────────────────────────────────────────────────────────────────

export class PromptCompiler {
  promptRoot: string;
  private projectRoot: string;
  private entrypoint: string;
  private maxDepth: number;
  private maxIterationsPerLevel: number;

  constructor(options: PromptCompilerOptions) {
    this.promptRoot = resolve(options.promptRoot);
    this.projectRoot = resolve(options.projectRoot ?? process.cwd());
    this.entrypoint = options.entrypoint ?? "SYSTEM.md";
    this.maxDepth = options.maxDepth ?? 10;
    this.maxIterationsPerLevel = options.maxIterationsPerLevel ?? 100;
  }

  /** 更新配置 */
  configure(promptRoot: string, entrypoint: string): void {
    this.promptRoot = resolve(promptRoot);
    this.entrypoint = entrypoint;
  }

  /** 解析入口路径 */
  resolveEntryPath(entrypoint?: string): string {
    if (!entrypoint) {
      return resolve(this.promptRoot, this.entrypoint);
    }
    if (resolve(entrypoint) === entrypoint) {
      return resolve(entrypoint);
    }
    return resolve(this.promptRoot, entrypoint);
  }

  /**
   * 编译入口文件，递归解析所有 {{include}} 指令。
   * 返回编译后的完整 prompt 字符串。
   */
  compile(entrypoint?: string): string {
    const entryPath = this.resolveEntryPath(entrypoint);
    const text = readFileSync(entryPath, "utf-8");
    const rootDir = posix.dirname(
      relative(this.promptRoot, entryPath).split(sep).join(posix.sep),
    );
    return this.resolvePlaceholders(text, rootDir, 0, new Set());
  }

  // ── 内部方法 ─────────────────────────────────────────────────────────────

  /**
   * 递归解析 {{file.md}} 和 {{>>script.py}} 占位符。
   */
  private resolvePlaceholders(
    text: string,
    currentDir: string,
    depth: number,
    processing: Set<string>,
  ): string {
    if (depth >= this.maxDepth) return text;

    let output = text;
    let iterations = 0;

    while (iterations < this.maxIterationsPerLevel) {
      let found = false;

      // ── 处理脚本占位符 {{>>script}} ──
      while (true) {
        const scriptMatch = output.match(/\{\{>>([^}]+)\}\}/);
        if (!scriptMatch) break;
        found = true;
        const relativePath = scriptMatch[1].trim();
        const resolvedPath = this.resolveRelativePath(currentDir, relativePath);
        const key = `script:${resolvedPath}`;
        let replacement: string;
        if (processing.has(key)) {
          replacement = `[循环引用跳过: ${relativePath}]`;
        } else {
          const resolved = this.resolveBuiltinScript(relativePath);
          replacement = resolved ?? `[脚本执行不支持: ${relativePath}]`;
        }
        output = output.replace(scriptMatch[0], replacement);
      }

      // ── 处理文件占位符 {{file.md}} ──
      while (true) {
        const fileMatch = output.match(/\{\{([^}>][^}]*)\}\}/);
        if (!fileMatch) break;
        found = true;
        const relativePath = fileMatch[1].trim();
        const resolvedPath = this.resolveRelativePath(currentDir, relativePath);
        const key = `file:${resolvedPath}`;

        if (processing.has(key)) {
          output = output.replace(fileMatch[0], `[循环引用跳过: ${relativePath}]`);
          continue;
        }

        const fullPath = resolve(this.promptRoot, resolvedPath);
        if (!existsSync(fullPath)) {
          output = output.replace(fileMatch[0], `[文件未找到: ${relativePath}]`);
          continue;
        }

        processing.add(key);
        try {
          const fileContent = readFileSync(fullPath, "utf-8");
          const processed = this.processContent(fileContent, resolvedPath, depth);
          const childDir = posix.dirname(resolvedPath.split(sep).join(posix.sep));
          const resolved = this.resolvePlaceholders(
            processed,
            childDir,
            depth + 1,
            processing,
          );
          output = output.replace(fileMatch[0], resolved);
        } finally {
          processing.delete(key);
        }
      }

      if (!found) break;
      iterations++;
    }

    return output;
  }

  /**
   * 处理文件内容：剥离 <description> 块。
   */
  private processContent(content: string, _filePath: string, _depth: number): string {
    // 剥离 <description>...</description> 注释块
    let result = content.replace(/<description>[\s\S]*?<\/description>/g, "");

    // 剥离 # description 开头的段落
    result = result.replace(
      /^# description\b[\s\S]*?(?=^#\s|\Z)/gim,
      "",
    );

    return result;
  }

  /**
   * 脚本解析器 —— 优先执行 Python 脚本，失败时用 Node.js 原生 fallback。
   * 返回 null 表示无法解析（交由调用方 fallback）。
   */
  private resolveBuiltinScript(scriptPath: string): string | null {
    // 优先尝试执行实际 Python 脚本
    const fullPath = resolve(this.promptRoot, scriptPath);
    if (existsSync(fullPath)) {
      const result = this.executePythonScript(fullPath);
      if (result !== null) return result;
    }

    // Python 执行失败，使用 Node.js 原生 fallback
    const name = posix.basename(scriptPath).replace(/\.[^.]+$/, "");

    switch (name) {
      case "environment-path":
        return process.cwd();

      case "get-system":
        return `${os.type()} ${os.release()} (${os.arch()})`;

      case "get-time":
        return new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });

      default:
        return null;
    }
  }

  /**
   * 执行 Python 脚本，返回 stdout 内容。失败返回 null。
   * 带两层缓存（进程内 + 文件，TTL 30 分钟），避免重复 spawn Python + 网络请求。
   */
  private executePythonScript(scriptPath: string): string | null {
    const cached = getScriptCache(scriptPath);
    if (cached !== undefined) {
      console.log(`[prompt-compiler] script cache HIT: ${scriptPath}`);
      return cached;
    }
    try {
      const py = resolvePythonBin();
      const args = py === "py" ? ["-3", scriptPath] : [scriptPath];
      const stdout = execFileSync(py, args, {
        timeout: 10_000,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
        cwd: this.projectRoot,
      });
      const trimmed = stdout.trim();
      const result = trimmed.length > 0 ? trimmed : null;
      setScriptCache(scriptPath, result);
      console.log(`[prompt-compiler] script cache MISS (已写入): ${scriptPath}`);
      return result;
    } catch {
      return null;
    }
  }

  /**
   * 解析相对路径。
   * 对应 Python: _resolve_relative_path
   */
  private resolveRelativePath(currentDir: string, relativePath: string): string {
    // 以 "/" 开头 → 相对 prompt root
    if (relativePath.startsWith("/")) {
      return relativePath.replace(/^\/+/, "");
    }

    // 以 "./" 或 "../" 开头 → 从当前目录解析
    if (relativePath.startsWith("./") || relativePath.startsWith("../")) {
      const absolutePath = resolve(this.promptRoot, currentDir, relativePath);
      return relative(this.promptRoot, absolutePath).split(sep).join(posix.sep);
    }

    // 含 "/" → 视为从 prompt root 开始的相对路径
    if (relativePath.includes("/")) {
      return relativePath;
    }

    // 纯文件名 → 相对当前目录
    return posix.join(currentDir.split(sep).join(posix.sep), relativePath);
  }
}
