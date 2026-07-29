/**
 * prompt-cache usage 语义归一 —— 命中率/计费的唯一口径来源。
 *
 * 各家 usage 对 "input" 的定义并不一致，这是缓存命中率算错的根因：
 *
 *   OpenAI / DeepSeek / Gemini：`prompt_tokens` **已包含** 命中部分
 *       { prompt_tokens: 6135, prompt_tokens_details: { cached_tokens: 5504 } }
 *       → 总 prompt = 6135，命中 5504
 *
 *   Anthropic：`input_tokens` **不包含** 命中与写入
 *       { input_tokens: 100, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0 }
 *       → 总 prompt = 9100，命中 9000
 *
 * 直接用 `cacheRead / input` 在 Anthropic 上会得到 9000%。
 *
 * 判据用**一致性**而非字段名：`cacheRead + cacheWrite > prompt` 只可能出现在
 * "不含" 语义里，此时补齐分母。字段名不可靠 —— 中间层常把命中数搬到
 * `cache_read_input_tokens` 上再透传，光看名字会把 OpenAI 误判成 Anthropic。
 * 误判只可能发生在 cacheRead 相对 prompt 很小时，而那时两种口径差异同样很小，
 * 所以这个判据既稳又不会产出 >100% 的命中率。
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

/** 命中读取字段（各家别名） */
const READ_KEYS = [
  "cache_read_input_tokens",
  "cache_hit_tokens",
  "cached_tokens",
  "prompt_cache_hit_tokens",
  "cache_tokens",
  "prompt_cache_tokens",
  "cached",
] as const;

/** 缓存写入字段 */
const WRITE_KEYS = ["cache_creation_input_tokens", "cache_write_tokens"] as const;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

/** 取第一个存在（非 null/undefined）的键值；同时报告该键是否出现过 */
function pick(
  u: Record<string, unknown>,
  keys: readonly string[],
): { value: number; present: boolean } {
  for (const k of keys) {
    const v = u[k];
    if (v !== undefined && v !== null) return { value: num(v), present: true };
  }
  return { value: 0, present: false };
}

/**
 * 把任意家的 usage 归一成统一口径。
 * 无 usage / 无法识别时返回全 0（`reported: false`）。
 */
export function normalizeCacheUsage(
  usage: Record<string, unknown> | null | undefined,
): NormalizedCacheUsage {
  if (!usage || typeof usage !== "object") return { ...EMPTY };

  const prompt = num(
    usage.prompt_tokens ?? usage.input_tokens ?? usage.inputTokens ?? 0,
  );
  const output = num(
    usage.completion_tokens ?? usage.output_tokens ?? usage.outputTokens ?? 0,
  );

  // OpenAI 把命中数藏在 prompt_tokens_details.cached_tokens
  const details = usage.prompt_tokens_details as
    | Record<string, unknown>
    | undefined;
  const detailCached =
    details && typeof details === "object" ? details.cached_tokens : undefined;

  let read = pick(usage, READ_KEYS);
  if (!read.present && detailCached !== undefined && detailCached !== null) {
    read = { value: num(detailCached), present: true };
  }
  const write = pick(usage, WRITE_KEYS);

  // 「不含」语义（Anthropic）：命中+写入已超过 prompt，说明 prompt 只算新增部分
  const separate = read.value + write.value > prompt;
  const promptTotal = separate ? prompt + read.value + write.value : prompt;

  // clamp：命中/写入不得超过总量，否则下游算出 >100%
  const cacheRead = Math.min(read.value, promptTotal);
  const cacheWrite = Math.min(write.value, Math.max(0, promptTotal - cacheRead));

  return {
    promptTotal,
    cacheRead,
    cacheWrite,
    uncached: Math.max(0, promptTotal - cacheRead - cacheWrite),
    output,
    reported: read.present || write.present,
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
