/**
 * Glob 工具 — 按模式查找文件
 * 优先使用 ripgrep (rg --files)，降级到 Node.js 原生实现
 */

import { execFile, spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { resolve, relative, join, sep } from "node:path";
import { platform } from "node:os";
import { Tool, toolDir } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { createToolResponse } from "../../base.js";

/** Node.js 降级方案用的跳过目录（rg 模式自动读 .gitignore） */
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "__pycache__",
  ".venv",
  "venv",
  ".next",
  "dist",
  "build",
  ".cache",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  "coverage",
]);

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

/**
 * 使用 ripgrep 查找文件（自动读 .gitignore，比 Node.js 遍历快）
 */
function globWithRg(pattern: string, searchDir: string, headLimit: number): Promise<string[]> {
  return new Promise((resolve) => {
    const args = [
      "--files",
      "--color=never",
      "--glob", pattern,
      searchDir,
    ];
    execFile("rg", args, { maxBuffer: 5 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      if (err && !stdout) {
        resolve([]);
        return;
      }
      const lines = (stdout ?? "").split("\n").filter((l) => l.length > 0);
      resolve(lines.slice(0, headLimit));
    });
  });
}

/**
 * 简易 glob 模式匹配（支持 **, *, ?）
 * 避免引入外部依赖
 */
function globMatch(pattern: string, text: string): boolean {
  // 将 glob 转换为正则
  let regex = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i]!;
    if (ch === "*" && pattern[i + 1] === "*") {
      // ** 匹配任意路径段
      regex += ".*";
      i += 2;
      // 跳过紧跟的 /
      if (pattern[i] === "/") i++;
    } else if (ch === "*") {
      regex += "[^/]*";
      i++;
    } else if (ch === "?") {
      regex += "[^/]";
      i++;
    } else if (ch === ".") {
      regex += "\\.";
      i++;
    } else {
      regex += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i++;
    }
  }
  const re = new RegExp(`^${regex}$`);
  return re.test(text);
}

/**
 * 递归遍历目录，收集匹配文件
 */
function walkDir(
  dir: string,
  pattern: string,
  projectRoot: string,
  results: { path: string; mtime: number }[],
  limit: number,
): void {
  if (results.length >= limit) return;

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (results.length >= limit) return;

    const fullPath = join(dir, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      if (!SKIP_DIRS.has(entry)) {
        walkDir(fullPath, pattern, projectRoot, results, limit);
      }
      continue;
    }

    // 计算相对于项目根的路径
    const relPath = relative(projectRoot, fullPath);
    if (globMatch(pattern, relPath) || globMatch(pattern, entry)) {
      results.push({ path: relPath, mtime: stat.mtimeMs });
    }
  }
}

export class GlobTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);
  readonly definition: ToolDefinition = {
    name: "glob",
    aliases: ["find-files", "ls-glob"],
    description:
      "按文件名模式查找文件。返回匹配的文件路径，按修改时间排序（最新优先）。" +
      " 自动跳过 .gitignore 中的目录（node_modules、dist 等）。" +
      " 支持递归如 '**/*.py' 或平级如 '*.js'。",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Glob 模式。如 '**/*.py'、'src/*.ts'、'*.md'。",
        },
        path: {
          type: "string",
          description: "搜索目录，相对于项目根目录。默认整个项目。",
        },
        head_limit: {
          type: "integer",
          minimum: 1,
          maximum: 500,
          description: "最大返回文件数。默认 100。",
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
      return createToolResponse(false, '❌ glob 缺少必填参数 pattern（glob 匹配模式）。正确用法示例：\n{"tool": "glob", "params": {"pattern": "**/*.ts", "reason": "查找所有 TypeScript 文件"}}\n请用正确的 pattern 参数重试。');
    }

    const searchPath = String(params.path ?? ".").trim();
    const rootResolved = resolve(ctx.workingDir || ctx.projectRoot);
    const searchDir = resolve(rootResolved, searchPath);

    if (searchDir !== rootResolved && !searchDir.startsWith(rootResolved + sep)) {
      return createToolResponse(false, `路径越过了项目根目录: ${searchPath}`);
    }

    const headLimit = Math.max(1, Math.min(500, Number(params.head_limit ?? 100) || 100));

    // 优先使用 ripgrep（自动读 .gitignore，更快）
    const useRg = await hasRg();
    if (useRg) {
      try {
        const rgResults = await globWithRg(pattern, searchDir, headLimit);
        if (rgResults.length > 0) {
          // rg 返回绝对路径，转为相对路径
          const relPaths = rgResults.map((p) => relative(rootResolved, p));
          const fileList = relPaths.join("\n");
          const limitNote =
            relPaths.length >= headLimit
              ? `\n[结果已达 head_limit=${headLimit}，可能还有更多匹配文件，请缩小 pattern 或提高 head_limit]`
              : "";
          return createToolResponse(
            true,
            `[method=rg] 找到 ${relPaths.length} 个匹配文件:\n${fileList}${limitNote}`,
            {
              payload: { pattern, search_path: searchPath, count: relPaths.length, files: relPaths, method: "rg" },
            },
          );
        }
        // rg 返回空，可能是 glob 不匹配，降级到 Node.js
      } catch {
        // 降级到 Node.js 实现
      }
    }

    // Node.js 降级实现
    const results: { path: string; mtime: number }[] = [];
    walkDir(searchDir, pattern, rootResolved, results, headLimit);

    // 按修改时间倒序
    results.sort((a, b) => b.mtime - a.mtime);

    if (results.length === 0) {
      // 无结果视为查询成功（与 grep 一致）：让 LLM 看到"未找到"后正常决策，
      // 而不是当成工具失败去 retry。
      return createToolResponse(true, `未找到匹配 "${pattern}" 的文件。可能的原因：(1) pattern 太窄，尝试放宽（如 "**/*.ts"）；(2) 搜索路径 ${searchPath} 不对；(3) 目标在 node_modules/.git/dist/build 等自动忽略目录内。`, {
        payload: { pattern, search_path: searchPath, count: 0, method: "node" },
      });
    }

    const fileList = results.map((r) => r.path).join("\n");
    const limitNote =
      results.length >= headLimit
        ? `\n[结果已达 head_limit=${headLimit}，可能还有更多匹配文件，请缩小 pattern 或提高 head_limit]`
        : "";
    return createToolResponse(
      true,
      `[method=node] 找到 ${results.length} 个匹配文件:\n${fileList}${limitNote}`,
      {
        payload: {
          pattern,
          search_path: searchPath,
          count: results.length,
          files: results.map((r) => r.path),
          method: "node",
        },
      },
    );
  }
}
