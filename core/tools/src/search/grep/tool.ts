/**
 * Grep 工具 — 搜索文件内容
 * 优先使用 ripgrep (rg)，降级到 Node.js 原生实现
 * 设计参考 Claude Code 的 Grep 工具，透传 rg 参数
 */

import { execFile, spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative, join, extname, sep } from "node:path";
import { platform } from "node:os";
import { Tool, toolDir } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { createToolResponse } from "../../base.js";
import { groupGrepByFile } from "../../compress/output-compressor.js";

/** 默认跳过目录（Node 降级 + rg 额外 glob，避免未 gitignore 的 node_modules 噪声） */
const SKIP_DIRS = new Set([
  ".git", "node_modules", "__pycache__", ".venv", "venv",
  ".next", "dist", "build", ".cache", "coverage", ".turbo",
  ".sqry", "target", "out", ".output",
]);

/** rg 默认排除（即使仓库没写 .gitignore 也生效；用户 glob 仍可叠加） */
const DEFAULT_RG_EXCLUDE_GLOBS = [
  "!**/node_modules/**",
  "!**/.git/**",
  "!**/dist/**",
  "!**/build/**",
  "!**/.next/**",
  "!**/coverage/**",
  "!**/.sqry/**",
  "!**/target/**",
  "!**/__pycache__/**",
  "!**/.venv/**",
  "!**/venv/**",
];

/** Node.js 降级方案用的二进制扩展名（rg 模式自动检测） */
const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico",
  ".mp3", ".mp4", ".avi", ".mov", ".wav", ".flac",
  ".zip", ".tar", ".gz", ".rar", ".7z",
  ".exe", ".dll", ".so", ".dylib",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx",
  ".woff", ".woff2", ".ttf", ".eot",
]);

/** 跨平台检测 PATH 上的命令（Win 用 where，Unix 用 which） */
function commandOnPath(name: string): boolean {
  const cmd = platform() === "win32" ? "where" : "which";
  const r = spawnSync(cmd, [name], { encoding: "utf-8", windowsHide: true });
  return r.status === 0 && Boolean(r.stdout?.trim());
}

/**
 * 检查 ripgrep 是否可用
 */
function hasRg(): Promise<boolean> {
  return Promise.resolve(commandOnPath("rg") || commandOnPath("rg.exe"));
}

/** rg 搜索参数 */
interface RgOptions {
  pattern: string;
  searchDir: string;
  glob?: string;
  type?: string;
  outputMode: "files_with_matches" | "content" | "count";
  ignoreCase: boolean;
  multiline: boolean;
  contextA?: number;
  contextB?: number;
  contextC?: number;
  headLimit: number;
}

/**
 * 使用 ripgrep 搜索（透传 rg 参数）
 */
function searchWithRg(opts: RgOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ["--color=never", "--max-columns=500"];

    // output mode
    if (opts.outputMode === "files_with_matches") {
      args.push("--files-with-matches");
    } else if (opts.outputMode === "count") {
      args.push("--count");
    } else {
      // content mode
      args.push("--no-heading", "--line-number");
    }

    if (opts.ignoreCase) args.push("--ignore-case");
    // 始终排除常见噪声目录（rg 默认读 .gitignore，但很多项目漏写 node_modules）
    for (const g of DEFAULT_RG_EXCLUDE_GLOBS) {
      args.push("--glob", g);
    }
    if (opts.glob) args.push("--glob", opts.glob);
    if (opts.type) args.push("--type", opts.type);
    if (opts.multiline) args.push("--multiline", "--multiline-dotall");

    // 上下文行（-C 优先于 -A/-B）
    if (opts.contextC != null) {
      args.push("--context", String(opts.contextC));
    } else {
      if (opts.contextA != null) args.push("--after-context", String(opts.contextA));
      if (opts.contextB != null) args.push("--before-context", String(opts.contextB));
    }

    args.push(opts.pattern, opts.searchDir);

    // execFile 避免 shell 引号在 Windows 上炸；rg 在 PATH 即可
    execFile("rg", args, { maxBuffer: 5 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      if (err && !stdout) {
        resolve("");
        return;
      }
      const lines = (stdout ?? "").split("\n").filter((l) => l.length > 0);
      const sliced = lines.slice(0, opts.headLimit);
      // content 模式按文件归组，去掉重复路径前缀（无损重组，省 token）。
      const finalLines = opts.outputMode === "content" ? groupGrepByFile(sliced) : sliced;
      resolve(finalLines.join("\n"));
    });
  });
}

/**
 * Node.js 原生搜索实现（降级方案，当 rg 不可用时）
 */
function searchWithNode(
  pattern: string,
  searchDir: string,
  projectRoot: string,
  glob: string | undefined,
  ignoreCase: boolean,
  outputMode: "files_with_matches" | "content" | "count",
  contextA: number,
  contextB: number,
  headLimit: number,
): { lines: string[]; fileCount: number; matchCount: number } {
  const results: string[] = [];
  const matchedFiles = new Set<string>();
  let totalMatches = 0;
  const flags = ignoreCase ? "gi" : "g";
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, flags);
  } catch {
    return { lines: [`无效的正则表达式: ${pattern}`], fileCount: 0, matchCount: 0 };
  }

  function walkDir(dir: string): void {
    if (results.length >= headLimit) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= headLimit) return;
      const fullPath = join(dir, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        if (!SKIP_DIRS.has(entry)) walkDir(fullPath);
        continue;
      }

      if (glob && !matchSimpleGlob(entry, glob)) continue;
      const ext = extname(entry).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext)) continue;

      try {
        const content = readFileSync(fullPath, "utf-8");
        const lines = content.split("\n");
        const relPath = relative(projectRoot, fullPath);

        for (let i = 0; i < lines.length; i++) {
          if (results.length >= headLimit) break;
          if (regex.test(lines[i]!)) {
            regex.lastIndex = 0;
            totalMatches++;
            matchedFiles.add(relPath);

            if (outputMode === "files_with_matches") {
              if (!results.includes(relPath)) results.push(relPath);
            } else if (outputMode === "content") {
              // 上下文行
              const start = Math.max(0, i - contextB);
              const end = Math.min(lines.length - 1, i + contextA);
              for (let j = start; j <= end; j++) {
                const marker = j === i ? ":" : "-";
                results.push(`${relPath}:${j + 1}${marker}${lines[j]}`);
              }
              if (end < i + contextA) results.push("--");
            }
            // count 模式在外层处理
          }
          regex.lastIndex = 0;
        }
      } catch {
        // 跳过读取失败的文件
      }
    }
  }

  walkDir(searchDir);

  if (outputMode === "count") {
    for (const f of matchedFiles) {
      results.push(`${f}:1`);
    }
  }

  return { lines: results, fileCount: matchedFiles.size, matchCount: totalMatches };
}

/**
 * 简单 glob 匹配（仅支持 * 和 ?）
 */
function matchSimpleGlob(filename: string, glob: string): boolean {
  let regex = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!;
    if (ch === "*") {
      regex += ".*";
    } else if (ch === "?") {
      regex += ".";
    } else {
      regex += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${regex}$`, "i").test(filename);
}

export class GrepTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);
  readonly definition: ToolDefinition = {
    name: "grep",
    aliases: ["search-text", "rg"],
    description:
      "用正则搜索文件内容。默认返回「文件:行号:匹配行」及可选上下文。" +
      " 底层 ripgrep（无则 Node 降级）。" +
      " output_mode=content(默认)|files_with_matches|count。",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "正则表达式。ripgrep 语法，花括号需要转义（如 interface\\{\\}）。",
        },
        path: {
          type: "string",
          description: "搜索目录或文件路径，相对于项目根目录。默认整个项目。",
        },
        glob: {
          type: "string",
          description: "限定文件类型，如 '*.py'、'*.{ts,tsx}'。比 type 参数更灵活。",
        },
        type: {
          type: "string",
          description: "rg 内置文件类型过滤，如 'js'、'py'、'rust'、'go'、'java'。比 glob 更快。",
        },
        output_mode: {
          type: "string",
          enum: ["content", "files_with_matches", "count"],
          description:
            "返回模式。content(默认)=匹配行+行号+上下文；files_with_matches=只文件名；count=每文件计数。",
        },
        ignore_case: {
          type: "boolean",
          description: "忽略大小写。默认 false。",
        },
        multiline: {
          type: "boolean",
          description: "跨行匹配（. 匹配换行符）。用于搜索多行注释、多行函数体等。默认 false。",
        },
        context: {
          type: "integer",
          minimum: 0,
          maximum: 20,
          description: "匹配行前后各显示 N 行上下文。仅 content 模式有效。",
        },
        context_after: {
          type: "integer",
          minimum: 0,
          maximum: 20,
          description: "匹配行后显示 N 行。仅 content 模式有效。与 context 互斥。",
        },
        context_before: {
          type: "integer",
          minimum: 0,
          maximum: 20,
          description: "匹配行前显示 N 行。仅 content 模式有效。与 context 互斥。",
        },
        head_limit: {
          type: "integer",
          minimum: 1,
          maximum: 500,
          description: "最大返回行数。默认 250。传 0 表示不限制。",
        },
        reason: {
          type: "string",
          description: "为什么必须调用此工具？",
        },
      },
      required: ["pattern", "reason"],
      additionalProperties: false,
    },
    allowedModes: ["plan", "execute"],
    parallelSafe: true,
  };

  async execute(
    params: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResponse> {
    const pattern = String(params.pattern ?? "").trim();
    if (!pattern) {
      return createToolResponse(false, '❌ grep 缺少必填参数 pattern（正则表达式）。正确用法示例：\n{"tool": "grep", "params": {"pattern": "function\\s+\\w+", "reason": "搜索函数定义"}}\n请用正确的 pattern 参数重试。');
    }

    const searchPath = String(params.path ?? ".").trim();
    const rootResolved = resolve(ctx.workingDir || ctx.projectRoot);
    const searchDir = resolve(rootResolved, searchPath);

    if (searchDir !== rootResolved && !searchDir.startsWith(rootResolved + sep)) {
      return createToolResponse(false, `路径越过了项目根目录: ${searchPath}`);
    }

    const globFilter = params.glob ? String(params.glob) : undefined;
    const typeFilter = params.type ? String(params.type) : undefined;
    // 默认 content：返回行号+匹配行（files_with_matches 几乎等于 glob，易被吐槽「白搜」）
    const outputMode = (params.output_mode as string) || "content";
    const validOutputMode = ["files_with_matches", "content", "count"].includes(outputMode)
      ? (outputMode as "files_with_matches" | "content" | "count")
      : "content";
    const ignoreCase = Boolean(params.ignore_case);
    const multiline = Boolean(params.multiline);
    const contextC = params.context != null ? Number(params.context) : undefined;
    const contextA = params.context_after != null ? Number(params.context_after) : (contextC ?? 0);
    const contextB = params.context_before != null ? Number(params.context_before) : (contextC ?? 0);
    const headLimit = Math.max(0, Math.min(500, Number(params.head_limit ?? 250) || 250));

    // 优先使用 ripgrep
    const useRg = await hasRg();
    if (useRg) {
      try {
        const output = await searchWithRg({
          pattern,
          searchDir,
          glob: globFilter,
          type: typeFilter,
          outputMode: validOutputMode,
          ignoreCase,
          multiline,
          contextA,
          contextB,
          contextC,
          headLimit,
        });
        if (!output.trim()) {
          return createToolResponse(true, "没有找到匹配的结果。", {
            payload: { pattern, search_path: searchPath, count: 0, mode: validOutputMode, method: "rg" },
          });
        }
        const matchLines = output.trim().split("\n");
        const matchCount = matchLines.length;
        const limitNote =
          headLimit > 0 && matchCount >= headLimit
            ? `\n[结果已达 head_limit=${headLimit}，可能还有更多匹配，请缩小 pattern 或提高 head_limit]`
            : "";
        const meta = `[method=rg | mode=${validOutputMode} | count=${matchCount}]`;
        return createToolResponse(true, `${meta}\n${output.trim()}${limitNote}`, {
          payload: { pattern, search_path: searchPath, count: matchCount, mode: validOutputMode, method: "rg" },
        });
      } catch {
        // 降级到 Node.js 实现
      }
    }

    // Node.js 降级实现
    const result = searchWithNode(
      pattern,
      searchDir,
      rootResolved,
      globFilter,
      ignoreCase,
      validOutputMode,
      contextA,
      contextB,
      headLimit,
    );

    if (result.lines.length === 0) {
      return createToolResponse(true, "没有找到匹配的结果。", {
        payload: { pattern, search_path: searchPath, count: 0, mode: validOutputMode, method: "node" },
      });
    }

    const limitNote =
      headLimit > 0 && result.lines.length >= headLimit
        ? `\n[结果已达 head_limit=${headLimit}，可能还有更多匹配，请缩小 pattern 或提高 head_limit]`
        : "";
    const meta = `[method=node | mode=${validOutputMode} | files=${result.fileCount} | matches=${result.matchCount}]`;
    return createToolResponse(true, `${meta}\n${result.lines.join("\n")}${limitNote}`, {
      payload: {
        pattern,
        search_path: searchPath,
        count: result.matchCount,
        files: result.fileCount,
        mode: validOutputMode,
        method: "node",
      },
    });
  }
}
