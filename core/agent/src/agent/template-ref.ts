/**
 * Agent 模板引用解析 —— 共享工具函数。
 * 被 template.ts 和 preview.ts 同时使用，避免循环依赖。
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 读取 .agent.ref 获取模板路径。
 * 如果不存在 .agent.ref，返回 null（可能是旧模式复制的 agent）。
 */
export function getTemplateRef(agentDir: string): string | null {
  const refPath = join(agentDir, ".agent.ref");
  if (!existsSync(refPath)) return null;
  try {
    const ref = readFileSync(refPath, "utf-8").trim();
    if (ref && existsSync(ref)) return ref;
    return null;
  } catch {
    return null;
  }
}
