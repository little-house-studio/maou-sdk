/**
 * 用户 API 名单：读写 ~/.maou/config.json 的 api.providers。
 *
 * 磁盘 SoT：api.providers + api.roles.{provider,model}
 * 运行时：展开为扁平 APIPreset[]（供 LLMClient）
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  resolveUserConfigPath,
  resolveUserMaouRoot,
  resolveApiRolePreset,
  migratePresetPlainKey,
  coerceApiDocument,
  apiDocumentForDisk,
  providersToRuntimePresets,
  resolveProviderModel,
  parseRoleBinding,
  isApiRoleRef,
  isKnownApiProtocol,
  type ApiModelRole,
  type ApiProvider,
  type ApiRoleRef,
  type CatalogHint,
} from "@little-house-studio/types";
import type { APIPreset } from "./adapters/types.js";
import { loadPersistedExtensionPresets } from "./extension-providers.js";
import { normalizeApiPreset } from "./preset-normalize.js";
import { getProviders } from "./registry/index.js";

/** @deprecated 使用 resolveUserConfigPath；保留别名兼容旧 import */
export function resolveMaouConfigPath(): string {
  return resolveUserConfigPath();
}

function userRootFromConfigPath(configPath: string): string {
  return dirname(configPath);
}

function catalogHints(): CatalogHint[] {
  try {
    return getProviders().map((p) => ({ id: p.id, baseUrl: p.baseUrl }));
  } catch {
    return [];
  }
}

function readRawFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeRawFile(path: string, raw: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(raw, null, 2), "utf-8");
  try {
    chmodSync(path, 0o600);
  } catch {
    /* ignore */
  }
}

function migrateProviderTree(p: ApiProvider, userRoot: string): boolean {
  const rec = p as unknown as Record<string, unknown>;
  let dirty = migratePresetPlainKey(rec, userRoot);
  if (Array.isArray(rec.models)) {
    for (const m of rec.models) {
      if (m && typeof m === "object" && migratePresetPlainKey(m as Record<string, unknown>, userRoot)) {
        dirty = true;
      }
    }
  }
  return dirty;
}

export interface LoadedApiDocument {
  path: string;
  providers: Record<string, ApiProvider>;
  roles: Record<string, ApiRoleRef>;
}

/** 共用读入口：迁旧盘、迁匣、回写。 */
export function loadApiDocument(configPath?: string): LoadedApiDocument {
  const path = configPath ?? resolveUserConfigPath();
  const raw = readRawFile(path);
  const prevApi =
    raw.api && typeof raw.api === "object" ? (raw.api as Record<string, unknown>) : {};
  const doc = coerceApiDocument(prevApi, { catalog: catalogHints() });
  const userRoot = userRootFromConfigPath(path);
  let dirty = doc.dirty;
  for (const p of Object.values(doc.providers)) {
    if (migrateProviderTree(p, userRoot)) dirty = true;
  }
  if (dirty && existsSync(path)) {
    raw.api = apiDocumentForDisk(prevApi, doc);
    try {
      writeRawFile(path, raw);
    } catch {
      /* 迁完回写失败不挡解析 */
    }
  }
  return { path, providers: doc.providers, roles: doc.roles };
}

function flattenNormalized(
  providers: Record<string, ApiProvider>,
  userRoot: string,
): APIPreset[] {
  return providersToRuntimePresets(providers).map((p) =>
    normalizeApiPreset(p as unknown as APIPreset, { userRoot }),
  );
}

function mergeExtensionProviders(
  providers: Record<string, ApiProvider>,
  configPath: string,
): Record<string, ApiProvider> {
  const fromExt = loadPersistedExtensionPresets(
    join(dirname(configPath), "extension-providers.json"),
  );
  if (fromExt.length === 0) return providers;
  const next = { ...providers };
  for (const p of fromExt) {
    const id = String(
      (p as { _providerName?: string })._providerName ?? p.name ?? p.model ?? "",
    ).trim();
    if (!id || next[id]) continue;
    next[id] = {
      displayName: id,
      protocol: String(p.protocol ?? "openai"),
      url: String(p.url ?? ""),
      key: p.key,
      models: [{ id: String(p.model ?? id) }],
      defaultModel: String(p.model ?? id),
    };
  }
  return next;
}

export function loadProvidersFromMaouConfig(
  configPath?: string,
): Record<string, ApiProvider> {
  const doc = loadApiDocument(configPath);
  return mergeExtensionProviders(doc.providers, doc.path);
}

export function loadPresetsFromMaouConfig(configPath?: string): APIPreset[] {
  const doc = loadApiDocument(configPath);
  const providers = mergeExtensionProviders(doc.providers, doc.path);
  return flattenNormalized(providers, userRootFromConfigPath(doc.path));
}

export function loadRawPresetsFromMaouConfig(
  configPath?: string,
): Array<Record<string, unknown>> {
  const providers = loadProvidersFromMaouConfig(configPath);
  return Object.entries(providers).map(([id, p]) => ({
    name: p.displayName ?? id,
    ...p,
  }));
}

export function getApiPreset(
  name: string,
  configPath?: string,
): APIPreset | undefined {
  const providers = loadProvidersFromMaouConfig(configPath);
  const binding = parseRoleBinding(name);
  if (binding) {
    const hit = resolveProviderModel(providers, binding.provider, binding.model);
    if (hit) {
      return normalizeApiPreset(hit as unknown as APIPreset, {
        userRoot: userRootFromConfigPath(configPath ?? resolveUserConfigPath()),
      });
    }
  }
  if (providers[name]) {
    const hit = resolveProviderModel(providers, name);
    if (hit) {
      return normalizeApiPreset(hit as unknown as APIPreset, {
        userRoot: userRootFromConfigPath(configPath ?? resolveUserConfigPath()),
      });
    }
  }
  const presets = loadPresetsFromMaouConfig(configPath);
  return presets.find((p) => p.name === name || p.model === name);
}

function roleApiFromDoc(
  doc: LoadedApiDocument,
  presets: APIPreset[],
): Parameters<typeof resolveApiRolePreset>[0] {
  return {
    providers: doc.providers,
    presets: presets as unknown as import("@little-house-studio/types").LLMPreset[],
    roles: doc.roles,
  };
}

export function getDefaultPresetFromMaouConfig(
  configPath?: string,
): APIPreset | undefined {
  const doc = loadApiDocument(configPath);
  const presets = flattenNormalized(doc.providers, userRootFromConfigPath(doc.path));
  if (presets.length === 0) return undefined;
  const resolved = resolveApiRolePreset(roleApiFromDoc(doc, presets), "main");
  return (resolved as unknown as APIPreset | undefined) ?? presets[0];
}

export function getRolePresetFromMaouConfig(
  role: ApiModelRole = "main",
  configPath?: string,
): APIPreset | undefined {
  const doc = loadApiDocument(configPath);
  const presets = flattenNormalized(doc.providers, userRootFromConfigPath(doc.path));
  if (presets.length === 0) return undefined;
  return resolveApiRolePreset(roleApiFromDoc(doc, presets), role) as unknown as
    | APIPreset
    | undefined;
}

export function getDefaultPresetFromConfigStore(store: {
  get: () => {
    api?: {
      providers?: Record<string, ApiProvider>;
      presets?: unknown[];
      defaultPreset?: number;
      helperPreset?: number;
      roles?: import("@little-house-studio/types").ApiModelRoles;
    };
  };
}): Record<string, unknown> | undefined {
  try {
    const api = store.get().api;
    if (!api) return undefined;
    const resolved = resolveApiRolePreset(
      {
        providers: api.providers ?? {},
        presets: (api.presets ?? []) as import("@little-house-studio/types").LLMPreset[],
        defaultPreset: api.defaultPreset,
        helperPreset: api.helperPreset,
        roles: api.roles,
      },
      "main",
    );
    if (resolved) {
      return normalizeApiPreset(resolved as unknown as APIPreset) as unknown as Record<
        string,
        unknown
      >;
    }
    const presets = (api.presets ?? []) as Record<string, unknown>[];
    const raw = presets[0];
    return raw ? (normalizeApiPreset(raw) as unknown as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

export function isGlobalApiConfigured(configPath?: string): boolean {
  if (process.env.MAOU_API_KEY?.trim()) return true;
  if (process.env.OPENAI_API_KEY?.trim()) return true;
  if (process.env.ANTHROPIC_API_KEY?.trim()) return true;
  if (process.env.MAOU_SKIP_API_SETUP === "1") return true;

  const presets = loadPresetsFromMaouConfig(configPath);
  return presets.some((p) => typeof p.key === "string" && p.key.trim().length > 0);
}

export interface GlobalApiWriteOptions {
  providers?: Record<string, ApiProvider>;
  /** @deprecated 仍接受扁平项，写入时收成 providers */
  presets?: APIPreset[] | Array<Record<string, unknown>>;
  roles?: Record<string, ApiRoleRef | string | number | undefined>;
  replace?: boolean;
  configPath?: string;
  /** @deprecated 忽略 */
  defaultPreset?: number;
  /** @deprecated 忽略 */
  nest?: boolean;
}

function normalizeIncomingRoles(
  roles: GlobalApiWriteOptions["roles"],
  providers: Record<string, ApiProvider>,
): Record<string, ApiRoleRef> {
  const out: Record<string, ApiRoleRef> = {};
  if (!roles) return out;
  for (const [k, v] of Object.entries(roles)) {
    if (v === undefined || v === null || v === "") continue;
    if (isApiRoleRef(v)) {
      out[k] = { provider: v.provider.trim(), model: String(v.model ?? "").trim() };
      continue;
    }
    const parsed = parseRoleBinding(v);
    if (parsed && providers[parsed.provider]) {
      out[k] = {
        provider: parsed.provider,
        model:
          parsed.model ||
          String(providers[parsed.provider]!.defaultModel ?? providers[parsed.provider]!.models[0]?.id ?? ""),
      };
      continue;
    }
    const name = String(v).trim();
    if (providers[name]) {
      const p = providers[name]!;
      out[k] = {
        provider: name,
        model: String(p.defaultModel ?? p.models[0]?.id ?? ""),
      };
      continue;
    }
    for (const [id, p] of Object.entries(providers)) {
      if (p.models.some((m) => m.id === name || m.name === name)) {
        out[k] = { provider: id, model: name };
        break;
      }
    }
  }
  return out;
}

function assertProvidersProtocols(providers: Record<string, ApiProvider>): void {
  for (const [id, p] of Object.entries(providers)) {
    const proto = String(p.protocol ?? "openai").trim() || "openai";
    if (!isKnownApiProtocol(proto) && proto !== "openai-responses") {
      throw new Error(`厂商 "${id}" 的协议 "${proto}" 未知`);
    }
    if (!String(p.url ?? "").trim()) {
      throw new Error(`厂商 "${id}" 需要 url`);
    }
    if (!p.models?.length || p.models.every((m) => !String(m.id ?? "").trim())) {
      throw new Error(`厂商 "${id}" 至少需要一个 model id`);
    }
  }
}

function flatToProviders(
  flats: Array<Record<string, unknown>>,
): Record<string, ApiProvider> {
  return coerceApiDocument({ presets: flats }, { catalog: catalogHints() }).providers;
}

export function saveGlobalApiConfig(opts: GlobalApiWriteOptions): string {
  const path = opts.configPath?.trim() || resolveUserConfigPath();
  const raw = readRawFile(path);
  const apiPrev =
    raw.api && typeof raw.api === "object"
      ? (raw.api as Record<string, unknown>)
      : {};
  const prevDoc = coerceApiDocument(apiPrev, { catalog: catalogHints() });

  let providers: Record<string, ApiProvider>;
  if (opts.providers && Object.keys(opts.providers).length > 0) {
    providers = opts.replace
      ? { ...opts.providers }
      : { ...prevDoc.providers, ...opts.providers };
  } else if (opts.presets) {
    const incoming = flatToProviders(opts.presets as Array<Record<string, unknown>>);
    providers = opts.replace ? incoming : { ...prevDoc.providers, ...incoming };
  } else {
    providers = { ...prevDoc.providers };
  }

  const userRoot = userRootFromConfigPath(path);
  for (const p of Object.values(providers)) {
    migrateProviderTree(p, userRoot);
  }
  assertProvidersProtocols(providers);

  const prevRoles = { ...prevDoc.roles };
  const incomingRoles = normalizeIncomingRoles(opts.roles, providers);
  const roles = opts.roles != null ? { ...prevRoles, ...incomingRoles } : prevRoles;
  for (const [k, v] of Object.entries(roles)) {
    if (!providers[v.provider]) delete roles[k];
  }

  raw.api = apiDocumentForDisk(apiPrev, { providers, roles, dirty: true });
  writeRawFile(path, raw);
  return path;
}

/** 按路由 id 或 runtime name 合并一条 */
export function upsertApiPreset(
  preset: APIPreset | Record<string, unknown>,
  opts?: { configPath?: string; roles?: GlobalApiWriteOptions["roles"] },
): string {
  return saveGlobalApiConfig({
    presets: [preset],
    replace: false,
    configPath: opts?.configPath,
    roles: opts?.roles,
  });
}

/** 按路由 id 或 runtime name 删除。找不到返回 false。 */
export function removeApiPreset(name: string, opts?: { configPath?: string }): boolean {
  const path = opts?.configPath ?? resolveUserConfigPath();
  const doc = loadApiDocument(path);
  const key = name.trim();
  let next = { ...doc.providers };
  if (next[key]) {
    delete next[key];
  } else {
    const binding = parseRoleBinding(key);
    if (binding && next[binding.provider]) {
      const p = next[binding.provider]!;
      const models = p.models.filter((m) => m.id !== binding.model);
      if (models.length === 0) delete next[binding.provider];
      else next[binding.provider] = { ...p, models };
    } else {
      const flats = providersToRuntimePresets(doc.providers);
      const hit = flats.find((p) => String(p.name ?? "") === key);
      const pid = String(hit?._providerName ?? "");
      if (!pid || !next[pid]) return false;
      if ((next[pid]!.models?.length ?? 0) <= 1) delete next[pid];
      else {
        const mid = String(hit?.model ?? "");
        next[pid] = {
          ...next[pid]!,
          models: next[pid]!.models.filter((m) => m.id !== mid),
        };
      }
    }
  }

  const roles = { ...doc.roles };
  for (const [k, v] of Object.entries(roles)) {
    if (!next[v.provider]) delete roles[k];
  }

  saveGlobalApiConfig({
    providers: next,
    roles,
    replace: true,
    configPath: path,
  });
  return true;
}

export function getGlobalMaouRoot(): string {
  return resolveUserMaouRoot();
}
