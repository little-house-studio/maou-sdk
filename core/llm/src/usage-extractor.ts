/**
 * usage 提取器 —— 从 LLM 流式事件 / 完整响应中提取 token 用量
 *
 * protocol-specific（OpenAI 的 data.usage / Anthropic 的 message_start·message_delta /
 * Gemini 的 usageMetadata），纯函数。
 */

import type { LLMUsage } from "./adapters/types.js";

function copyUsageObject(usage: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(usage)) {
    if (typeof v === "number") result[k] = Math.floor(v);
    else if (typeof v === "object" && v !== null) result[k] = v;
  }
  flattenDetails(result, usage);
  return result;
}

/** 把 details 里的 cached / write 提升到顶层，normalizeCacheUsage 也能直接读嵌套 */
function flattenDetails(
  result: Record<string, unknown>,
  usage: Record<string, unknown>,
): void {
  for (const key of ["prompt_tokens_details", "input_tokens_details"] as const) {
    const details = usage[key];
    if (!details || typeof details !== "object") continue;
    const d = details as Record<string, unknown>;
    if (typeof d.cached_tokens === "number") {
      const cur = typeof result.cached_tokens === "number" ? result.cached_tokens : 0;
      result.cached_tokens = Math.max(cur, Math.floor(d.cached_tokens));
    }
    if (typeof d.cache_write_tokens === "number") {
      const cur = typeof result.cache_write_tokens === "number" ? result.cache_write_tokens : 0;
      result.cache_write_tokens = Math.max(cur, Math.floor(d.cache_write_tokens));
    }
  }
}

/** Gemini usageMetadata → 与 OpenAI 对齐的字段，供 normalizeCacheUsage 使用 */
function fromGeminiMetadata(meta: Record<string, unknown>): LLMUsage | null {
  const prompt = meta.promptTokenCount ?? meta.prompt_token_count;
  const output = meta.candidatesTokenCount ?? meta.candidates_token_count ?? meta.outputTokenCount;
  const cached = meta.cachedContentTokenCount ?? meta.cached_content_token_count;
  const total = meta.totalTokenCount ?? meta.total_token_count;
  const result: Record<string, unknown> = {};
  if (typeof prompt === "number") result.prompt_tokens = Math.floor(prompt);
  if (typeof output === "number") result.completion_tokens = Math.floor(output);
  if (typeof cached === "number") result.cached_tokens = Math.floor(cached);
  if (typeof total === "number") result.total_tokens = Math.floor(total);
  return Object.keys(result).length > 0 ? (result as LLMUsage) : null;
}

/** 从事件或完整响应中提取 usage（流式 SSE 与非流式 JSON 共用） */
export function extractUsageFromEvent(
  data: Record<string, unknown>,
  protocol: string,
): LLMUsage | null {
  if (data.usage && typeof data.usage === "object") {
    const result = copyUsageObject(data.usage as Record<string, unknown>);
    return Object.keys(result).length > 0 ? (result as LLMUsage) : null;
  }

  const geminiMeta = data.usageMetadata ?? data.usage_metadata;
  if (geminiMeta && typeof geminiMeta === "object") {
    return fromGeminiMetadata(geminiMeta as Record<string, unknown>);
  }

  if (protocol === "anthropic") {
    if (
      data.type === "message_start" &&
      typeof data.message === "object" &&
      data.message !== null
    ) {
      const usage = (data.message as Record<string, unknown>).usage;
      if (usage && typeof usage === "object") {
        const result = copyUsageObject(usage as Record<string, unknown>);
        return Object.keys(result).length > 0 ? (result as LLMUsage) : null;
      }
    }
    if (data.type === "message_delta" && typeof data.usage === "object" && data.usage !== null) {
      const result = copyUsageObject(data.usage as Record<string, unknown>);
      return Object.keys(result).length > 0 ? (result as LLMUsage) : null;
    }
  }

  return null;
}
