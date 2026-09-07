/**
 * 磁盘 SoT：api.providers 字典。路由 id 是身份。
 * 旧 api.presets[] 在 load 时迁过来。
 */

import { migratePresetsToNested } from "./preset-models.js";

export interface CatalogHint {
  id: string;
  baseUrl: string;
}

export interface ApiRoleRef {
  provider: string;
  model: string;
}

export interface ApiProviderModel {
  id: string;
  name?: string;
  maxTokens?: number;
  maxContext?: number;
  supportsVision?: boolean;
  supportsReasoning?: boolean;
  supportsAudio?: boolean;
  supportsVideo?: boolean;
  nativeToolCalling?: boolean;
  nativeStructuredOutput?: boolean;
  inputPrice?: number;
  outputPrice?: number;
  cacheHitPrice?: number;
  temperature?: number;
  topP?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  extraBody?: Record<string, unknown>;
  pricing?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ApiProvider {
  displayName?: string;
  protocol: string;
  url: string;
  key?: string;
  keyRef?: string;
  defaultModel?: string;
  models: ApiProviderModel[];
  vendor?: string;
  urlParams?: string;
  extraBody?: Record<string, unknown>;
  customRequestJson?: string;
  oauth?: boolean;
  oauthProvider?: "anthropic" | "openai-codex" | "github-copilot" | "google" | "xai";
  maxConcurrent?: number;
  [key: string]: unknown;
}

export const KNOWN_API_PROTOCOLS = [
  "openai",
  "anthropic",
  "openai-responses",
  "responses",
  "google",
  "mistral",
  "bedrock",
  "azure",
  "cloudflare",
  "google-vertex",
  "openai-codex",
  "github-copilot",
  "faux",
] as const;

export type KnownApiProtocol = (typeof KNOWN_API_PROTOCOLS)[number];

const KNOWN_PROTOCOL_SET = new Set<string>(KNOWN_API_PROTOCOLS);

export function isKnownApiProtocol(p: string): boolean {
  return KNOWN_PROTOCOL_SET.has(p.trim().toLowerCase());
}

export function assertKnownApiProtocol(p: string): string {
  const n = p.trim().toLowerCase() || "openai";
  if (!isKnownApiProtocol(n)) {
    throw new Error(
      `未知协议 "${p}"。可写：${KNOWN_API_PROTOCOLS.join(", ")}`,
    );
  }
  return n === "openai-responses" ? "responses" : n;
}

/** 常见官方 host → catalog id（types 不依赖 llm catalog） */
const HOST_TO_ID: Array<{ host: string; id: string }> = [
  { host: "api.openai.com", id: "openai" },
  { host: "api.anthropic.com", id: "anthropic" },
  { host: "api.deepseek.com", id: "deepseek" },
  { host: "generativelanguage.googleapis.com", id: "google" },
  { host: "api.groq.com", id: "groq" },
  { host: "api.cerebras.ai", id: "cerebras" },
  { host: "integrate.api.nvidia.com", id: "nvidia" },
  { host: "api.mistral.ai", id: "mistral" },
  { host: "api.x.ai", id: "xai" },
  { host: "api.moonshot.ai", id: "moonshotai" },
  { host: "api.moonshot.cn", id: "moonshot" },
  { host: "open.bigmodel.cn", id: "zhipuai" },
  { host: "openrouter.ai", id: "openrouter" },
  { host: "bedrock-runtime", id: "amazon-bedrock" },
  { host: "aiplatform.googleapis.com", id: "google-vertex" },
  { host: "api.minimax.chat", id: "minimax" },
  { host: "dashscope.aliyuncs.com", id: "qwen" },
  { host: "localhost:11434", id: "ollama" },
  { host: "127.0.0.1:11434", id: "ollama" },
  { host: "qianfan.baidubce.com", id: "ernie" },
  { host: "spark-api-open.xf-yun.com", id: "spark" },
  { host: "ark.cn-beijing.volces.com", id: "doubao" },
  { host: "api.hunyuan.cloud.tencent.com", id: "hunyuan" },
  { host: "api.360.cn", id: "qihoo-360" },
  { host: "api.githubcopilot.com", id: "github-copilot" },
];

const KNOWN_VENDOR_IDS = new Set([
  "openai",
  "anthropic",
  "google",
  "deepseek",
  "groq",
  "cerebras",
  "nvidia",
  "mistral",
  "xai",
  "moonshotai",
  "moonshot",
  "zhipuai",
  "zhipu",
  "openrouter",
  "amazon-bedrock",
  "google-vertex",
  "minimax",
  "github-copilot",
  "qwen",
  "ollama",
  "ernie",
  "spark",
  "doubao",
  "hunyuan",
  "qihoo-360",
  "custom",
]);

export function slugProviderId(raw: string): string {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const base = s.replace(/^[0-9]+/, "") || "provider";
  return base.slice(0, 64) || "provider";
}

function hostOf(url: string): string {
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).host.toLowerCase();
  } catch {
    return "";
  }
}

function idFromUrl(
  url: string,
  catalog?: CatalogHint[],
): string | undefined {
  const host = hostOf(url);
  if (!host) return undefined;
  for (const c of catalog ?? []) {
    const ch = hostOf(c.baseUrl);
    if (ch && (host === ch || host.endsWith(`.${ch}`) || ch.endsWith(`.${host}`))) {
      return c.id;
    }
  }
  for (const row of HOST_TO_ID) {
    if (host === row.host || host.endsWith(`.${row.host}`) || host.includes(row.host)) {
      return row.id;
    }
  }
  return undefined;
}

function uniqueId(wanted: string, used: Set<string>): string {
  let id = wanted;
  let n = 2;
  while (used.has(id)) {
    id = `${wanted}-${n}`;
    n += 1;
  }
  used.add(id);
  return id;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

function copyModel(raw: Record<string, unknown>): ApiProviderModel {
  const id = String(raw.id ?? raw.model ?? raw.name ?? "").trim();
  const out: ApiProviderModel = { id, ...raw };
  out.id = id;
  return out;
}

function nestedToProvider(
  nested: Record<string, unknown>,
  used: Set<string>,
  catalog?: CatalogHint[],
): { id: string; provider: ApiProvider } | null {
  const modelsRaw = Array.isArray(nested.models) ? nested.models : [];
  const models = modelsRaw
    .map((m) => asRecord(m))
    .filter((m): m is Record<string, unknown> => Boolean(m))
    .map(copyModel)
    .filter((m) => m.id);
  if (models.length === 0) return null;

  const url = String(nested.url ?? "").trim();
  const vendor = String(nested.vendor ?? "").trim();
  const name = String(nested.name ?? "").trim();
  const fromUrl = idFromUrl(url, catalog);
  const fromVendor =
    vendor && (KNOWN_VENDOR_IDS.has(vendor) || catalog?.some((c) => c.id === vendor))
      ? vendor === "zhipu"
        ? "zhipuai"
        : vendor
      : undefined;
  const fromName = slugProviderId(name.split("/")[0] || "");
  const wanted =
    fromUrl ||
    (fromName && fromName !== "provider" ? fromName : undefined) ||
    fromVendor ||
    fromName ||
    "provider";
  const id = uniqueId(wanted, used);

  const provider: ApiProvider = {
    ...nested,
    displayName: String(nested.displayName ?? name.split("/")[0] ?? id),
    protocol: String(nested.protocol ?? "openai").trim() || "openai",
    url,
    models,
    defaultModel:
      String(nested.defaultModel ?? "").trim() || models[0]!.id,
  };
  delete (provider as Record<string, unknown>).name;
  delete (provider as Record<string, unknown>).model;
  delete (provider as Record<string, unknown>)._providerName;
  delete (provider as Record<string, unknown>)._modelIndex;
  return { id, provider };
}

export function migratePresetsToProviders(
  presets: unknown[],
  opts?: { catalog?: CatalogHint[] },
): Record<string, ApiProvider> {
  const nested = migratePresetsToNested(presets);
  const used = new Set<string>();
  const out: Record<string, ApiProvider> = {};
  for (const item of nested) {
    const rec = asRecord(item);
    if (!rec) continue;
    const got = nestedToProvider(rec, used, opts?.catalog);
    if (!got) continue;
    out[got.id] = got.provider;
  }
  return out;
}

function flattenOne(
  id: string,
  provider: ApiProvider,
): Array<Record<string, unknown>> {
  const models = provider.models ?? [];
  return models.map((m, idx) => {
    const alias = String(m.name ?? "").trim();
    const runtimeName =
      models.length === 1 ? id : `${id}/${alias || m.id}`;
    const shared = { ...provider } as Record<string, unknown>;
    delete shared.models;
    delete shared.defaultModel;
    return {
      ...shared,
      ...m,
      name: runtimeName,
      model: m.id,
      url: provider.url,
      protocol: provider.protocol,
      key: provider.key,
      keyRef: provider.keyRef,
      _providerName: id,
      _modelIndex: idx,
      displayName: provider.displayName,
    };
  });
}

/** 运行时扁平列表（给 LLMClient / 旧 findPresetByRef） */
export function providersToRuntimePresets(
  providers: Record<string, ApiProvider>,
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const [id, p] of Object.entries(providers)) {
    if (!p) continue;
    out.push(...flattenOne(id, p));
  }
  return out;
}

/** 连接级 + 该模型 → 扁平 APIPreset 形状（给 LLMClient） */
export function toAPIPreset(
  providers: Record<string, ApiProvider>,
  providerId: string,
  modelId?: string,
): Record<string, unknown> | undefined {
  return resolveProviderModel(providers, providerId, modelId);
}

/** 从运行时扁平项取出真路由 id + model id */
export function runtimePresetRoute(p: {
  name?: unknown;
  model?: unknown;
  _providerName?: unknown;
}): ApiRoleRef | undefined {
  const model = String(p.model ?? "").trim();
  const pid = String(p._providerName ?? "").trim();
  if (pid) return { provider: pid, model };
  const name = String(p.name ?? "").trim();
  if (!name) return undefined;
  if (name.includes("/")) {
    const i = name.indexOf("/");
    return {
      provider: name.slice(0, i),
      model: model || name.slice(i + 1),
    };
  }
  return { provider: name, model };
}

export function resolveProviderModel(
  providers: Record<string, ApiProvider>,
  providerId: string,
  modelId?: string,
): Record<string, unknown> | undefined {
  const p = providers[providerId];
  if (!p) return undefined;
  const want =
    String(modelId ?? "").trim() ||
    String(p.defaultModel ?? "").trim() ||
    p.models[0]?.id;
  if (!want) return undefined;
  const hit =
    p.models.find((m) => m.id === want) ??
    p.models.find((m) => String(m.name ?? "") === want) ??
    p.models[0];
  if (!hit) return undefined;
  const flat = flattenOne(providerId, { ...p, models: [hit] });
  return flat[0];
}

export function isApiRoleRef(v: unknown): v is ApiRoleRef {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  return typeof r.provider === "string" && String(r.provider).trim().length > 0;
}

export function parseRoleBinding(v: unknown): ApiRoleRef | undefined {
  if (isApiRoleRef(v)) {
    return {
      provider: String(v.provider).trim(),
      model: String(v.model ?? "").trim(),
    };
  }
  if (typeof v === "string" && v.includes("/")) {
    const i = v.indexOf("/");
    return {
      provider: v.slice(0, i).trim(),
      model: v.slice(i + 1).trim(),
    };
  }
  return undefined;
}

export function roleBindingKey(ref: ApiRoleRef): string {
  return ref.model ? `${ref.provider}/${ref.model}` : ref.provider;
}

function findFlatByRef(
  flat: Array<Record<string, unknown>>,
  ref: unknown,
): Record<string, unknown> | undefined {
  if (ref === undefined || ref === null) return undefined;
  if (typeof ref === "number") {
    return ref >= 0 && ref < flat.length ? flat[ref] : undefined;
  }
  const name = String(ref).trim();
  if (!name) return undefined;
  const byName = flat.find((p) => String(p.name ?? "") === name);
  if (byName) return byName;
  const byModel = flat.find((p) => String(p.model ?? "") === name);
  if (byModel) return byModel;
  const prefix = flat.find(
    (p) =>
      String(p.name ?? "") === name ||
      String(p.name ?? "").startsWith(`${name}/`),
  );
  if (prefix) return prefix;
  if (name.includes("/")) {
    const mid = name.split("/").slice(1).join("/");
    return flat.find(
      (p) =>
        String(p.model ?? "") === mid && String(p.name ?? "").endsWith(`/${mid}`),
    );
  }
  return undefined;
}

/**
 * 旧 roles（name / 下标）→ { provider, model }。
 */
export function migrateRolesToBindings(
  roles: unknown,
  flat: Array<Record<string, unknown>>,
  defaultPreset?: number,
  helperPreset?: number,
): Record<string, ApiRoleRef> {
  const out: Record<string, ApiRoleRef> = {};
  const src =
    roles && typeof roles === "object" && !Array.isArray(roles)
      ? (roles as Record<string, unknown>)
      : {};

  const bind = (key: string, ref: unknown) => {
    if (isApiRoleRef(ref)) {
      out[key] = {
        provider: String(ref.provider).trim(),
        model: String(ref.model ?? "").trim(),
      };
      return;
    }
    const rec = findFlatByRef(flat, ref);
    if (!rec) return;
    const provider = String(
      rec._providerName ??
        (String(rec.name ?? "").includes("/")
          ? String(rec.name).split("/")[0]
          : rec.name) ??
        "",
    ).trim();
    const model = String(rec.model ?? "").trim();
    if (provider && model) out[key] = { provider, model };
  };

  for (const [k, v] of Object.entries(src)) bind(k, v);

  if (!out.main && typeof defaultPreset === "number") {
    bind("main", defaultPreset);
  }
  if (!out.helper && typeof helperPreset === "number") {
    bind("helper", helperPreset);
  }
  return out;
}

export interface CoercedApiDocument {
  providers: Record<string, ApiProvider>;
  roles: Record<string, ApiRoleRef>;
  dirty: boolean;
}

/**
 * 把任意 api 段收成 providers + 新 roles。已是 providers 则原样（仍迁 roles）。
 */
export function coerceApiDocument(
  api: unknown,
  opts?: { catalog?: CatalogHint[] },
): CoercedApiDocument {
  const raw = asRecord(api) ?? {};
  const existing = asRecord(raw.providers);
  let dirty = false;
  let providers: Record<string, ApiProvider> = {};

  if (existing && Object.keys(existing).length > 0) {
    for (const [id, v] of Object.entries(existing)) {
      const rec = asRecord(v);
      if (!rec) continue;
      const models = Array.isArray(rec.models)
        ? rec.models
            .map((m) => asRecord(m))
            .filter((m): m is Record<string, unknown> => Boolean(m))
            .map(copyModel)
            .filter((m) => m.id)
        : [];
      if (models.length === 0) continue;
      providers[id] = {
        displayName: String(rec.displayName ?? id),
        protocol: String(rec.protocol ?? "openai") || "openai",
        url: String(rec.url ?? ""),
        ...rec,
        models,
        defaultModel: String(rec.defaultModel ?? models[0]!.id),
      };
    }
  } else if (Array.isArray(raw.presets) && raw.presets.length > 0) {
    providers = migratePresetsToProviders(raw.presets, opts);
    dirty = true;
  }

  const flat = providersToRuntimePresets(providers);
  const roles = migrateRolesToBindings(
    raw.roles,
    flat,
    typeof raw.defaultPreset === "number" ? raw.defaultPreset : undefined,
    typeof raw.helperPreset === "number" ? raw.helperPreset : undefined,
  );

  const prevRoles = asRecord(raw.roles) ?? {};
  for (const [k, v] of Object.entries(roles)) {
    const old = prevRoles[k];
    if (!isApiRoleRef(old) || old.provider !== v.provider || old.model !== v.model) {
      dirty = true;
    }
  }
  if (raw.presets != null || raw.defaultPreset != null || raw.helperPreset != null) {
    dirty = true;
  }

  return { providers, roles, dirty };
}

/** 写回磁盘用的 api 段：只留 providers + roles + 非名单字段 */
export function apiDocumentForDisk(
  prevApi: Record<string, unknown>,
  doc: CoercedApiDocument,
): Record<string, unknown> {
  const next = { ...prevApi };
  delete next.presets;
  delete next.defaultPreset;
  delete next.helperPreset;
  next.providers = doc.providers;
  if (Object.keys(doc.roles).length > 0) next.roles = doc.roles;
  else delete next.roles;
  return next;
}

export function firstProviderModel(
  providers: Record<string, ApiProvider>,
): ApiRoleRef | undefined {
  for (const [id, p] of Object.entries(providers)) {
    const mid = String(p.defaultModel ?? p.models[0]?.id ?? "").trim();
    if (mid) return { provider: id, model: mid };
  }
  return undefined;
}
