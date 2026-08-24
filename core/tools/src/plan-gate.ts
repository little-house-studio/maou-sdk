/**
 * 计划模式写盘门控：进行中只允许改会话计划文件。
 */

import { resolve as resolvePath } from "node:path";
import { createToolResponse } from "./base.js";
import type { ToolContext, ToolResponse } from "./base.js";

export function isSessionPlanFile(ctx: ToolContext, absPath: string): boolean {
  const planFile = ctx.planFile?.trim();
  if (!planFile) return false;
  return resolvePath(absPath) === resolvePath(planFile);
}

export function denyNonPlanWrite(ctx: ToolContext, absPath: string): ToolResponse | undefined {
  if (ctx.agentMode !== "plan") return undefined;
  const planFile = ctx.planFile?.trim();
  if (!planFile) {
    return createToolResponse(false, "plan mode is active; only the session plan file may be written");
  }
  if (resolvePath(absPath) === resolvePath(planFile)) return undefined;
  return createToolResponse(
    false,
    `plan mode allows writes only to the session plan file: ${planFile}`,
  );
}
