/**
 * Profiler —— 轻量级耗时埋点工具（跨层共享）。
 *
 * 目标：给 agent loop / LLM / context / 网络服务各阶段加可观测的耗时统计，
 * 定位"哪个环节慢、哪个异常"，改善体感。
 *
 * 设计：
 * - 极低开销：一次 span 仅两次 performance.now() + 一次数组 push。常驻开启，无需 env 开关。
 * - span 不嵌套强约束：用 start()/end 配对或 sync()/async() 包裹；record() 直接登记已知耗时（桥接 LLM timing）。
 * - report()/renderText() 按 span 名聚合汇总（总耗时、占比、次数、均值），并保留时间线明细。
 *
 * 用法：
 *   const prof = new Profiler("run:abc");
 *   const end = prof.start("compile_prompt"); ...; end();
 *   await prof.async("llm_call", () => callModel(...), { round: 2 });
 *   prof.record("llm_firstByte", result.timing.firstByteMs, { round: 2 });
 *   console.log(prof.renderText());
 */

function now(): number {
  return performance.now();
}

const NOOP = (): void => {};

export interface SpanRecord {
  name: string;
  /** 相对 profiler 起点的开始时刻（ms） */
  startMs: number;
  /** 持续时长（ms） */
  durationMs: number;
  meta?: Record<string, unknown>;
}

export interface SpanSummary {
  name: string;
  totalMs: number;
  count: number;
  avgMs: number;
  maxMs: number;
  /** 占总耗时百分比（基于 wall-clock total） */
  pct: number;
}

export interface ProfileReport {
  label: string;
  totalMs: number;
  spans: SpanSummary[];
  records: SpanRecord[];
}

export class Profiler {
  readonly label: string;
  enabled: boolean;
  private t0: number;
  private records: SpanRecord[] = [];

  constructor(label = "run", enabled = true) {
    this.label = label;
    this.enabled = enabled;
    this.t0 = now();
  }

  /** 开一个 span，返回结束函数。disabled 时为零开销 no-op。 */
  start(name: string, meta?: Record<string, unknown>): () => void {
    if (!this.enabled) return NOOP;
    const startMs = now() - this.t0;
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      this.records.push({ name, startMs, durationMs: now() - this.t0 - startMs, meta });
    };
  }

  /** 包裹同步函数计时。 */
  sync<T>(name: string, fn: () => T, meta?: Record<string, unknown>): T {
    const end = this.start(name, meta);
    try {
      return fn();
    } finally {
      end();
    }
  }

  /** 包裹异步函数计时。 */
  async async<T>(name: string, fn: () => Promise<T>, meta?: Record<string, unknown>): Promise<T> {
    const end = this.start(name, meta);
    try {
      return await fn();
    } finally {
      end();
    }
  }

  /**
   * 直接登记一段已知耗时（用于桥接外层已测得的 timing，如 LLM result.timing）。
   *
   * 该 span 起点按「现在往前推 durationMs」还原；若比 profiler 起点还早（外层计时
   * 早于本 profiler 创建），钳到 0，避免时间线出现负的 startMs。
   */
  record(name: string, durationMs: number, meta?: Record<string, unknown>): void {
    if (!this.enabled || !Number.isFinite(durationMs) || durationMs < 0) return;
    const startMs = Math.max(0, now() - this.t0 - durationMs);
    this.records.push({ name, startMs, durationMs, meta });
  }

  /** 自起点至今的墙钟总耗时（ms）。 */
  get totalMs(): number {
    return now() - this.t0;
  }

  getRecords(): SpanRecord[] {
    return this.records.slice();
  }

  /** 按 span 名聚合汇总。 */
  report(): ProfileReport {
    const total = this.totalMs;
    const byName = new Map<string, { totalMs: number; count: number; maxMs: number }>();
    for (const r of this.records) {
      const cur = byName.get(r.name) ?? { totalMs: 0, count: 0, maxMs: 0 };
      cur.totalMs += r.durationMs;
      cur.count += 1;
      cur.maxMs = Math.max(cur.maxMs, r.durationMs);
      byName.set(r.name, cur);
    }
    const spans: SpanSummary[] = [...byName.entries()]
      .map(([name, v]) => ({
        name,
        totalMs: Math.round(v.totalMs),
        count: v.count,
        avgMs: Math.round(v.totalMs / v.count),
        maxMs: Math.round(v.maxMs),
        pct: total > 0 ? Math.round((v.totalMs / total) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.totalMs - a.totalMs);
    return { label: this.label, totalMs: Math.round(total), spans, records: this.getRecords() };
  }

  /** 渲染为可读文本表（按总耗时降序）。 */
  renderText(): string {
    const rep = this.report();
    const lines: string[] = [`⏱ Profile [${rep.label}] total=${rep.totalMs}ms, spans=${rep.records.length}`];
    const nameW = Math.min(28, Math.max(12, ...rep.spans.map((s) => s.name.length)));
    for (const s of rep.spans) {
      // pct 可以 >100%（span 嵌套：llm_call ⊃ llm_first_byte；并行工具耗时累加），
      // 直接 repeat(pct/5) 会拉出上百格把表撑烂 → bar 封顶 20 格，超出用 » 标记
      const filled = Math.min(20, Math.round(s.pct / 5));
      const bar = "█".repeat(filled) + (s.pct > 100 ? "»" : "");
      lines.push(
        `  ${s.name.padEnd(nameW)} ${String(s.totalMs).padStart(7)}ms ${String(s.pct).padStart(5)}% ×${String(s.count).padStart(2)} avg=${s.avgMs}ms ${bar}`,
      );
    }
    return lines.join("\n");
  }
}
