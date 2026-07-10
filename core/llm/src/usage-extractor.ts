/**
 * usage 提取器 —— 从 LLM 流式事件中提取 token 用量
 *
 * 从 client.ts 拆出。protocol-specific（OpenAI 的 data.usage / Anthropic 的 message_start·message_delta），
 * 但已经是纯函数（接 data + protocol 参数，无 this 依赖），独立成模块便于单测与复用。
 */

import type { LLMUsage } from "./adapters/types.js";

/** 从事件数据中提取 usage */
export function extractUsageFromEvent(
  data: Record<string, unknown>,
  protocol: string,
): LLMUsage | null {
  if (data.usage && typeof data.usage === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data.usage as Record<string, unknown>)) {
      if (typeof v === "number") {
        result[k] = Math.floor(v);
      } else if (typeof v === "object" && v !== null) {
        result[k] = v;
      }
    }
    // OpenAI: 从 prompt_tokens_details.cached_tokens 提取缓存命中数到顶层
    const promptDetails = (data.usage as Record<string, unknown>).prompt_tokens_details;
    if (promptDetails && typeof promptDetails === "object") {
      const cached = (promptDetails as Record<string, unknown>).cached_tokens;
      if (typeof cached === "number") {
        result.cached_tokens = Math.floor(cached);
      }
    }
    return Object.keys(result).length > 0 ? result as LLMUsage : null;
  }

  if (protocol === "anthropic") {
    if (
      data.type === "message_start" &&
      typeof data.message === "object" &&
      data.message !== null
    ) {
      const usage = (data.message as Record<string, unknown>).usage;
      if (usage && typeof usage === "object") {
        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(usage as Record<string, unknown>)) {
          if (typeof v === "number") result[k] = Math.floor(v);
          else if (typeof v === "object" && v !== null) result[k] = v;
        }
        return Object.keys(result).length > 0 ? result as LLMUsage : null;
      }
    }
    if (data.type === "message_delta" && typeof data.usage === "object" && data.usage !== null) {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(data.usage as Record<string, unknown>)) {
        if (typeof v === "number") result[k] = Math.floor(v);
        else if (typeof v === "object" && v !== null) result[k] = v;
      }
      return Object.keys(result).length > 0 ? result as LLMUsage : null;
    }
  }

  return null;
}
