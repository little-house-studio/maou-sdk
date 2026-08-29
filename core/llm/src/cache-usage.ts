/**
 * prompt-cache usage 语义归一 —— 命中率/计费的唯一口径来源。
 *
 * 各家官方都不回「命中率」，只回 token 分桶。命中率 = cacheRead / promptTotal。
 *
 * 官方分桶（以文档为准）：
 *
 *   OpenAI Chat Completions
 *     prompt_tokens 已含命中；prompt_tokens_details.cached_tokens ⊂ prompt_tokens
 *     GPT-5.6+ 另有 details.cache_write_tokens ⊂ prompt_tokens
 *
 *   OpenAI Responses / Codex / Grok
 *     input_tokens 已含命中；input_tokens_details.cached_tokens ⊂ input_tokens
 *
 *   DeepSeek
 *     prompt_tokens = prompt_cache_hit_tokens + prompt_cache_miss_tokens
 *
 *   Gemini
 *     promptTokenCount 已含命中；cachedContentTokenCount ⊂ promptTokenCount
 *
 *   Anthropic
 *     input_tokens / cache_read_input_tokens / cache_creation_input_tokens 三者互斥
 *     promptTotal = 三者之和（小命中也要加，不能用 read>prompt 才加）
 *
 * 中转层常把命中搬到 Anthropic 字段名上再带 prompt_tokens。有 OpenAI/DeepSeek/Gemini
 * 的「已含」标记时按已含计；只有 Anthropic 原生字段 + input_tokens 时按互斥相加。
 */

/** 归一后的缓存用量（单位：token） */
export interface NormalizedCacheUsage {
  /** 本次请求完整 prompt 量（含命中与写入）—— 命中率的分母 */
  promptTotal: number;
  /** 缓存命中读取 —— 命中率的分子 */
  cacheRead: number;
  /** 缓存写入（首次建缓存）：计入 promptTotal，但不算命中 */
  cacheWrite: number;
  /** 既未命中也非写入的新增输入 = promptTotal − cacheRead − cacheWrite */
  uncached: number;
  /** 输出 token */
  output: number;
  /**
   * usage 里**是否出现过** cache 字段。
   * 不上报的模型要显示 `c—`，不能写成假 0%——判据是字段有无，与模型名无关。
   */
  reported: boolean;
}

const EMPTY: NormalizedCacheUsage = {
  promptTotal: 0,
  cacheRead: 0,
  cacheWrite: 0,
  uncached: 0,
  output: 0,
  reported: false,
};

/** 命中读取字段（各家别名）。取值用 max，避免中转层 0 占位盖掉真实命中。 */
const READ_KEYS = [
  "cache_read_input_tokens",
  "cache_hit_tokens",
  "cached_tokens",
  "prompt_cache_hit_tokens",
  "cache_tokens",
  "prompt_cache_tokens",
  "cached",
  "cache_read",
  "cacheReadTokens",
  "cachedContentTokenCount",
  "cached_content_token_count",
] as const;

/** 缓存写入字段 */
const WRITE_KEYS = [
  "cache_creation_input_tokens",
  "cache_write_tokens",
  "cacheWriteTokens",
] as const;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

function hasKey(u: Record<string, unknown>, key: string): boolean {
  const v = u[key];
  return v !== undefined && v !== null;
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

/** 所有已出现键里取最大有效值 */
function maxPick(
  u: Record<string, unknown>,
  keys: readonly string[],
): { value: number; present: boolean } {
  let present = false;
  let value = 0;
  for (const k of keys) {
    const v = u[k];
    if (v === undefined || v === null) continue;
    present = true;
    value = Math.max(value, num(v));
  }
  return { value, present };
}

function nestedCached(details: Record<string, unknown> | undefined): {
  value: number;
  present: boolean;
} {
  if (!details) return { value: 0, present: false };
  if (!hasKey(details, "cached_tokens")) return { value: 0, present: false };
  return { value: num(details.cached_tokens), present: true };
}

function nestedWrite(details: Record<string, unknown> | undefined): {
  value: number;
  present: boolean;
} {
  if (!details) return { value: 0, present: false };
  if (!hasKey(details, "cache_write_tokens")) return { value: 0, present: false };
  return { value: num(details.cache_write_tokens), present: true };
}

/** Anthropic cache_creation 对象：5m + 1h */
function cacheCreationObjectWrite(u: Record<string, unknown>): {
  value: number;
  present: boolean;
} {
  const obj = asRecord(u.cache_creation);
  if (!obj) return { value: 0, present: false };
  const five = hasKey(obj, "ephemeral_5m_input_tokens");
  const hour = hasKey(obj, "ephemeral_1h_input_tokens");
  if (!five && !hour) return { value: 0, present: false };
  return {
    value: num(obj.ephemeral_5m_input_tokens) + num(obj.ephemeral_1h_input_tokens),
    present: true,
  };
}

/** OpenAI / DeepSeek / Gemini / Responses：命中是总量的子集 */
function isInclusiveOfficial(u: Record<string, unknown>): boolean {
  if (asRecord(u.prompt_tokens_details)) return true;
  if (asRecord(u.input_tokens_details)) return true;
  if (hasKey(u, "prompt_cache_hit_tokens") || hasKey(u, "prompt_cache_miss_tokens")) {
    return true;
  }
  if (hasKey(u, "promptTokenCount") || hasKey(u, "prompt_token_count")) return true;
  if (hasKey(u, "cachedContentTokenCount") || hasKey(u, "cached_content_token_count")) {
    return true;
  }
  return false;
}

function hasAnthropicCacheFields(u: Record<string, unknown>): boolean {
  return (
    hasKey(u, "cache_read_input_tokens") ||
    hasKey(u, "cache_creation_input_tokens") ||
    asRecord(u.cache_creation) != null
  );
}

/**
 * Anthropic 官方：三个字段互斥相加。
 * 已有 prompt_tokens / details 时不当作 Anthropic（中转层常混用字段名）。
 */
function isAnthropicAdditive(u: Record<string, unknown>): boolean {
  if (!hasAnthropicCacheFields(u)) return false;
  if (isInclusiveOfficial(u)) return false;
  if (hasKey(u, "prompt_tokens")) return false;
  return hasKey(u, "input_tokens") || hasKey(u, "inputTokens");
}

/**
 * 把任意家的 usage 归一成统一口径。
 * 无 usage / 无法识别时返回全 0（`reported: false`）。
 */
export function normalizeCacheUsage(
  usage: Record<string, unknown> | null | undefined,
): NormalizedCacheUsage {
  if (!usage || typeof usage !== "object") return { ...EMPTY };

  const promptDetails = asRecord(usage.prompt_tokens_details);
  const inputDetails = asRecord(usage.input_tokens_details);

  const prompt = num(
    usage.prompt_tokens ??
      usage.input_tokens ??
      usage.inputTokens ??
      usage.promptTokenCount ??
      usage.prompt_token_count ??
      0,
  );
  const output = num(
    usage.completion_tokens ??
      usage.output_tokens ??
      usage.outputTokens ??
      usage.candidatesTokenCount ??
      usage.candidates_token_count ??
      0,
  );

  const detailReads = [nestedCached(promptDetails), nestedCached(inputDetails)];
  let readPresent = false;
  let readValue = 0;
  for (const r of detailReads) {
    if (!r.present) continue;
    readPresent = true;
    readValue = Math.max(readValue, r.value);
  }
  const topRead = maxPick(usage, READ_KEYS);
  if (topRead.present) {
    readPresent = true;
    readValue = Math.max(readValue, topRead.value);
  }

  const detailWrites = [nestedWrite(promptDetails), nestedWrite(inputDetails)];
  let writePresent = false;
  let writeValue = 0;
  for (const w of detailWrites) {
    if (!w.present) continue;
    writePresent = true;
    writeValue = Math.max(writeValue, w.value);
  }
  const topWrite = maxPick(usage, WRITE_KEYS);
  if (topWrite.present) {
    writePresent = true;
    writeValue = Math.max(writeValue, topWrite.value);
  }
  const objWrite = cacheCreationObjectWrite(usage);
  if (objWrite.present) {
    writePresent = true;
    writeValue = Math.max(writeValue, objWrite.value);
  }

  const separate =
    isAnthropicAdditive(usage) ||
    (!isInclusiveOfficial(usage) && readValue + writeValue > prompt);
  const promptTotal = separate ? prompt + readValue + writeValue : prompt;

  const cacheRead = Math.min(readValue, promptTotal);
  const cacheWrite = Math.min(writeValue, Math.max(0, promptTotal - cacheRead));

  return {
    promptTotal,
    cacheRead,
    cacheWrite,
    uncached: Math.max(0, promptTotal - cacheRead - cacheWrite),
    output,
    reported: readPresent || writePresent,
  };
}

/**
 * 命中率百分比（0–100 整数）。分母为 0 时返回 null（无数据，显示 `c—`）。
 */
export function cacheHitPct(
  cacheRead: number,
  promptTotal: number,
): number | null {
  if (!(promptTotal > 0)) return null;
  const pct = (cacheRead / promptTotal) * 100;
  return Math.round(Math.min(100, Math.max(0, pct)));
}
