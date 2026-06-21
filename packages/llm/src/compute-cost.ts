/**
 * 成本计算工具
 *
 * 根据 token 用量 + preset 的 pricing 配置，计算本次 LLM 调用的成本。
 *
 * pricing 字段（来自 preset）：
 * - inputPrice：每百万输入 token 的价格（美元）
 * - outputPrice：每百万输出 token 的价格（美元）
 * - cacheHitPrice：每百万缓存命中 token 的价格（美元，通常为 inputPrice 的 10%~50%）
 * - currency：货币单位（默认 "USD"）
 *
 * token 用量字段（来自 usage）：
 * - prompt_tokens / input_tokens：输入 token 数
 * - completion_tokens / output_tokens：输出 token 数
 * - cache_read_input_tokens / cache_hit_tokens：缓存命中 token 数
 */

import type { LLMUsage } from "./adapters/types.js";

/** preset 的定价配置 */
export interface Pricing {
  /** 每百万输入 token 价格 */
  inputPrice: number;
  /** 每百万输出 token 价格 */
  outputPrice: number;
  /** 每百万缓存命中 token 价格 */
  cacheHitPrice?: number;
  /** 货币单位，默认 "USD" */
  currency?: string;
}

/** 成本计算结果 */
export interface CostBreakdown {
  /** 输入 token 成本 */
  inputCost: number;
  /** 输出 token 成本 */
  outputCost: number;
  /** 缓存命中节省的成本（负数表示节省） */
  cacheSavings: number;
  /** 总成本 */
  totalCost: number;
  /** 货币单位 */
  currency: string;
}

/**
 * 根据 usage + pricing 计算成本。
 * pricing 为 null/undefined 时返回 null（无法计算）。
 */
export function computeCost(usage: LLMUsage | null | undefined, pricing: Pricing | null | undefined): CostBreakdown | null {
  if (!usage || !pricing) return null;

  // 输入 token：优先 prompt_tokens，其次 input_tokens
  const inputTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
  // 输出 token：优先 completion_tokens，其次 output_tokens
  const outputTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
  // 缓存命中 token：尝试多个常见字段名
  const cacheHitTokens = Number(
    usage.cache_read_input_tokens
    ?? usage.cache_hit_tokens
    ?? usage.cached_tokens
    ?? 0
  );

  // 实际计费的输入 token = 总输入 - 缓存命中（缓存命中按更低价格计）
  const billableInputTokens = Math.max(0, inputTokens - cacheHitTokens);

  const inputCost = (billableInputTokens / 1_000_000) * (pricing.inputPrice ?? 0);
  const outputCost = (outputTokens / 1_000_000) * (pricing.outputPrice ?? 0);
  const cacheCost = (cacheHitTokens / 1_000_000) * (pricing.cacheHitPrice ?? 0);
  // 缓存节省 = 如果这些 token 按正常输入价格计费的成本 - 实际缓存成本
  const cacheSavings = cacheCost - (cacheHitTokens / 1_000_000) * (pricing.inputPrice ?? 0);

  return {
    inputCost,
    outputCost,
    cacheSavings,
    totalCost: inputCost + outputCost + cacheCost,
    currency: pricing.currency ?? "USD",
  };
}

/**
 * 格式化成本为可读字符串。
 * 例如："$0.0123" 或 "$0.0000 (<0.01¢)"
 */
export function formatCost(cost: CostBreakdown | null): string {
  if (!cost) return "N/A";
  const { totalCost, currency } = cost;
  const symbol = currency === "USD" ? "$" : "";
  if (totalCost < 0.01) {
    return `${symbol}${totalCost.toFixed(6)} (${(totalCost * 100).toFixed(4)}¢)`;
  }
  return `${symbol}${totalCost.toFixed(4)}`;
}
