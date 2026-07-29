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
 *
 * 命中率口径统一由 LLM 层 `normalizeCacheUsage` 提供（Anthropic 的 input_tokens
 * 不含命中，OpenAI 的 prompt_tokens 含命中——直接相除会得到 9000%）。
 */

import { normalizeCacheUsage, cacheHitPct } from "@little-house-studio/llm";

// ─── 模型是否上报 cache ────────────────────────────────────────────────────

/**
 * 仅保留「确认从不带 cache 字段」的窄黑名单。
 *
 * 历史坑：曾把 `xfyun + /xop/` 整段拉黑，误伤 **xopglm51**——
 * 讯飞 MaaS 实际会回 `cached_tokens` / `prompt_tokens_details.cached_tokens`
 *（本地 ops session 可见 99% 命中）。被黑名单挡住后 ledger 永不 sawCacheField → CLI 永远 `c—`。
 *
 * 默认 true；「有字段但命中 0」→ c0%；「字段都没有」→ sawCacheField=false → c—。
 */
const NO_CACHE_MODEL_RE = /sparkdesk/i;

/**
 * 模型是否**可能**上报 prompt-cache。
 *
 * 只做极窄黑名单。自建/中转端点模型名千奇百怪，宽黑名单会把真实命中率误伤成 `c—`。
 * 「上报了但没命中(c0%)」和「根本不上报(c—)」靠 usage 是否出现 cache 字段
 * （`recordUsage` → `sawCacheField`），不靠模型名瞎猜。
 */
export function modelReportsPromptCache(
  model: string | undefined | null,
  provider?: string | null,
): boolean {
  const m = (model ?? "").trim();
  const p = (provider ?? "").trim();
  if (!m && !p) return false;
  if (m && NO_CACHE_MODEL_RE.test(m)) return false;
  // provider 单独不再拉黑讯飞/xop——实测 xopglm / 部分 qwen 均带 cached_tokens
  void p;
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
  /** 归一后的 **prompt 总量**（含命中与写入）= 命中率分母，不是裸 input_tokens */
  input: number;
  /** 缓存写入（建缓存）：计入 input，但不算命中 */
  cacheWrite?: number;
  model: string;
  ts: number;
}

export interface CacheRoundAccum {
  /** 归一后的 prompt 总量（命中率分母） */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite?: number;
}

export interface CacheBucket {
  agentName: string;
  sessionId: string;
  model: string;
  provider?: string;
  reportsCache: boolean;
  /** 本桶 usage 里是否真的出现过 cache 字段（决定 c0% vs c—） */
  sawCacheField: boolean;
  samples: CacheSample[];
  current: CacheRoundAccum;
}

export interface CacheSnapshot {
  agentName: string;
  sessionId: string;
  model: string;
  reportsCache: boolean;
  /** usage 里是否真的出现过 cache 字段（false 时不写样本 → 显示 c—，不写假 0%） */
  sawCacheField: boolean;
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
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

/**
 * 近 lastN 轮的**合并**命中率（sum(命中)/sum(prompt 总量)），而非各轮命中率的均值——
 * 大 prompt 轮次应当占更大权重。结果 clamp 在 0–100。
 */
export function avgCacheHitPct(
  samples: Array<{ cacheRead: number; input: number }>,
  lastN = DISPLAY_N,
): number | null {
  if (!samples.length) return null;
  const slice = samples.slice(-lastN);
  const sumCache = slice.reduce((a, c) => a + (c.cacheRead ?? 0), 0);
  const sumInput = slice.reduce((a, c) => a + (c.input ?? 0), 0);
  return cacheHitPct(sumCache, sumInput);
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
        sawCacheField: false,
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
    // 归一后再累加：input 是 prompt 总量（Anthropic 需补回命中/写入），否则分母偏小
    const u = normalizeCacheUsage(opts.usage as Record<string, unknown> | null | undefined);
    b.current.input += u.promptTotal;
    b.current.output += u.output;
    if (b.reportsCache) {
      b.current.cacheRead += u.cacheRead;
      b.current.cacheWrite = (b.current.cacheWrite ?? 0) + u.cacheWrite;
      if (u.reported) b.sawCacheField = true;
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
    // 只有「模型可能上报」且「本桶真见过 cache 字段」才写样本。
    // 二者缺一即只重置 current —— 不写假 0%，UI 显示 c—。
    if (
      b.reportsCache &&
      b.sawCacheField &&
      (b.current.input > 0 || b.current.cacheRead > 0)
    ) {
      b.samples = [
        ...b.samples,
        {
          cacheRead: b.current.cacheRead,
          input: b.current.input,
          cacheWrite: b.current.cacheWrite ?? 0,
          model: b.model,
          ts: Date.now(),
        },
      ].slice(-HISTORY);
    }
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
        sawCacheField: false,
        samples: [],
        current: emptyRound(),
        avgHitPct,
        label,
      };
    }
    return this.toSnapshot(b);
  }

  private toSnapshot(b: CacheBucket): CacheSnapshot {
    // 含未 seal 的 current：流式过程中也能看到本轮命中率，避免一直 c—
    const samplesForAvg = [...b.samples];
    if (
      b.reportsCache &&
      b.sawCacheField &&
      (b.current.input > 0 || b.current.cacheRead > 0)
    ) {
      samplesForAvg.push({
        cacheRead: b.current.cacheRead,
        input: b.current.input,
        cacheWrite: b.current.cacheWrite ?? 0,
        model: b.model,
        ts: Date.now(),
      });
    }
    const { avgHitPct, label } = buildLabel(b.reportsCache, samplesForAvg);
    return {
      agentName: b.agentName,
      sessionId: b.sessionId,
      model: b.model,
      reportsCache: b.reportsCache,
      sawCacheField: b.sawCacheField,
      samples: b.samples.map((s) => ({ ...s })),
      current: { ...b.current },
      avgHitPct,
      label,
    };
  }

  /**
   * 清空某会话下该 agent 的所有模型桶。
   * 前缀必须与 `bucketKey` 同规则（空 sessionId → `_none`），否则 /new 后清不掉旧桶，
   * 新会话会继续显示上一个会话的命中率。
   */
  clearSession(agentName: string, sessionId: string): void {
    const a = (agentName || "main").trim() || "main";
    const s = (sessionId || "").trim() || "_none";
    const prefix = `${a}::${s}::`;
    for (const k of [...this.buckets.keys()]) {
      if (k.startsWith(prefix)) this.buckets.delete(k);
    }
  }

  /** 清空某 agent 全部会话桶 */
  clearAgent(agentName: string): void {
    const prefix = `${(agentName || "main").trim() || "main"}::`;
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
