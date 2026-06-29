/**
 * DynamicToolLoader — 从 agent/tools/ 目录自动发现并加载 .ts 工具文件
 *
 * 核心机制：
 * 1. 扫描 agent 的 tools/ 目录下的 .ts 文件
 * 2. 动态 import 每个 .ts 文件
 * 3. 期望文件 export default 一个旧式 Tool 实例（new XxxTool()）或类（XxxTool）
 * 4. 用文件名（去掉扩展名）作为工具名，注册到 ToolRegistry
 *
 * 也支持 .json schema 文件（纯 schema，无可执行逻辑，仅供 LLM 调用参考）
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import type { ToolRegistry } from "./registry.js";
import type { Tool } from "./base.js";
import { Tool as ToolClass } from "./base.js";

/** 加载结果 */
export interface DynamicToolLoadResult {
  /** 成功加载的工具名 */
  loaded: string[];
  /** 加载失败的工具名及原因 */
  failed: Array<{ name: string; error: string }>;
  /** 跳过的文件（非 .ts/.json） */
  skipped: string[];
}

/**
 * 动态工具加载器
 * 从文件系统自动发现并加载 agent 级工具
 */
export class DynamicToolLoader {
  /**
   * 扫描目录并加载所有 .ts 工具文件到 ToolRegistry
   *
   * @param toolsDir - agent 的 tools/ 目录路径
   * @param registry - ToolRegistry 实例
   * @returns 加载结果
   */
  static async loadFromDir(
    toolsDir: string,
    registry: ToolRegistry,
  ): Promise<DynamicToolLoadResult> {
    const result: DynamicToolLoadResult = { loaded: [], failed: [], skipped: [] };

    if (!existsSync(toolsDir)) return result;

    let entries: string[];
    try {
      entries = readdirSync(toolsDir).sort();
    } catch {
      return result;
    }

    for (const entry of entries) {
      const fullPath = join(toolsDir, entry);

      // 跳过 .gitkeep 等隐藏/占位文件
      if (entry.startsWith(".") || entry === ".gitkeep") {
        result.skipped.push(entry);
        continue;
      }

      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        result.skipped.push(entry);
        continue;
      }

      if (stat.isDirectory()) {
        // 递归扫描子目录（如 tools/database/query.ts → 工具名 "database/query"）
        const subResult = await DynamicToolLoader._loadSubDir(
          fullPath,
          entry,
          registry,
        );
        result.loaded.push(...subResult.loaded);
        result.failed.push(...subResult.failed);
        result.skipped.push(...subResult.skipped);
        continue;
      }

      if (entry.endsWith(".ts") || entry.endsWith(".mjs")) {
        const toolName = basename(entry, entry.endsWith(".ts") ? ".ts" : ".mjs");
        try {
          const adapter = await DynamicToolLoader._loadToolFile(fullPath, toolName);
          if (adapter) {
            registry.register(adapter);
            result.loaded.push(toolName);
          } else {
            result.skipped.push(entry);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.failed.push({ name: toolName, error: msg });
        }
      } else {
        result.skipped.push(entry);
      }
    }

    return result;
  }

  /**
   * 递归扫描子目录
   */
  private static async _loadSubDir(
    dir: string,
    prefix: string,
    registry: ToolRegistry,
  ): Promise<DynamicToolLoadResult> {
    const result: DynamicToolLoadResult = { loaded: [], failed: [], skipped: [] };

    let entries: string[];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      return result;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      if (entry.startsWith(".")) {
        result.skipped.push(`${prefix}/${entry}`);
        continue;
      }

      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        result.skipped.push(`${prefix}/${entry}`);
        continue;
      }

      if (stat.isDirectory()) {
        const subResult = await DynamicToolLoader._loadSubDir(
          fullPath,
          `${prefix}/${entry}`,
          registry,
        );
        result.loaded.push(...subResult.loaded);
        result.failed.push(...subResult.failed);
        result.skipped.push(...subResult.skipped);
      } else if (entry.endsWith(".ts") || entry.endsWith(".mjs")) {
        const toolName = `${prefix}/${basename(entry, entry.endsWith(".ts") ? ".ts" : ".mjs")}`;
        try {
          const adapter = await DynamicToolLoader._loadToolFile(fullPath, toolName);
          if (adapter) {
            registry.register(adapter);
            result.loaded.push(toolName);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.failed.push({ name: toolName, error: msg });
        }
      } else {
        result.skipped.push(`${prefix}/${entry}`);
      }
    }

    return result;
  }

  /**
   * 加载单个工具 .ts 文件
   *
   * 期望文件 export default 一个旧式 Tool：
   *   - 实例：`export default new XxxTool()`（推荐）
   *   - 类：`export default XxxTool`（自动实例化）
   */
  private static async _loadToolFile(
    filePath: string,
    toolName: string,
  ): Promise<Tool | null> {
    try {
      // 动态 import（支持 .ts 通过 tsx/ts-node 运行时，或编译后的 .mjs）
      const absolutePath = resolve(filePath);
      const module = await import(absolutePath);

      const defaultExport = module.default;
      if (!defaultExport) return null;

      // 旧式 Tool 实例（extends Tool，export default new XxxTool()）
      if (defaultExport instanceof ToolClass) {
        return defaultExport;
      }

      // 旧式 Tool 类（export default XxxTool，未 new）—— 实例化
      if (typeof defaultExport === "function" && defaultExport.prototype instanceof ToolClass) {
        return new (defaultExport as new () => Tool)();
      }

      return null;
    } catch (err) {
      throw new Error(`加载工具文件 ${filePath} 失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
