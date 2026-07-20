/**
 * Token 计数 —— 轻量估算（无需 tiktoken 依赖）
 *
 * 文本启发式权威实现：`@little-house-studio/types` 的 `estimateTokensFromText`
 *（与 context 包共用，避免 CLI / Runtime 数字漂移）。
 *
 * 用途：发送前估算 token、UI 显示"X/上下文窗口"、压缩阈值决策。
 */

import { estimateTokensFromText } from "@little-house-studio/types";

/** 启发式 token 估算（文本）—— 与 types/context 同一公式 */
export function estimateTokens(text: string): number {
  return estimateTokensFromText(text);
}

/** 估算一个 Context 的总输入 token（system + messages + tools schema） */
export function estimateContextTokens(ctx: {
  systemPrompt?: string;
  messages: Array<{ content?: unknown }>;
  tools?: Array<{ parameters?: unknown; name?: string; description?: string }>;
}): number {
  let total = 0;
  if (ctx.systemPrompt) total += estimateTokens(ctx.systemPrompt);
  for (const m of ctx.messages) {
    const c = m.content;
    if (typeof c === "string") total += estimateTokens(c);
    else if (Array.isArray(c)) {
      for (const part of c) {
        if (part && typeof part === "object") {
          const t = (part as Record<string, unknown>).text;
          if (typeof t === "string") total += estimateTokens(t);
          // 图片：粗估 1000 token/张（vision token 因模型而异）
          if ((part as Record<string, unknown>).type === "image") total += 1000;
        }
      }
    }
  }
  // 工具 schema：粗略按 JSON 长度
  for (const tool of ctx.tools ?? []) {
    try {
      total += estimateTokens(JSON.stringify(tool));
    } catch {
      total += 50;
    }
  }
  return total;
}

/**
 * 判断 Context 是否会超模型上下文窗口，建议动作。
 * @returns ok / needCompress / overflow
 */
export function checkContextFit(
  ctxTokens: number,
  contextWindow: number,
  reserveOutput = 4096,
): { status: "ok" | "needCompress" | "overflow"; remaining: number; ratio: number } {
  const usable = contextWindow - reserveOutput;
  const ratio = ctxTokens / usable;
  if (ratio > 1) return { status: "overflow", remaining: usable - ctxTokens, ratio };
  if (ratio > 0.7) return { status: "needCompress", remaining: usable - ctxTokens, ratio };
  return { status: "ok", remaining: usable - ctxTokens, ratio };
}
