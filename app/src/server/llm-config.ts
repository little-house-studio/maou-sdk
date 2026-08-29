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
  loadPresetsFromMaouConfig,
  resolveMaouConfigPath,
  saveGlobalApiConfig,
} from "@little-house-studio/agent";
import type { APIPreset } from "@little-house-studio/llm";
import { resolveContextWindow } from "@little-house-studio/llm";
import { migratePresetPlainKey, stripPresetPlainKey } from "@little-house-studio/types";
import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export type LlmConfigProtocol =
  | "openai"
  | "anthropic"
  | "openai-responses"
  | string;

/** 厂商/标准预设（UI 选用，可改 URL） */
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

export type LlmConfigRoles = {
  main?: string;
  fast?: string;
  vision?: string;
  helper?: string;
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
  defaultPreset: number;
  presets: LlmConfigPresetDto[];
  /** Agent 层 / 模板默认：角色 → preset name */
  roles: LlmConfigRoles;
  vendors: typeof VENDOR_STANDARDS;
  roleDefs: typeof AGENT_MODEL_ROLES;
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

function readApiMeta(configPath: string): {
  defaultPreset: number;
  roles: LlmConfigRoles;
} {
  try {
    if (!existsSync(configPath)) return { defaultPreset: 0, roles: {} };
    const raw = JSON.parse(readFileSync(configPath, "utf8")) as {
      api?: {
        defaultPreset?: number;
        roles?: Record<string, string | number>;
        helperPreset?: number;
        presets?: { name?: string }[];
      };
    };
    const api = raw.api ?? {};
    const roles: LlmConfigRoles = {};
    const r = api.roles ?? {};
    if (r.main != null) roles.main = String(r.main);
    if (r.fast != null) roles.fast = String(r.fast);
    if (r.vision != null) roles.vision = String(r.vision);
    if (r.helper != null) roles.helper = String(r.helper);
    // legacy helperPreset 下标 → roles.helper（name）；与 saveGlobalApiConfig 提升逻辑一致
    // 注意：磁盘 presets 可能是嵌套 models[]，下标按「厂商」项，name 取连接名
    if (
      roles.helper == null &&
      typeof api.helperPreset === "number" &&
      Array.isArray(api.presets)
    ) {
      const hp = api.presets[api.helperPreset] as { name?: string } | undefined;
      if (hp?.name) roles.helper = String(hp.name);
    }
    const n = api.defaultPreset;
    return {
      defaultPreset: typeof n === "number" && n >= 0 ? Math.floor(n) : 0,
      roles,
    };
  } catch {
    return { defaultPreset: 0, roles: {} };
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
  const presets = loadPresetsFromMaouConfig(path);
  const meta = readApiMeta(path);
  const defaultPreset = Math.min(
    meta.defaultPreset,
    Math.max(0, presets.length - 1),
  );
  // If roles.main empty, derive from defaultPreset name
  const roles = { ...meta.roles };
  if (!roles.main && presets[defaultPreset]) {
    roles.main = String(
      presets[defaultPreset]!.name ?? presets[defaultPreset]!.model ?? "",
    );
  }
  return {
    configPath: path,
    defaultPreset,
    presets: presets.map(toPresetDto),
    roles,
    vendors: VENDOR_STANDARDS,
    roleDefs: AGENT_MODEL_ROLES,
  };
}

function normalizeRoles(
  roles: LlmConfigRoles | undefined,
  presetNames: string[],
): LlmConfigRoles {
  const out: LlmConfigRoles = {};
  const set = new Set(presetNames);
  const pick = (v: string | undefined): string | undefined => {
    if (!v?.trim()) return undefined;
    const t = v.trim();
    // allow name or index string
    if (set.has(t)) return t;
    const idx = Number(t);
    if (Number.isInteger(idx) && idx >= 0 && idx < presetNames.length) {
      return presetNames[idx];
    }
    // keep name even if not found (user renaming)
    return t;
  };
  if (roles?.main) out.main = pick(roles.main);
  if (roles?.fast) out.fast = pick(roles.fast);
  if (roles?.vision) out.vision = pick(roles.vision);
  if (roles?.helper) out.helper = pick(roles.helper);
  // helper defaults to fast if only fast set
  if (!out.helper && out.fast) out.helper = out.fast;
  return out;
}

export function saveLlmConfigFromClient(opts: {
  presets: LlmConfigPresetWrite[];
  defaultPreset?: number;
  roles?: LlmConfigRoles;
  replace?: boolean;
  configPath?: string;
}): LlmConfigSnapshot {
  const path = opts.configPath?.trim() || resolveMaouConfigPath();
  const existing = loadPresetsFromMaouConfig(path);
  const byName = new Map<string, APIPreset>();
  for (const p of existing) {
    const n = String(p.name ?? p.model ?? "");
    if (n) byName.set(n, p);
  }

  const merged: APIPreset[] = [];
  for (const inc of opts.presets) {
    const name = String(inc.name ?? "").trim();
    if (!name) continue;
    const prev = byName.get(name);
    const next = mergePresetPreservingKey(inc, prev);
    merged.push(next);
    byName.set(name, next);
  }

  const names = merged.map((p) => String(p.name ?? p.model ?? ""));
  let defaultPreset = opts.defaultPreset;
  if (defaultPreset == null && opts.roles?.main) {
    const i = names.indexOf(String(opts.roles.main));
    if (i >= 0) defaultPreset = i;
  }
  if (defaultPreset == null) defaultPreset = 0;

  const roles = normalizeRoles(opts.roles, names);
  // Sync defaultPreset with roles.main when possible
  if (roles.main) {
    const i = names.indexOf(roles.main);
    if (i >= 0) defaultPreset = i;
  }

  const userRoot = dirname(path);
  const forDisk = merged.map((p) => {
    const rec = { ...(p as unknown as Record<string, unknown>) };
    migratePresetPlainKey(rec, userRoot);
    return stripPresetPlainKey(rec);
  });

  saveGlobalApiConfig({
    presets: forDisk as unknown as APIPreset[],
    defaultPreset,
    replace: Boolean(opts.replace),
    roles,
    configPath: path,
  });

  return loadLlmConfigSnapshot(path);
}
