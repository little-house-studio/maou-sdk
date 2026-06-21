/**
 * Token 消耗追踪器 —— 分钟级精度记录 token 用量与费用。
 * 对应 Python: core/agent/token_tracker.py
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";

// ─── 类型 ──────────────────────────────────────────────────────────────────

export interface TokenUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  cache_hit_tokens?: number;
  cache_read_input_tokens?: number;
  [key: string]: unknown;
}

export interface PricingInfo {
  inputPrice: number;
  outputPrice: number;
  cacheHitPrice: number;
  currency: string;
}

export interface TokenRecord {
  minute: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_hit_tokens: number;
  effective_input_tokens: number;
  cost_input: number;
  cost_output: number;
  cost_cache: number;
  total_cost: number;
  currency: string;
}

export interface DailySummary {
  date: string;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_hit_tokens: number;
  cache_hit_rate: number;
  total_cost: number;
  record_count: number;
}

export interface DailyData {
  records: TokenRecord[];
  daily_summary: DailySummary;
}

// ─── 工具函数 ──────────────────────────────────────────────────────────────

function nowMinute(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function todayDate(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function loadFile(filePath: string): DailyData {
  if (!existsSync(filePath)) return { records: [], daily_summary: {} as DailySummary };
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return { records: [], daily_summary: {} as DailySummary };
  }
}

function saveFile(filePath: string, data: DailyData): void {
  mkdirSync(join(filePath, ".."), { recursive: true });
  const tmp = `${filePath}.tmp.${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tmp, filePath);
}

function computeCost(usage: TokenUsage, pricing: PricingInfo): {
  input_tokens: number;
  output_tokens: number;
  cache_hit_tokens: number;
  effective_input_tokens: number;
  cost_input: number;
  cost_output: number;
  cost_cache: number;
  total_cost: number;
} {
  const inputTokens = Math.trunc(usage.input_tokens ?? usage.prompt_tokens ?? 0);
  const outputTokens = Math.trunc(usage.output_tokens ?? usage.completion_tokens ?? 0);
  const cacheHitTokens = Math.trunc(
    usage.cache_hit_tokens ?? usage.cache_read_input_tokens ?? 0,
  );
  const effectiveInput = Math.max(0, inputTokens - cacheHitTokens);

  const costInput = (effectiveInput / 1_000_000) * pricing.inputPrice;
  const costOutput = (outputTokens / 1_000_000) * pricing.outputPrice;
  const costCache = (cacheHitTokens / 1_000_000) * pricing.cacheHitPrice;
  const totalCost = parseFloat((costInput + costOutput + costCache).toFixed(12));

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_hit_tokens: cacheHitTokens,
    effective_input_tokens: effectiveInput,
    cost_input: parseFloat(costInput.toFixed(8)),
    cost_output: parseFloat(costOutput.toFixed(8)),
    cost_cache: parseFloat(costCache.toFixed(8)),
    total_cost: totalCost,
  };
}

function getDefaultPricing(preset?: Record<string, unknown> | null): PricingInfo {
  if (preset) {
    const p = preset.pricing as Record<string, unknown> | undefined;
    if (p && typeof p === "object") {
      let ip = Number(p.input_price ?? 0);
      let op = Number(p.output_price ?? 0);
      let cp = Number(p.cache_hit_price ?? 0);
      // 如果全部为 0，视为免费（极小值）
      if (ip === 0 && op === 0 && cp === 0) {
        ip = op = cp = 0.0000001;
      }
      return {
        inputPrice: ip,
        outputPrice: op,
        cacheHitPrice: cp,
        currency: String(p.currency ?? "CNY").toUpperCase(),
      };
    }
  }
  return {
    inputPrice: 0.0000001,
    outputPrice: 0.0000001,
    cacheHitPrice: 0.0000001,
    currency: "CNY",
  };
}

// ─── TokenTracker ──────────────────────────────────────────────────────────

export class TokenTracker {
  private agentDir: string;
  private agentName: string;
  private pricing: PricingInfo;

  constructor(maouRoot: string, agentName: string, preset?: Record<string, unknown> | null) {
    this.agentDir = join(maouRoot, "agents", agentName, "tokens");
    this.agentName = agentName;
    this.pricing = getDefaultPricing(preset);
  }

  private dailyPath(date?: string | null): string {
    return join(this.agentDir, `${date ?? todayDate()}.json`);
  }

  /**
   * 记录一次 token 消耗
   */
  record(usage: TokenUsage, model = ""): TokenRecord {
    const minute = nowMinute();
    const today = todayDate();
    const filePath = this.dailyPath(today);
    const data = loadFile(filePath);
    const costDetail = computeCost(usage, this.pricing);

    const entry: TokenRecord = {
      minute,
      model,
      ...costDetail,
      currency: this.pricing.currency,
    };

    const { records } = data;
    if (records.length > 0 && records[records.length - 1].minute === minute) {
      // 同一分钟内的合并累加
      const existing = records[records.length - 1];
      for (const k of [
        "input_tokens",
        "output_tokens",
        "cache_hit_tokens",
        "effective_input_tokens",
        "cost_input",
        "cost_output",
        "cost_cache",
        "total_cost",
      ] as const) {
        const existingRec = existing as unknown as Record<string, number>;
        const entryRec = entry as unknown as Record<string, number>;
        existingRec[k] = (existingRec[k] ?? 0) + (entryRec[k] ?? 0);
      }
    } else {
      records.push(entry);
    }

    data.daily_summary = TokenTracker.computeDailySummary(records);
    saveFile(filePath, data);
    return entry;
  }

  /**
   * 获取当日汇总
   */
  getDailySummary(date?: string | null): DailySummary {
    const data = loadFile(this.dailyPath(date));
    return data.daily_summary;
  }

  /**
   * 获取当日记录列表
   */
  getRecords(date?: string | null): TokenRecord[] {
    return loadFile(this.dailyPath(date)).records;
  }

  /**
   * 获取缓存命中率
   */
  getCacheHitRate(date?: string | null): number {
    const records = this.getRecords(date);
    const totalInput = records.reduce((s, r) => s + r.input_tokens, 0);
    const totalCache = records.reduce((s, r) => s + r.cache_hit_tokens, 0);
    if (totalInput === 0) return 0;
    return parseFloat((totalCache / totalInput).toFixed(4));
  }

  /**
   * 获取当日总费用
   */
  getTotalCost(date?: string | null): number {
    const summary = this.getDailySummary(date);
    return Number(summary.total_cost ?? 0);
  }

  /**
   * 计算日汇总
   */
  static computeDailySummary(records: TokenRecord[]): DailySummary {
    const totalInput = records.reduce((s, r) => s + r.input_tokens, 0);
    const totalOutput = records.reduce((s, r) => s + r.output_tokens, 0);
    const totalCache = records.reduce((s, r) => s + r.cache_hit_tokens, 0);
    const totalCost = records.reduce((s, r) => s + r.total_cost, 0);
    const cacheRate = parseFloat((totalCache / Math.max(1, totalInput)).toFixed(4));

    return {
      date: todayDate(),
      total_input_tokens: totalInput,
      total_output_tokens: totalOutput,
      total_cache_hit_tokens: totalCache,
      cache_hit_rate: cacheRate,
      total_cost: parseFloat(totalCost.toFixed(8)),
      record_count: records.length,
    };
  }

  /**
   * 格式化 token 用量显示字符串
   */
  static formatUsage(usage: TokenUsage): string {
    const prompt = usage.prompt_tokens ?? usage.input_tokens ?? 0;
    const completion = usage.completion_tokens ?? usage.output_tokens ?? 0;
    const cache = usage.cache_hit_tokens ?? usage.cache_read_input_tokens ?? 0;
    const total = prompt + completion;
    const parts = [`tokens: ${total.toLocaleString()}`];
    if (prompt) parts.push(`prompt=${prompt.toLocaleString()}`);
    if (completion) parts.push(`completion=${completion.toLocaleString()}`);
    if (cache) parts.push(`cache=${cache.toLocaleString()}`);
    return parts.join(" | ");
  }

  /**
   * 计算使用百分比
   */
  static usagePercent(used: number, limit: number): number {
    if (limit <= 0) return 0;
    return Math.min(100, Math.round((used / limit) * 100));
  }
}
