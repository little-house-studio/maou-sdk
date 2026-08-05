/**
 * APIPreset 规范化 —— 委托 types.normalizeRuntimePreset（全产品唯一实现）。
 *
 * 本文件额外提供：
 * - resolvePricingFromPreset → computeCost 用的 Pricing 类型
 * - getPresetMaxConcurrent
 * - normalizeApiPreset 的 APIPreset 类型包装
 */

import { normalizeRuntimePreset } from "@little-house-studio/types";
import type { APIPreset } from "./adapters/types.js";
import type { Pricing } from "./compute-cost.js";

function asNum(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : undefined;
}

/**
 * 从 preset 任意形状解析 Pricing（供 computeCost / stream / chat-session）。
 * 未配置价格时返回 null。
 */
export function resolvePricingFromPreset(
  preset: APIPreset | Record<string, unknown> | null | undefined,
): Pricing | null {
  if (!preset || typeof preset !== "object") return null;
  // 先走统一字段规范化，再读 pricing
  const p = normalizeRuntimePreset({ ...(preset as Record<string, unknown>) });

  const nested = p.pricing;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const n = nested as Record<string, unknown>;
    const inputPrice = asNum(n.inputPrice ?? n.input);
    const outputPrice = asNum(n.outputPrice ?? n.output);
    if (inputPrice !== undefined || outputPrice !== undefined) {
      return {
        inputPrice: inputPrice ?? 0,
        outputPrice: outputPrice ?? 0,
        cacheHitPrice: asNum(n.cacheHitPrice ?? n.cacheRead ?? n.cache_hit_price),
        currency: typeof n.currency === "string" ? n.currency : "USD",
      };
    }
  }

  const inputPrice = asNum(p.inputPrice ?? p.input_price);
  const outputPrice = asNum(p.outputPrice ?? p.output_price);
  if (inputPrice === undefined && outputPrice === undefined) return null;

  return {
    inputPrice: inputPrice ?? 0,
    outputPrice: outputPrice ?? 0,
    cacheHitPrice: asNum(p.cacheHitPrice ?? p.cache_hit_price),
    currency: typeof p.currency === "string" ? p.currency : "USD",
  };
}

/**
 * 规范化单个 preset，返回新对象（不改入参）。
 * 实现：@little-house-studio/types normalizeRuntimePreset
 */
export function normalizeApiPreset(
  raw: APIPreset | Record<string, unknown>,
): APIPreset {
  return normalizeRuntimePreset({
    ...(raw as Record<string, unknown>),
  }) as unknown as APIPreset;
}

/** 批量规范化 */
export function normalizeApiPresets(
  presets: Array<APIPreset | Record<string, unknown>>,
): APIPreset[] {
  return presets.map((p) => normalizeApiPreset(p));
}

/**
 * 读取 maxConcurrent（0 / 缺失 = 不限制）。
 */
export function getPresetMaxConcurrent(
  preset: APIPreset | Record<string, unknown> | null | undefined,
): number {
  if (!preset) return 0;
  const p = preset as Record<string, unknown>;
  const n = asNum(p.maxConcurrent ?? p.max_concurrent);
  if (n === undefined || n <= 0) return 0;
  return Math.floor(n);
}
