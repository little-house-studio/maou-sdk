/**
 * 工具返回体的统一收口：超限时头尾进上下文，全文落盘并在正文里给出路。
 *
 * 只有 use_terminal 有过这个待遇，其余十几个工具是纯截断、字节永久丢失。
 */

import type { ToolCall, ToolContext, ToolResponse } from "./base.js";
import { applyOutputLimit } from "./terminal/overflow.js";

/** 单条工具返回进上下文的字符上限。 */
export const TOOL_OUTPUT_SPILL_LIMIT = 60_000;

/**
 * read 家族豁免：它们本来就是「按范围取文件」的入口。
 * 给它们外溢会造出「读 → 溢 → 再读那个溢出文件 → 又溢」的死循环。
 */
const SPILL_EXEMPT = new Set([
  "read",
  "read_file",
  "reader",
  "read_image",
  "read_web",
  "web_fetch",
  "fetch_url",
]);

export function isSpillExempt(toolName: string): boolean {
  return SPILL_EXEMPT.has(String(toolName ?? "").trim().toLowerCase());
}

/**
 * 落盘失败不改判：拿不到 projectRoot、写盘报错都只回落纯截断，
 * 绝不把成功的工具调用改口成失败。
 */
export function applySpillGuard(
  result: ToolResponse,
  toolCall: ToolCall,
  ctx: ToolContext,
  limit = TOOL_OUTPUT_SPILL_LIMIT,
): ToolResponse {
  const message = result?.message;
  if (typeof message !== "string" || message.length <= limit) return result;
  if (isSpillExempt(toolCall.name)) return result;

  const sourceId = `${toolCall.name}-${toolCall.id ?? "call"}`;
  const spilled = applyOutputLimit(message, limit, {
    sessionId: ctx.sessionId,
    projectRoot: ctx.projectRoot,
    sourceId,
  });
  if (spilled.text === message) return result;

  return {
    ...result,
    message: spilled.text,
    ...(spilled.overflowPath
      ? { payload: { ...(result.payload ?? {}), spillPath: spilled.overflowPath } }
      : {}),
  };
}
