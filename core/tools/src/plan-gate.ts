/**
 * 会话计划文件路径比对。write_file 对计划文件跳过先读后写。
 */

import { resolve as resolvePath } from "node:path";
import type { ToolContext } from "./base.js";

export function isSessionPlanFile(ctx: ToolContext, absPath: string): boolean {
  const planFile = ctx.planFile?.trim();
  if (!planFile) return false;
  return resolvePath(absPath) === resolvePath(planFile);
}
