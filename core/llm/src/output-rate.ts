/**
 * 输出吞吐：步开始 → 首个非空 delta 的 TTFT，再按提供方上报的 output tokens ÷ decode 墙钟。
 * stream() / ChatSession 收尾 settle；多步折叠走 addOutputRateSample。
 */

/** 单次模型调用的吞吐读数。缺采样的字段为 null。 */
export interface OutputRate {
  ttftMs: number | null;
  decodeMs: number | null;
  outputTokens: number | null;
  tokensPerSecond: number | null;
}

/** 多步累加：TTFT 求和后平均，decode 墙钟与 token 分别累加再除。 */
export interface OutputRateFold {
  ttftMs: number;
  ttftSteps: number;
  decodeMs: number;
  decodeTokens: number;
}

const OUTPUT_TOKEN_KEYS = [
  "outputTokens",
  "output_tokens",
  "completion_tokens",
  "candidatesTokenCount",
  "candidates_token_count",
  "output",
] as const;

/**
 * 提供方上报的输出 token。字段缺失或非法时返回 null，不当成 0。
 */
export function usageOutputTokens(usage: unknown): number | null {
  if (typeof usage !== "object" || usage === null) return null;
  const rec = usage as Record<string, unknown>;
  for (const key of OUTPUT_TOKEN_KEYS) {
    const value = rec[key];
    if (value === undefined || value === null) continue;
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

const EMPTY_RATE: OutputRate = {
  ttftMs: null,
  decodeMs: null,
  outputTokens: null,
  tokensPerSecond: null,
};

/** 由墙钟与 usage 合成读数。decodeMs 为 0 或 usage 缺失时不写 tokensPerSecond。 */
export function settleOutputRate(input: {
  ttftMs: number | null;
  decodeMs: number | null;
  usage: unknown;
}): OutputRate {
  const outputTokens = usageOutputTokens(input.usage);
  const decodeMs = input.decodeMs;
  const tokensPerSecond =
    decodeMs !== null && decodeMs > 0 && outputTokens !== null
      ? outputTokens / (decodeMs / 1000)
      : null;
  return {
    ttftMs: input.ttftMs,
    decodeMs,
    outputTokens,
    tokensPerSecond,
  };
}

/**
 * 单次调用的墙钟。start 记步开始；noteTokenDelta 只记第一次非空输出/思考/工具 delta；
 * complete 记组装完成；settle(usage) 产出读数。
 */
export class OutputRateClock {
  private startedAt: number | null = null;
  private firstTokenAt: number | null = null;
  private completedAt: number | null = null;

  constructor(private readonly now: () => number = Date.now) {}

  start(at = this.now()): void {
    this.startedAt = at;
    this.firstTokenAt = null;
    this.completedAt = null;
  }

  /** 首个非空文本 / 思考 / 工具增量记一次。 */
  noteTokenDelta(at = this.now()): void {
    if (this.firstTokenAt !== null) return;
    this.firstTokenAt = at;
  }

  complete(at = this.now()): void {
    this.completedAt = at;
  }

  settle(usage: unknown): OutputRate {
    if (this.startedAt === null) {
      return settleOutputRate({ ttftMs: null, decodeMs: null, usage });
    }
    const ttftMs =
      this.firstTokenAt !== null ? Math.max(0, this.firstTokenAt - this.startedAt) : null;
    const decodeMs =
      this.firstTokenAt !== null && this.completedAt !== null
        ? Math.max(0, this.completedAt - this.firstTokenAt)
        : null;
    return settleOutputRate({ ttftMs, decodeMs, usage });
  }
}

export function emptyOutputRateFold(): OutputRateFold {
  return { ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 };
}

export function addOutputRateSample(fold: OutputRateFold, rate: OutputRate): OutputRateFold {
  const next: OutputRateFold = { ...fold };
  if (rate.ttftMs !== null) {
    next.ttftMs += rate.ttftMs;
    next.ttftSteps += 1;
  }
  if (rate.decodeMs !== null && rate.outputTokens !== null) {
    next.decodeMs += rate.decodeMs;
    next.decodeTokens += rate.outputTokens;
  }
  return next;
}

export function foldTokensPerSecond(fold: OutputRateFold): number | null {
  if (!(fold.decodeMs > 0)) return null;
  return fold.decodeTokens / (fold.decodeMs / 1000);
}

export function foldTtftAverageMs(fold: OutputRateFold): number | null {
  if (!(fold.ttftSteps > 0)) return null;
  return fold.ttftMs / fold.ttftSteps;
}

/** ≥10 取整，<10 一位小数。 */
export function formatTokensPerSecond(tps: number): string {
  const clamped = Math.max(0, tps);
  return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10);
}

export function emptyOutputRate(): OutputRate {
  return { ...EMPTY_RATE };
}
