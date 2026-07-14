/**
 * PromptCacheLedger —— 主模型 prompt-cache 命中率分桶账本（Agent 层权威）。
 *
 * 分层：
 *   LLM     只解析 usage 字段（无分桶）
 *   Context 管 session 消息（无缓存率）
 *   Agent   本模块：按 (agentName, sessionId, mainModel) 分桶，可切换恢复
 *   CLI     只读 snapshot 渲染，不自建长期 history
 *
 * 规则：
 *   - 只记 role=main 且 agent 为主 agent 的调用
 *   - helper / supervisor / 子 agent 不入桶
 *   - 不支持 cache 上报的模型（xopqwen 等）reportsCache=false → 显示 c—，不写假 0%
 *   - 换模 = 新桶；旧桶保留，切回同 agent+session+model 可恢复
 */

// ─── 模型是否上报 cache ────────────────────────────────────────────────────

const NO_CACHE_MODEL_RE =
  /xopqwen|xop[_-]?qwen|sparkdesk|讯飞|xfyun.*qwen|qwen36v35/i;

const KNOWN_CACHE_MODEL_RE =
  /^(gpt-|o[1-9]|o3|o4|claude|deepseek|gemini)/i;

/** 模型是否应计算/展示 prompt-cache 命中率 */
export function modelReportsPromptCache(
  model: string | undefined | null,
  provider?: string | null,
): boolean {
  const m = (model ?? "").trim();
  const p = (provider ?? "").trim();
  if (!m && !p) return false;
  if (m && NO_CACHE_MODEL_RE.test(m)) return false;
  if (p && /xfyun|xop|讯飞|spark/i.test(p) && m && /qwen|xop/i.test(m)) return false;
  if (m && KNOWN_CACHE_MODEL_RE.test(m)) return true;
  return true;
}

export function normalizeModelId(model: string | undefined | null): string {
  return (model ?? "").trim().toLowerCase().replace(/\s+/g, "");
}

/** usage 是否归属主 agent 主模型（过滤 helper/supervisor/子 agent） */
export function isMainAgentMainModelUsage(opts: {
  role?: string | null;
  usageModel?: string | null;
  mainModel?: string | null;
  agentName?: string | null;
  mainAgentName?: string | null;
}): boolean {
  const role = (opts.role ?? "main").toLowerCase();
  if (role && role !== "main") return false;

  const um = normalizeModelId(opts.usageModel);
  const mm = normalizeModelId(opts.mainModel);
  if (um && mm && um !== mm) {
    if (!um.includes(mm) && !mm.includes(um)) return false;
  }

  const ua = (opts.agentName ?? "").trim().toLowerCase();
  const ma = (opts.mainAgentName ?? "").trim().toLowerCase();
  if (ua === "supervisor" || ua.startsWith("helper") || ua.startsWith("sub:")) {
    return false;
  }
  if (ua && ma && ua !== ma) return false;

  return true;
}

// ─── 桶类型 ────────────────────────────────────────────────────────────────

export interface CacheSample {
  cacheRead: number;
  input: number;
  model: string;
  ts: number;
}

export interface CacheRoundAccum {
  input: number;
  output: number;
  cacheRead: number;
}

export interface CacheBucket {
  agentName: string;
  sessionId: string;
  model: string;
  provider?: string;
  reportsCache: boolean;
  samples: CacheSample[];
  current: CacheRoundAccum;
}

export interface CacheSnapshot {
  agentName: string;
  sessionId: string;
  model: string;
  reportsCache: boolean;
  samples: CacheSample[];
  current: CacheRoundAccum;
  /** 近 lastN 轮合并命中率；不支持或无样本 → null */
  avgHitPct: number | null;
  /** UI 标签：` c—` | ` c42%` */
  label: string;
}

const HISTORY = 20;
const DISPLAY_N = 10;

function emptyRound(): CacheRoundAccum {
  return { input: 0, output: 0, cacheRead: 0 };
}

function parseUsage(u: Record<string, unknown> | null | undefined): CacheRoundAccum {
  if (!u) return emptyRound();
  const input = Number(u.prompt_tokens ?? u.input_tokens ?? u.inputTokens ?? 0) || 0;
  const output = Number(u.completion_tokens ?? u.output_tokens ?? u.outputTokens ?? 0) || 0;
  const details = u.prompt_tokens_details as { cached_tokens?: number } | undefined;
  const cacheRead =
    Number(u.cached_tokens ?? u.cache_read_input_tokens ?? u.cache_hit_tokens ?? details?.cached_tokens ?? 0) || 0;
  return { input, output, cacheRead };
}

export function avgCacheHitPct(
  samples: Array<{ cacheRead: number; input: number }>,
  lastN = DISPLAY_N,
): number | null {
  if (!samples.length) return null;
  const slice = samples.slice(-lastN);
  const sumCache = slice.reduce((a, c) => a + (c.cacheRead ?? 0), 0);
  const sumInput = slice.reduce((a, c) => a + (c.input ?? 0), 0);
  if (sumInput <= 0) return null;
  return Math.round((sumCache / sumInput) * 100);
}

export function formatCacheLabelFromSnapshot(snap: CacheSnapshot): string {
  return snap.label;
}

function buildLabel(reportsCache: boolean, samples: CacheSample[]): {
  avgHitPct: number | null;
  label: string;
} {
  if (!reportsCache) return { avgHitPct: null, label: " c—" };
  const avgHitPct = avgCacheHitPct(samples, DISPLAY_N);
  if (avgHitPct === null) return { avgHitPct: null, label: " c—" };
  return { avgHitPct, label: ` c${avgHitPct}%` };
}

// ─── Ledger ────────────────────────────────────────────────────────────────

export class PromptCacheLedger {
  private static _global: PromptCacheLedger | null = null;

  /** 进程内单例（CLI / harness / coding 共用） */
  static global(): PromptCacheLedger {
    if (!this._global) this._global = new PromptCacheLedger();
    return this._global;
  }

  /** 测试用：重置单例 */
  static resetGlobal(): void {
    this._global = new PromptCacheLedger();
  }

  private buckets = new Map<string, CacheBucket>();

  static bucketKey(agentName: string, sessionId: string, model: string): string {
    const a = (agentName || "main").trim() || "main";
    const s = (sessionId || "").trim() || "_none";
    const m = normalizeModelId(model) || "_unknown";
    return `${a}::${s}::${m}`;
  }

  private ensure(
    agentName: string,
    sessionId: string,
    model: string,
    provider?: string,
  ): CacheBucket {
    const key = PromptCacheLedger.bucketKey(agentName, sessionId, model);
    let b = this.buckets.get(key);
    if (!b) {
      b = {
        agentName: agentName || "main",
        sessionId: sessionId || "",
        model: model || "",
        provider,
        reportsCache: modelReportsPromptCache(model, provider),
        samples: [],
        current: emptyRound(),
      };
      this.buckets.set(key, b);
    } else if (provider && !b.provider) {
      b.provider = provider;
      b.reportsCache = modelReportsPromptCache(model, provider);
    }
    return b;
  }

  /**
   * 记录一次主模型 LLM usage（应在 runtime 主循环内调用）。
   * 非主路径返回 null。
   */
  recordUsage(opts: {
    agentName: string;
    sessionId: string;
    model: string;
    provider?: string;
    role?: string;
    /** 与 agentName 比对的「当前前台主 agent」；省略则仅用 agentName 自身规则 */
    mainAgentName?: string;
    usage: Record<string, unknown> | null | undefined;
  }): CacheSnapshot | null {
    if (
      !isMainAgentMainModelUsage({
        role: opts.role ?? "main",
        usageModel: opts.model,
        mainModel: opts.model,
        agentName: opts.agentName,
        mainAgentName: opts.mainAgentName ?? opts.agentName,
      })
    ) {
      return null;
    }
    if (!opts.sessionId || !opts.model) {
      // 仍允许无 session 时用 _none，便于测试；model 空则无法分桶
      if (!opts.model) return null;
    }

    const b = this.ensure(opts.agentName, opts.sessionId, opts.model, opts.provider);
    const u = parseUsage(opts.usage);
    b.current.input += u.input;
    b.current.output += u.output;
    if (b.reportsCache) {
      b.current.cacheRead += u.cacheRead;
    }
    return this.snapshot(opts.agentName, opts.sessionId, opts.model);
  }

  /**
   * 封印当前轮到 samples（agent_round 切换 / done 时调用）。
   * 无累计则 no-op。
   */
  sealRound(agentName: string, sessionId: string, model: string): CacheSnapshot {
    const key = PromptCacheLedger.bucketKey(agentName, sessionId, model);
    const b = this.buckets.get(key);
    if (!b) {
      return this.snapshot(agentName, sessionId, model);
    }
    if (b.reportsCache && (b.current.input > 0 || b.current.cacheRead > 0)) {
      b.samples = [
        ...b.samples,
        {
          cacheRead: b.current.cacheRead,
          input: b.current.input,
          model: b.model,
          ts: Date.now(),
        },
      ].slice(-HISTORY);
    }
    // 不支持 cache 的模型：只重置 current，不写假 0% 样本
    b.current = emptyRound();
    return this.toSnapshot(b);
  }

  /** 读取桶快照（不存在则空桶） */
  snapshot(agentName: string, sessionId: string, model: string): CacheSnapshot {
    const key = PromptCacheLedger.bucketKey(agentName, sessionId, model);
    const b = this.buckets.get(key);
    if (!b) {
      const reportsCache = modelReportsPromptCache(model);
      const { avgHitPct, label } = buildLabel(reportsCache, []);
      return {
        agentName: agentName || "main",
        sessionId: sessionId || "",
        model: model || "",
        reportsCache,
        samples: [],
        current: emptyRound(),
        avgHitPct,
        label,
      };
    }
    return this.toSnapshot(b);
  }

  private toSnapshot(b: CacheBucket): CacheSnapshot {
    const { avgHitPct, label } = buildLabel(b.reportsCache, b.samples);
    return {
      agentName: b.agentName,
      sessionId: b.sessionId,
      model: b.model,
      reportsCache: b.reportsCache,
      samples: b.samples.map((s) => ({ ...s })),
      current: { ...b.current },
      avgHitPct,
      label,
    };
  }

  /** 清空某会话下该 agent 的所有模型桶 */
  clearSession(agentName: string, sessionId: string): void {
    const prefix = `${(agentName || "main").trim()}::${(sessionId || "").trim()}::`;
    for (const k of [...this.buckets.keys()]) {
      if (k.startsWith(prefix) || k.startsWith(`${(agentName || "main").trim()}::${sessionId}::`)) {
        this.buckets.delete(k);
      }
    }
  }

  /** 清空某 agent 全部会话桶 */
  clearAgent(agentName: string): void {
    const prefix = `${(agentName || "main").trim()}::`;
    for (const k of [...this.buckets.keys()]) {
      if (k.startsWith(prefix)) this.buckets.delete(k);
    }
  }

  /** 调试 / 测试 */
  bucketCount(): number {
    return this.buckets.size;
  }
}

/** 便捷：进程全局 ledger */
export function promptCacheLedger(): PromptCacheLedger {
  return PromptCacheLedger.global();
}
