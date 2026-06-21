/**
 * 模型注册表 SDK
 *
 * 对标 pi-ai：getProviders / getModels / getModel —— 内置一张带能力与定价的模型目录，
 * 省去手填 preset；并提供 toAPIPreset 一键把目录项转成 LLMClient 用的 APIPreset。
 *
 * @example
 * import { getModel, toAPIPreset } from "core/llm/registry"
 * const preset = toAPIPreset("anthropic", "claude-sonnet-4-5")  // key 自动从 ANTHROPIC_API_KEY 读
 * await new ChatSession({ preset }).send("hi")
 */

import type { APIPreset } from "../adapters/types.js";
import type { ModelSpec, ProviderSpec } from "./types.js";
import { CATALOG } from "./catalog.js";
import { getEnvApiKey } from "../env.js";
import { readEnv } from "../runtime-env.js";

export type { ModelSpec, ProviderSpec, ModelPricing, InputModality, OutputModality } from "./types.js";

/** provider id → ProviderSpec（可被 registerProvider 扩展/覆盖） */
const PROVIDERS = new Map<string, ProviderSpec>();
for (const p of CATALOG) PROVIDERS.set(p.id, structuredClone(p));

// ── 查询 ──

/** 列出所有 provider */
export function getProviders(): ProviderSpec[] {
  return [...PROVIDERS.values()];
}

/** 取某个 provider 的元信息 */
export function getProvider(provider: string): ProviderSpec | null {
  return PROVIDERS.get(provider) ?? null;
}

/** 列出某个 provider 的所有模型 */
export function getModels(provider: string): ModelSpec[] {
  return PROVIDERS.get(provider)?.models ?? [];
}

/** 取某个 provider 下指定 id 的模型 */
export function getModel(provider: string, id: string): ModelSpec | null {
  const p = PROVIDERS.get(provider);
  if (!p) return null;
  return p.models.find((m) => m.id === id) ?? null;
}

/** 跨 provider 按模型 id 查找（返回首个命中；可选限定 provider 前缀） */
export function findModel(id: string): ModelSpec | null {
  for (const p of PROVIDERS.values()) {
    const m = p.models.find((mm) => mm.id === id);
    if (m) return m;
  }
  return null;
}

/** 列出所有模型（跨 provider 扁平化） */
export function getAllModels(): ModelSpec[] {
  const out: ModelSpec[] = [];
  for (const p of PROVIDERS.values()) out.push(...p.models);
  return out;
}

// ── 扩展 ──

/** 注册/覆盖一个 provider（含其模型） */
export function registerProvider(spec: ProviderSpec): void {
  PROVIDERS.set(spec.id, structuredClone(spec));
}

/** 向已有 provider 追加/覆盖一个模型（provider 不存在时自动创建占位 provider） */
export function registerModel(provider: string, model: ModelSpec): void {
  let p = PROVIDERS.get(provider);
  if (!p) {
    p = { id: provider, name: provider, protocol: model.protocol, baseUrl: model.baseUrl ?? "", models: [] };
    PROVIDERS.set(provider, p);
  }
  const idx = p.models.findIndex((m) => m.id === model.id);
  if (idx >= 0) p.models[idx] = { ...model };
  else p.models.push({ ...model });
}

// ── 桥接到 LLMClient ──

/**
 * 把目录中的一个模型转成 APIPreset。
 * key 解析顺序：opts.key → 环境变量（provider.envKey）→ 空。
 *
 * @param provider provider id
 * @param id       模型 id
 * @param opts.key 显式 API key（覆盖环境变量）
 * @param opts.baseUrl 覆盖默认端点
 */
export function toAPIPreset(
  provider: string,
  id: string,
  opts?: { key?: string; baseUrl?: string },
): APIPreset {
  const p = PROVIDERS.get(provider);
  if (!p) throw new Error(`未知 provider: ${provider}`);
  const m = p.models.find((mm) => mm.id === id);
  if (!m) throw new Error(`provider ${provider} 下未找到模型: ${id}`);

  const key =
    opts?.key ??
    (p.envKey ? readEnv(p.envKey)?.trim() : undefined) ??
    getEnvApiKey(provider);
  const url = opts?.baseUrl ?? m.baseUrl ?? p.baseUrl;

  const preset: APIPreset = {
    name: `${provider}/${id}`,
    model: m.id,
    url,
    protocol: m.protocol,
    supportsVision: m.input.includes("image"),
    supportsReasoning: m.reasoning,
    nativeToolCalling: m.toolCall,
    maxTokens: m.maxTokens,
    maxContext: m.contextWindow,
  };
  if (key) preset.key = key;
  // 把定价带上，供 ChatSession.getTotalUsage / computeCost 使用
  if (m.pricing) {
    (preset as Record<string, unknown>).pricing = {
      inputPrice: m.pricing.input,
      outputPrice: m.pricing.output,
      cacheHitPrice: m.pricing.cacheRead ?? 0,
      currency: m.pricing.currency ?? "USD",
    };
  }
  return preset;
}
