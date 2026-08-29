/**
 * 上下文窗口大小的单一解析入口：预设 → 模型目录 → 旧式 maxTokens → 保守兜底。
 *
 * 兜底值必须偏大：偏小会让压缩提前来、白花摘要钱；偏大只会晚压一轮，
 * 由厂商的超窗报错 + forceShrinkPromptForOverflow 兜住。
 */

import { findModel, getModel } from "./registry/index.js";

/** 目录查不到、预设也没写时用的保守窗口。 */
export const FALLBACK_CONTEXT_WINDOW = 200_000;

/**
 * 窗口这个数是哪来的。
 * `max_tokens` 是旧配置把输出上限当窗口写的遗留，界面上要标明它是猜的。
 */
export type ContextWindowSource = "preset" | "catalog" | "max_tokens" | "fallback";

export interface ResolvedContextWindow {
  window: number;
  source: ContextWindowSource;
  /** 参与解析的模型 id，供 /context 说清这个数是哪来的 */
  model?: string;
}

function positive(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.trunc(n);
}

function catalogWindow(preset: Record<string, unknown>): number | undefined {
  const model = String(preset.model ?? "").trim();
  if (!model) return undefined;
  const provider = String(preset.provider ?? "").trim();
  const spec = (provider ? getModel(provider, model) : null) ?? findModel(model);
  return positive(spec?.contextWindow);
}

export function resolveContextWindow(
  preset: Record<string, unknown> | null | undefined,
): ResolvedContextWindow {
  const p = (preset ?? {}) as Record<string, unknown>;
  const model = String(p.model ?? "").trim() || undefined;

  const explicit = positive(p.maxContext ?? p.max_context);
  if (explicit) return { window: explicit, source: "preset", model };

  const fromCatalog = catalogWindow(p);
  if (fromCatalog) return { window: fromCatalog, source: "catalog", model };

  const legacy = positive(p.maxTokens ?? p.max_tokens);
  if (legacy) return { window: legacy, source: "max_tokens", model };

  return { window: FALLBACK_CONTEXT_WINDOW, source: "fallback", model };
}

/** 只要数字的便捷形式。 */
export function contextWindowOf(preset: Record<string, unknown> | null | undefined): number {
  return resolveContextWindow(preset).window;
}

/**
 * 把目录窗口回填到 preset 上（不覆盖用户明写的 maxContext）。
 * 让下游任何只读 `preset.maxContext` 的代码也拿到真实窗口。
 */
export function backfillContextWindow<T extends Record<string, unknown>>(preset: T): T {
  if (positive(preset.maxContext ?? preset.max_context)) return preset;
  const fromCatalog = catalogWindow(preset);
  if (!fromCatalog) return preset;
  return { ...preset, maxContext: fromCatalog };
}

export function describeContextWindowSource(source: ContextWindowSource): string {
  switch (source) {
    case "preset":
      return "预设";
    case "catalog":
      return "模型目录";
    case "max_tokens":
      return "旧 max_tokens（猜）";
    default:
      return "兜底（猜）";
  }
}
