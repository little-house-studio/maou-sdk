/**
 * Global LLM + Agent role config for WebUI.
 *
 * 分层（产品）:
 * 1. LLM 层：单个模型 preset（厂商 + 模型 + 隐藏参数）
 * 2. Agent 层：roles 绑定主/小/多模态方案
 * 3. 模板默认：即全局 roles（main/fast/vision），模板运行时 resolveApiRolePreset
 *
 * SoT: loadPresetsFromMaouConfig + saveGlobalApiConfig
 */

import {
  loadApiDocument,
  loadPresetsFromMaouConfig,
  loadProvidersFromMaouConfig,
  resolveMaouConfigPath,
  saveGlobalApiConfig,
} from "@little-house-studio/agent";
import type { APIPreset } from "@little-house-studio/llm";
import { getProviders, resolveContextWindow, scanModels } from "@little-house-studio/llm";
import {
  KNOWN_API_PROTOCOLS,
  coerceApiDocument,
  migratePresetPlainKey,
  slugProviderId,
  stripPresetPlainKey,
  type ApiProvider,
  type ApiProviderModel,
  type ApiRoleRef,
} from "@little-house-studio/types";
import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export type LlmConfigProtocol =
  | "openai"
  | "anthropic"
  | "openai-responses"
  | string;

/** 协议下拉（不是厂商列表） */
export const PROTOCOL_OPTIONS: ReadonlyArray<{ id: string; label: string }> =
  KNOWN_API_PROTOCOLS.map((id) => ({
    id,
    label:
      id === "openai"
        ? "OpenAI 兼容"
        : id === "openai-responses"
          ? "OpenAI Responses"
          : id === "openai-codex"
            ? "OpenAI Codex"
            : id === "github-copilot"
              ? "GitHub Copilot"
              : id === "google-vertex"
                ? "Google Vertex"
                : id,
  }));

/** @deprecated 协议四项；设置快照改走 catalog */
export const VENDOR_STANDARDS: ReadonlyArray<{
  id: string;
  label: string;
  protocol: string;
  defaultUrl: string;
}> = [
  {
    id: "openai",
    label: "OpenAI 兼容",
    protocol: "openai",
    defaultUrl: "https://api.openai.com/v1",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    protocol: "anthropic",
    defaultUrl: "https://api.anthropic.com",
  },
  {
    id: "openai-responses",
    label: "OpenAI Responses",
    protocol: "openai-responses",
    defaultUrl: "https://api.openai.com/v1",
  },
  {
    id: "custom",
    label: "自定义",
    protocol: "openai",
    defaultUrl: "",
  },
];

/**
 * Agent 层方案 / 模板默认角色（同一 api.roles SoT）。
 * UI 两处入口（Agent 方案 / 模板默认）共用此定义，避免双份配置源。
 */
export const AGENT_MODEL_ROLES = [
  {
    id: "main" as const,
    label: "主模型",
    hint: "主对话 / agent loop",
    templateHint: "模板未单独指定时的默认主对话模型",
  },
  {
    id: "fast" as const,
    label: "小模型",
    hint: "压缩、分类、快速判定（便宜）",
    templateHint: "模板默认小模型：压缩 / 分类 / 轻量判定",
  },
  {
    id: "vision" as const,
    label: "多模态辅助模型",
    hint: "主模型缺图片/音视频能力时作转译与看图",
    templateHint: "主模型无对应模态时，用此模型转译/看图/听音",
  },
] as const;

export type AgentModelRoleId = (typeof AGENT_MODEL_ROLES)[number]["id"];

export type LlmRoleBinding = { provider: string; model: string };

export type LlmConfigRoles = {
  main?: LlmRoleBinding;
  fast?: LlmRoleBinding;
  vision?: LlmRoleBinding;
  helper?: LlmRoleBinding;
};

export type LlmCatalogEntry = {
  id: string;
  label: string;
  protocol: string;
  defaultUrl: string;
  configured?: boolean;
  models: Array<{
    id: string;
    name?: string;
    supportsImage?: boolean;
    supportsReasoning?: boolean;
  }>;
};

export type LlmProviderModelDto = {
  id: string;
  name: string;
  maxContext: number;
  maxTokens: number;
  supportsImage: boolean;
  supportsAudio: boolean;
  supportsVideo: boolean;
  supportsReasoning: boolean;
  nativeToolCalling: boolean;
  inputPricePerMt: string;
  outputPricePerMt: string;
  cacheHitPricePerMt: string;
  temperature: string;
  topP: string;
  presencePenalty: string;
  frequencyPenalty: string;
  customRequestJson: string;
};

export type LlmProviderDto = {
  id: string;
  displayName: string;
  protocol: LlmConfigProtocol;
  url: string;
  urlParams: string;
  maxConcurrent: string;
  keyMasked: string;
  hasKey: boolean;
  keyRef: string;
  defaultModel: string;
  models: LlmProviderModelDto[];
};

/** Client-safe preset (no full secret). */
export type LlmConfigPresetDto = {
  /** 自定义名称（preset name） */
  name: string;
  /** 厂商/标准 id */
  vendor: string;
  protocol: LlmConfigProtocol;
  url: string;
  /** 额外 URL 查询参数（不含 ?） */
  urlParams: string;
  model: string;
  maxContext: number;
  maxTokens: number;
  /** 多模态：图 / 音 / 视频 */
  supportsImage: boolean;
  supportsAudio: boolean;
  supportsVideo: boolean;
  supportsReasoning: boolean;
  nativeToolCalling: boolean;
  /**
   * Token 价格（USD / 1M tokens，可空）。
   * 供用量统计；不参与请求体。
   */
  inputPricePerMt: string;
  outputPricePerMt: string;
  cacheHitPricePerMt: string;
  /** 最大并发请求数（0 / 空 = 不限制） */
  maxConcurrent: string;
  /** 隐藏参数（缺省用空字符串表示未设置） */
  temperature: string;
  topP: string;
  presencePenalty: string;
  frequencyPenalty: string;
  /** 请求自定义 JSON（extraBody） */
  customRequestJson: string;
  keyMasked: string;
  hasKey: boolean;
  /** env:NAME / file:NAME；设置页只展示引用，不回说明文 */
  keyRef: string;
};

export type LlmConfigSnapshot = {
  configPath: string;
  providers: LlmProviderDto[];
  catalog: LlmCatalogEntry[];
  protocols: typeof PROTOCOL_OPTIONS;
  /** 运行时扁平，给 ChatPanel / 旧调用 */
  defaultPreset: number;
  presets: LlmConfigPresetDto[];
  roles: LlmConfigRoles;
  vendors: typeof VENDOR_STANDARDS;
  roleDefs: typeof AGENT_MODEL_ROLES;
};

export type LlmProviderModelWrite = {
  id: string;
  name?: string;
  maxContext?: number;
  maxTokens?: number;
  supportsImage?: boolean;
  supportsAudio?: boolean;
  supportsVideo?: boolean;
  supportsReasoning?: boolean;
  nativeToolCalling?: boolean;
  inputPricePerMt?: string | number | null;
  outputPricePerMt?: string | number | null;
  cacheHitPricePerMt?: string | number | null;
  temperature?: string | number | null;
  topP?: string | number | null;
  presencePenalty?: string | number | null;
  frequencyPenalty?: string | number | null;
  customRequestJson?: string;
};

export type LlmProviderWrite = {
  id: string;
  displayName?: string;
  protocol?: string;
  url: string;
  urlParams?: string;
  key?: string;
  keyRef?: string;
  defaultModel?: string;
  maxConcurrent?: string | number | null;
  models: LlmProviderModelWrite[];
};

export type LlmConfigPresetWrite = {
  name: string;
  vendor?: string;
  protocol?: string;
  url: string;
  urlParams?: string;
  model: string;
  key?: string;
  keyRef?: string;
  maxContext?: number;
  maxTokens?: number;
  supportsImage?: boolean;
  supportsAudio?: boolean;
  supportsVideo?: boolean;
  supportsReasoning?: boolean;
  nativeToolCalling?: boolean;
  inputPricePerMt?: string | number | null;
  outputPricePerMt?: string | number | null;
  cacheHitPricePerMt?: string | number | null;
  maxConcurrent?: string | number | null;
  temperature?: string | number | null;
  topP?: string | number | null;
  presencePenalty?: string | number | null;
  frequencyPenalty?: string | number | null;
  customRequestJson?: string;
};

const DEFAULT_MAX_TOKENS = 32_768;

/** 没写 maxContext 时按模型目录派生，查不到落到 llm 层的保守兜底。 */
function fallbackMaxContext(model: unknown, provider?: unknown): number {
  return resolveContextWindow({ model, provider }).window;
}

export function maskApiKey(key: string | null | undefined): string {
  const k = (key ?? "").trim();
  if (!k) return "（未设置）";
  if (k.length <= 8) return "•".repeat(Math.min(k.length, 8));
  return `${k.slice(0, 3)}${"•".repeat(8)}${k.slice(-4)}`;
}

export function isMaskedOrEmptyKey(key: string | null | undefined): boolean {
  const k = (key ?? "").trim();
  if (!k) return true;
  if (k === "（未设置）") return true;
  if (/^•+$/.test(k)) return true;
  if (/^.{1,4}•{4,}.{0,6}$/.test(k) && k.includes("•")) return true;
  if (/^\*+$/.test(k) || /^x{4,}$/i.test(k)) return true;
  if (/^sk-•|^sk-\*|^<.*>$/.test(k)) return true;
  return false;
}

export function normalizeProtocol(p: string | undefined): string {
  return (p ?? "openai").trim() || "openai";
}

export function vendorFromProtocol(protocol: string): string {
  const p = normalizeProtocol(protocol);
  if (VENDOR_STANDARDS.some((v) => v.id === p && v.id !== "custom")) return p;
  return "custom";
}

/** Compose base url + query params */
export function composeUrl(base: string, params: string): string {
  const b = base.trim().replace(/\?+$/, "");
  const q = params.trim().replace(/^\?/, "");
  if (!q) return b;
  if (b.includes("?")) {
    return `${b}${b.endsWith("&") || b.endsWith("?") ? "" : "&"}${q}`;
  }
  return `${b}?${q}`;
}

function parseOptNumber(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : undefined;
}

function numToUi(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  const s = String(v).trim();
  return s;
}

function parseExtraBody(raw: string | undefined): Record<string, unknown> | undefined {
  const t = (raw ?? "").trim();
  if (!t) return undefined;
  try {
    const o = JSON.parse(t) as unknown;
    if (o && typeof o === "object" && !Array.isArray(o)) {
      return o as Record<string, unknown>;
    }
  } catch {
    /* invalid — store as note field */
  }
  return undefined;
}

type ExtendedPreset = APIPreset & {
  supportsReasoning?: boolean;
  nativeToolCalling?: boolean;
  supportsAudio?: boolean;
  supportsVideo?: boolean;
  /** USD per 1M tokens */
  inputPrice?: number;
  outputPrice?: number;
  cacheHitPrice?: number;
  input_price?: number;
  output_price?: number;
  cache_hit_price?: number;
  /** 嵌套定价（与 computeCost / stream 对齐） */
  pricing?: {
    inputPrice?: number;
    outputPrice?: number;
    cacheHitPrice?: number;
    input?: number;
    output?: number;
    cacheRead?: number;
    currency?: string;
  };
  maxConcurrent?: number;
  max_concurrent?: number;
  temperature?: number;
  top_p?: number;
  topP?: number;
  presence_penalty?: number;
  presencePenalty?: number;
  frequency_penalty?: number;
  frequencyPenalty?: number;
  urlParams?: string;
  vendor?: string;
  customRequestJson?: string;
  extraBody?: Record<string, unknown>;
  keyRef?: string;
};

export function mergePresetPreservingKey(
  incoming: LlmConfigPresetWrite,
  existing: APIPreset | null | undefined,
): APIPreset {
  const prev = (existing ?? {}) as ExtendedPreset;
  const name = String(incoming.name ?? "").trim();
  const protocol = normalizeProtocol(
    incoming.protocol ?? prev.protocol,
  );
  const urlParams = String(
    incoming.urlParams ?? prev.urlParams ?? "",
  ).trim().replace(/^\?/, "");
  const baseUrl = String(incoming.url ?? prev.url ?? "").trim();
  // Persist composed url for LLM client; also keep urlParams for UI
  const url = composeUrl(baseUrl.split("?")[0] || baseUrl, urlParams) || baseUrl;

  let key = "";
  if (!isMaskedOrEmptyKey(incoming.key)) {
    key = String(incoming.key).trim();
  } else if (prev.key && String(prev.key).trim()) {
    key = String(prev.key).trim();
  }
  const keyRef =
    incoming.keyRef?.trim() ||
    (typeof prev.keyRef === "string" ? prev.keyRef.trim() : "");

  const maxContext =
    parseOptNumber(incoming.maxContext) ??
    (typeof prev.maxContext === "number"
      ? prev.maxContext
      : fallbackMaxContext(incoming.model ?? prev.model, prev.provider));
  const maxTokens =
    parseOptNumber(incoming.maxTokens) ??
    (typeof prev.maxTokens === "number" ? prev.maxTokens : DEFAULT_MAX_TOKENS);

  const supportsVision =
    typeof incoming.supportsImage === "boolean"
      ? incoming.supportsImage
      : Boolean(prev.supportsVision ?? false);
  const supportsAudio =
    typeof incoming.supportsAudio === "boolean"
      ? incoming.supportsAudio
      : Boolean(prev.supportsAudio ?? false);
  const supportsVideo =
    typeof incoming.supportsVideo === "boolean"
      ? incoming.supportsVideo
      : Boolean(prev.supportsVideo ?? false);
  const supportsReasoning =
    typeof incoming.supportsReasoning === "boolean"
      ? incoming.supportsReasoning
      : Boolean(prev.supportsReasoning ?? false);
  const nativeToolCalling =
    typeof incoming.nativeToolCalling === "boolean"
      ? incoming.nativeToolCalling
      : Boolean(prev.nativeToolCalling ?? true);

  const temperature = parseOptNumber(incoming.temperature) ?? prev.temperature;
  const topP =
    parseOptNumber(incoming.topP) ?? prev.top_p ?? prev.topP;
  const presencePenalty =
    parseOptNumber(incoming.presencePenalty) ??
    prev.presence_penalty ??
    prev.presencePenalty;
  const frequencyPenalty =
    parseOptNumber(incoming.frequencyPenalty) ??
    prev.frequency_penalty ??
    prev.frequencyPenalty;

  const prevPricing = prev.pricing;
  const inputPrice =
    parseOptNumber(incoming.inputPricePerMt) ??
    prev.inputPrice ??
    prev.input_price ??
    (prevPricing ? parseOptNumber(prevPricing.inputPrice ?? prevPricing.input) : undefined);
  const outputPrice =
    parseOptNumber(incoming.outputPricePerMt) ??
    prev.outputPrice ??
    prev.output_price ??
    (prevPricing ? parseOptNumber(prevPricing.outputPrice ?? prevPricing.output) : undefined);
  const cacheHitPrice =
    parseOptNumber(incoming.cacheHitPricePerMt) ??
    prev.cacheHitPrice ??
    prev.cache_hit_price ??
    (prevPricing
      ? parseOptNumber(prevPricing.cacheHitPrice ?? prevPricing.cacheRead)
      : undefined);
  const maxConcurrent =
    parseOptNumber(incoming.maxConcurrent) ??
    prev.maxConcurrent ??
    prev.max_concurrent;

  let extraBody = prev.extraBody;
  const customRaw =
    incoming.customRequestJson !== undefined
      ? incoming.customRequestJson
      : prev.customRequestJson;
  if (incoming.customRequestJson !== undefined) {
    const parsed = parseExtraBody(incoming.customRequestJson);
    if (parsed) extraBody = parsed;
    else if (!String(incoming.customRequestJson).trim()) extraBody = undefined;
  }

  // Fold sampling into extraBody for adapters that read body params
  const sampling: Record<string, unknown> = { ...(extraBody ?? {}) };
  if (temperature !== undefined) sampling.temperature = temperature;
  if (topP !== undefined) sampling.top_p = topP;
  if (presencePenalty !== undefined) sampling.presence_penalty = presencePenalty;
  if (frequencyPenalty !== undefined) {
    sampling.frequency_penalty = frequencyPenalty;
  }

  const out: ExtendedPreset = {
    name,
    url,
    model: String(incoming.model ?? prev.model ?? "").trim(),
    key,
    ...(keyRef ? { keyRef } : {}),
    protocol,
    maxContext,
    maxTokens,
    supportsVision,
    supportsAudio,
    supportsVideo,
    supportsReasoning,
    nativeToolCalling,
    vendor: String(incoming.vendor ?? prev.vendor ?? vendorFromProtocol(protocol)),
    urlParams,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(topP !== undefined ? { top_p: topP } : {}),
    ...(presencePenalty !== undefined
      ? { presence_penalty: presencePenalty }
      : {}),
    ...(frequencyPenalty !== undefined
      ? { frequency_penalty: frequencyPenalty }
      : {}),
    // pricing：扁平 + 嵌套（computeCost / stream 读 preset.pricing）
    ...(inputPrice !== undefined
      ? { inputPrice, input_price: inputPrice }
      : {}),
    ...(outputPrice !== undefined
      ? { outputPrice, output_price: outputPrice }
      : {}),
    ...(cacheHitPrice !== undefined
      ? { cacheHitPrice, cache_hit_price: cacheHitPrice }
      : {}),
    ...(inputPrice !== undefined ||
    outputPrice !== undefined ||
    cacheHitPrice !== undefined
      ? {
          pricing: {
            inputPrice: inputPrice ?? 0,
            outputPrice: outputPrice ?? 0,
            ...(cacheHitPrice !== undefined
              ? { cacheHitPrice }
              : {}),
            currency: "USD",
          },
        }
      : {}),
    ...(maxConcurrent !== undefined
      ? { maxConcurrent, max_concurrent: maxConcurrent }
      : {}),
    ...(Object.keys(sampling).length
      ? { extraBody: sampling }
      : {}),
    ...(customRaw !== undefined && String(customRaw).trim()
      ? { customRequestJson: String(customRaw) }
      : {}),
  };
  return out as APIPreset;
}

export function toPresetDto(p: APIPreset): LlmConfigPresetDto {
  const x = p as ExtendedPreset;
  const key = typeof p.key === "string" ? p.key : "";
  const protocol = normalizeProtocol(p.protocol);
  const fullUrl = String(p.url ?? "");
  let url = fullUrl;
  let urlParams = String(x.urlParams ?? "");
  if (!urlParams && fullUrl.includes("?")) {
    const i = fullUrl.indexOf("?");
    url = fullUrl.slice(0, i);
    urlParams = fullUrl.slice(i + 1);
  }
  let customRequestJson = String(x.customRequestJson ?? "");
  if (!customRequestJson && x.extraBody && typeof x.extraBody === "object") {
    // strip sampling keys for display of "custom" only
    const rest = { ...x.extraBody };
    delete rest.temperature;
    delete rest.top_p;
    delete rest.presence_penalty;
    delete rest.frequency_penalty;
    if (Object.keys(rest).length) {
      try {
        customRequestJson = JSON.stringify(rest, null, 2);
      } catch {
        customRequestJson = "";
      }
    }
  }

  return {
    name: String(p.name ?? p.model ?? "preset"),
    vendor: String(x.vendor ?? vendorFromProtocol(protocol)),
    protocol,
    url,
    urlParams,
    model: String(p.model ?? ""),
    maxContext:
      typeof p.maxContext === "number"
        ? p.maxContext
        : fallbackMaxContext(p.model, (p as Record<string, unknown>).provider),
    maxTokens:
      typeof p.maxTokens === "number" ? p.maxTokens : DEFAULT_MAX_TOKENS,
    supportsImage: Boolean(p.supportsVision ?? false),
    supportsAudio: Boolean(x.supportsAudio ?? false),
    supportsVideo: Boolean(x.supportsVideo ?? false),
    supportsReasoning: Boolean(x.supportsReasoning ?? false),
    nativeToolCalling: Boolean(x.nativeToolCalling ?? true),
    inputPricePerMt: numToUi(
      x.inputPrice ??
        x.input_price ??
        x.pricing?.inputPrice ??
        x.pricing?.input,
    ),
    outputPricePerMt: numToUi(
      x.outputPrice ??
        x.output_price ??
        x.pricing?.outputPrice ??
        x.pricing?.output,
    ),
    cacheHitPricePerMt: numToUi(
      x.cacheHitPrice ??
        x.cache_hit_price ??
        x.pricing?.cacheHitPrice ??
        x.pricing?.cacheRead,
    ),
    maxConcurrent: numToUi(x.maxConcurrent ?? x.max_concurrent),
    temperature: numToUi(x.temperature),
    topP: numToUi(x.top_p ?? x.topP),
    presencePenalty: numToUi(x.presence_penalty ?? x.presencePenalty),
    frequencyPenalty: numToUi(x.frequency_penalty ?? x.frequencyPenalty),
    customRequestJson,
    keyMasked: key.trim().length > 0 || Boolean(x.keyRef) ? "已填" : "未填",
    hasKey: key.trim().length > 0 || Boolean(x.keyRef),
    keyRef: String(x.keyRef ?? ""),
  };
}

function asRoleBinding(v: unknown): LlmRoleBinding | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const r = v as Record<string, unknown>;
  const provider = String(r.provider ?? "").trim();
  const model = String(r.model ?? "").trim();
  if (!provider) return undefined;
  return { provider, model };
}

function readRolesFromDoc(configPath: string): LlmConfigRoles {
  try {
    const doc = loadApiDocument(configPath);
    const roles: LlmConfigRoles = {};
    for (const k of ["main", "fast", "vision", "helper"] as const) {
      const b = doc.roles[k];
      if (b?.provider) roles[k] = { provider: b.provider, model: b.model };
    }
    return roles;
  } catch {
    try {
      if (!existsSync(configPath)) return {};
      const raw = JSON.parse(readFileSync(configPath, "utf8")) as {
        api?: { roles?: Record<string, unknown> };
      };
      const roles: LlmConfigRoles = {};
      const r = raw.api?.roles ?? {};
      for (const k of ["main", "fast", "vision", "helper"] as const) {
        const b = asRoleBinding(r[k]);
        if (b) roles[k] = b;
      }
      return roles;
    } catch {
      return {};
    }
  }
}

function modelToDto(
  m: ApiProviderModel,
  provider: ApiProvider,
): LlmProviderModelDto {
  const flat = {
    ...provider,
    ...m,
    model: m.id,
    name: m.name ?? m.id,
    supportsVision: m.supportsVision ?? false,
  } as unknown as APIPreset;
  const d = toPresetDto(flat);
  return {
    id: m.id,
    name: String(m.name ?? m.id),
    maxContext: d.maxContext,
    maxTokens: d.maxTokens,
    supportsImage: d.supportsImage,
    supportsAudio: d.supportsAudio,
    supportsVideo: d.supportsVideo,
    supportsReasoning: d.supportsReasoning,
    nativeToolCalling: d.nativeToolCalling,
    inputPricePerMt: d.inputPricePerMt,
    outputPricePerMt: d.outputPricePerMt,
    cacheHitPricePerMt: d.cacheHitPricePerMt,
    temperature: d.temperature,
    topP: d.topP,
    presencePenalty: d.presencePenalty,
    frequencyPenalty: d.frequencyPenalty,
    customRequestJson: d.customRequestJson,
  };
}

function toProviderDto(id: string, p: ApiProvider): LlmProviderDto {
  const key = typeof p.key === "string" ? p.key : "";
  const fullUrl = String(p.url ?? "");
  let url = fullUrl;
  let urlParams = String(p.urlParams ?? "");
  if (!urlParams && fullUrl.includes("?")) {
    const i = fullUrl.indexOf("?");
    url = fullUrl.slice(0, i);
    urlParams = fullUrl.slice(i + 1);
  }
  return {
    id,
    displayName: String(p.displayName ?? id),
    protocol: normalizeProtocol(p.protocol),
    url,
    urlParams,
    maxConcurrent: numToUi(p.maxConcurrent),
    keyMasked: key.trim().length > 0 || Boolean(p.keyRef) ? "已填" : "未填",
    hasKey: key.trim().length > 0 || Boolean(p.keyRef),
    keyRef: String(p.keyRef ?? ""),
    defaultModel: String(p.defaultModel ?? p.models[0]?.id ?? ""),
    models: p.models.map((m) => modelToDto(m, p)),
  };
}

function buildCatalog(configuredIds: Set<string>): LlmCatalogEntry[] {
  try {
    return getProviders().map((p) => ({
      id: p.id,
      label: p.name,
      protocol: String(p.protocol ?? "openai"),
      defaultUrl: String(p.baseUrl ?? ""),
      models: (p.models ?? []).slice(0, 24).map((m) => ({
        id: m.id,
        name: m.name,
        supportsImage: Array.isArray(m.input) && m.input.includes("image"),
        supportsReasoning: Boolean(m.reasoning),
      })),
      configured: configuredIds.has(p.id),
    }));
  } catch {
    return [];
  }
}

/**
 * 从磁盘 + 可选表单覆盖构造可调用的 APIPreset（含真实 key）。
 * 用于「测试连接」：表单 key 为空/掩码时用已保存 key。
 */
export function resolvePresetForConnectionTest(
  body: {
    name?: string;
    url?: string;
    model?: string;
    key?: string;
    protocol?: string;
    vendor?: string;
    urlParams?: string;
    maxTokens?: number;
    maxContext?: number;
  },
  configPath?: string,
): APIPreset {
  const path = configPath?.trim() || resolveMaouConfigPath();
  const existing = loadPresetsFromMaouConfig(path);
  const name = String(body.name ?? "").trim();
  const prev =
    (name &&
      existing.find(
        (p) =>
          String(p.name ?? "") === name || String(p.model ?? "") === name,
      )) ||
    null;

  const write: LlmConfigPresetWrite = {
    name: name || String(prev?.name ?? prev?.model ?? "test"),
    url: String(body.url ?? prev?.url ?? "").trim(),
    model: String(body.model ?? prev?.model ?? "").trim(),
    protocol: String(body.protocol ?? prev?.protocol ?? "openai"),
    vendor: String(
      body.vendor ??
        (prev as { vendor?: string } | null)?.vendor ??
        "openai",
    ),
    urlParams: String(
      body.urlParams ??
        (prev as { urlParams?: string } | null)?.urlParams ??
        "",
    ),
    key: body.key,
    maxTokens:
      typeof body.maxTokens === "number"
        ? body.maxTokens
        : (prev?.maxTokens as number | undefined),
    maxContext:
      typeof body.maxContext === "number"
        ? body.maxContext
        : (prev?.maxContext as number | undefined),
  };

  return mergePresetPreservingKey(write, prev ?? undefined);
}

export function loadLlmConfigSnapshot(configPath?: string): LlmConfigSnapshot {
  const path = configPath?.trim() || resolveMaouConfigPath();
  const providers = loadProvidersFromMaouConfig(path);
  const flats = loadPresetsFromMaouConfig(path);
  const roles = readRolesFromDoc(path);
  const providerDtos = Object.entries(providers).map(([id, p]) =>
    toProviderDto(id, p),
  );
  if (!roles.main && providerDtos[0]?.models[0]) {
    roles.main = {
      provider: providerDtos[0].id,
      model: providerDtos[0].defaultModel || providerDtos[0].models[0].id,
    };
  }
  let defaultPreset = 0;
  if (roles.main) {
    const i = flats.findIndex(
      (p) =>
        (p as { _providerName?: string })._providerName === roles.main!.provider &&
        p.model === roles.main!.model,
    );
    if (i >= 0) defaultPreset = i;
  }
  return {
    configPath: path,
    providers: providerDtos,
    catalog: buildCatalog(new Set(Object.keys(providers))),
    protocols: PROTOCOL_OPTIONS,
    defaultPreset,
    presets: flats.map(toPresetDto),
    roles,
    vendors: VENDOR_STANDARDS,
    roleDefs: AGENT_MODEL_ROLES,
  };
}

function coerceIncomingRole(
  v: unknown,
  providers: Record<string, ApiProvider>,
): ApiRoleRef | undefined {
  const obj = asRoleBinding(v);
  if (obj) return obj;
  if (typeof v !== "string" && typeof v !== "number") return undefined;
  const name = String(v).trim();
  if (!name) return undefined;
  if (providers[name]) {
    const p = providers[name]!;
    return {
      provider: name,
      model: String(p.defaultModel ?? p.models[0]?.id ?? ""),
    };
  }
  const slash = name.indexOf("/");
  if (slash > 0) {
    return { provider: name.slice(0, slash), model: name.slice(slash + 1) };
  }
  for (const [id, p] of Object.entries(providers)) {
    if (p.models.some((m) => m.id === name || m.name === name)) {
      return { provider: id, model: name };
    }
  }
  return undefined;
}

function normalizeRoleBindings(
  roles: Record<string, unknown> | LlmConfigRoles | undefined,
  providers: Record<string, ApiProvider>,
): Record<string, ApiRoleRef> {
  const out: Record<string, ApiRoleRef> = {};
  if (!roles) return out;
  for (const [k, v] of Object.entries(roles)) {
    const b = coerceIncomingRole(v, providers);
    if (b) out[k] = b;
  }
  if (!out.helper && out.fast) out.helper = { ...out.fast };
  return out;
}

function mergeProviderFromWrite(
  incoming: LlmProviderWrite,
  prev: ApiProvider | undefined,
): ApiProvider {
  const id = slugProviderId(incoming.id || incoming.displayName || "provider");
  const models: ApiProviderModel[] = [];
  for (const m of incoming.models ?? []) {
    const mid = String(m.id ?? "").trim();
    if (!mid) continue;
    const prevFlat =
      prev?.models.find((x) => x.id === mid) && prev
        ? ({
            ...prev,
            ...prev.models.find((x) => x.id === mid),
            name: `${id}/${mid}`,
            model: mid,
          } as unknown as APIPreset)
        : undefined;
    const merged = mergePresetPreservingKey(
      {
        name: `${id}/${mid}`,
        vendor: id,
        protocol: incoming.protocol,
        url: incoming.url,
        urlParams: incoming.urlParams,
        model: mid,
        key: incoming.key,
        keyRef: incoming.keyRef || (id ? `file:${id}` : undefined),
        maxContext: m.maxContext,
        maxTokens: m.maxTokens,
        supportsImage: m.supportsImage,
        supportsAudio: m.supportsAudio,
        supportsVideo: m.supportsVideo,
        supportsReasoning: m.supportsReasoning,
        nativeToolCalling: m.nativeToolCalling,
        inputPricePerMt: m.inputPricePerMt,
        outputPricePerMt: m.outputPricePerMt,
        cacheHitPricePerMt: m.cacheHitPricePerMt,
        maxConcurrent: incoming.maxConcurrent,
        temperature: m.temperature,
        topP: m.topP,
        presencePenalty: m.presencePenalty,
        frequencyPenalty: m.frequencyPenalty,
        customRequestJson: m.customRequestJson,
      },
      prevFlat,
    ) as ExtendedPreset;
    models.push({
      id: mid,
      name: String(m.name ?? mid),
      maxTokens: merged.maxTokens,
      maxContext: merged.maxContext,
      supportsVision: merged.supportsVision,
      supportsAudio: merged.supportsAudio,
      supportsVideo: merged.supportsVideo,
      supportsReasoning: merged.supportsReasoning,
      nativeToolCalling: merged.nativeToolCalling,
      inputPrice: merged.inputPrice,
      outputPrice: merged.outputPrice,
      cacheHitPrice: merged.cacheHitPrice,
      temperature: merged.temperature,
      topP: merged.topP ?? merged.top_p,
      presencePenalty: merged.presencePenalty ?? merged.presence_penalty,
      frequencyPenalty: merged.frequencyPenalty ?? merged.frequency_penalty,
      extraBody: merged.extraBody,
      pricing: merged.pricing,
    });
  }
  const first = incoming.models[0];
  const conn = mergePresetPreservingKey(
    {
      name: id,
      protocol: incoming.protocol,
      url: incoming.url,
      urlParams: incoming.urlParams,
      model: first?.id ?? prev?.defaultModel ?? "model",
      key: incoming.key,
      keyRef: incoming.keyRef,
      maxConcurrent: incoming.maxConcurrent,
    },
    prev
      ? ({
          ...prev,
          name: id,
          model: prev.defaultModel ?? prev.models[0]?.id,
        } as unknown as APIPreset)
      : undefined,
  ) as ExtendedPreset;
  return {
    ...(prev ?? {}),
    displayName: incoming.displayName ?? prev?.displayName ?? id,
    protocol: normalizeProtocol(incoming.protocol ?? prev?.protocol),
    url: composeUrl(
      String(incoming.url ?? prev?.url ?? "").split("?")[0] || "",
      String(incoming.urlParams ?? prev?.urlParams ?? ""),
    ),
    key: conn.key,
    keyRef: conn.keyRef,
    urlParams: String(incoming.urlParams ?? prev?.urlParams ?? ""),
    maxConcurrent: conn.maxConcurrent,
    extraBody: conn.extraBody,
    customRequestJson: conn.customRequestJson,
    defaultModel:
      String(incoming.defaultModel ?? "").trim() ||
      models[0]?.id ||
      prev?.defaultModel,
    models,
  };
}

export function saveLlmConfigFromClient(opts: {
  providers?: LlmProviderWrite[];
  presets?: LlmConfigPresetWrite[];
  defaultPreset?: number;
  roles?: LlmConfigRoles | Record<string, string | LlmRoleBinding | undefined>;
  replace?: boolean;
  configPath?: string;
}): LlmConfigSnapshot {
  const path = opts.configPath?.trim() || resolveMaouConfigPath();
  const existing = loadProvidersFromMaouConfig(path);
  let providers: Record<string, ApiProvider>;

  if (opts.providers && opts.providers.length > 0) {
    providers = opts.replace ? {} : { ...existing };
    for (const inc of opts.providers) {
      const id = slugProviderId(inc.id || inc.displayName || "provider");
      if (!id) continue;
      if (!String(inc.url ?? "").trim()) {
        throw new Error(`厂商 "${id}" 需要 url`);
      }
      if (!inc.models?.some((m) => String(m.id ?? "").trim())) {
        throw new Error(`厂商 "${id}" 至少需要一个 model id`);
      }
      providers[id] = mergeProviderFromWrite(inc, existing[id]);
    }
  } else {
    const flats = loadPresetsFromMaouConfig(path);
    const byName = new Map<string, APIPreset>();
    for (const p of flats) {
      const n = String(p.name ?? p.model ?? "");
      if (n) byName.set(n, p);
    }
    const merged: APIPreset[] = [];
    for (const inc of opts.presets ?? []) {
      const name = String(inc.name ?? "").trim();
      if (!name) continue;
      const prev = byName.get(name);
      const next = mergePresetPreservingKey(inc, prev);
      merged.push(next);
      byName.set(name, next);
    }
    const userRoot = dirname(path);
    const forDisk = merged.map((p) => {
      const rec = { ...(p as unknown as Record<string, unknown>) };
      migratePresetPlainKey(rec, userRoot);
      return stripPresetPlainKey(rec);
    });
    const built = coerceApiDocument({ presets: forDisk }).providers;
    const incomingRoles = normalizeRoleBindings(
      opts.roles as Record<string, unknown> | undefined,
      built,
    );
    saveGlobalApiConfig({
      providers: built,
      replace: Boolean(opts.replace),
      roles: incomingRoles,
      configPath: path,
    });
    return loadLlmConfigSnapshot(path);
  }

  const userRoot = dirname(path);
  for (const p of Object.values(providers)) {
    const rec = p as unknown as Record<string, unknown>;
    migratePresetPlainKey(rec, userRoot);
    if (!rec.key && rec.keyRef) {
      /* key 在匣里 */
    }
    const stripped = stripPresetPlainKey({ ...rec });
    Object.assign(rec, stripped);
  }

  const roles = normalizeRoleBindings(
    opts.roles as Record<string, unknown> | undefined,
    providers,
  );

  saveGlobalApiConfig({
    providers,
    roles,
    replace: Boolean(opts.replace),
    configPath: path,
  });

  return loadLlmConfigSnapshot(path);
}

export async function scanDraftModels(body: {
  url?: string;
  key?: string;
  protocol?: string;
  urlParams?: string;
  name?: string;
}): Promise<{ supported: boolean; models: Array<{ id: string }>; reason?: string }> {
  const preset = resolvePresetForConnectionTest({
    name: body.name,
    url: body.url,
    key: body.key,
    protocol: body.protocol,
    urlParams: body.urlParams,
    model: "probe",
  });
  if (!String(preset.url ?? "").trim()) {
    return { supported: false, models: [], reason: "url required" };
  }
  return scanModels(preset);
}
