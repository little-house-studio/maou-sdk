/**
 * 全局 API 模型角色解析 —— 全系列产品共用。
 *
 * 新 SoT：api.providers + roles.{main,fast,…} = { provider, model }
 * 旧盘：presets[] + name/下标，由 coerceApiDocument 迁完后再走这里。
 * 运行时 ConfigStore 仍展开一份扁平 presets，供 findPresetByRef / helperModel。
 */

import type { ApiConfig, ApiModelRoles, LLMPreset } from "./index.js";
import {
  firstProviderModel,
  isApiRoleRef,
  parseRoleBinding,
  providersToRuntimePresets,
  resolveProviderModel,
  type ApiRoleRef,
} from "./api-providers.js";

export type ApiModelRole = "main" | "fast" | "vision" | "helper" | (string & {});

export type PresetRef = string | number | ApiRoleRef;

function runtimePresets(api: Pick<ApiConfig, "providers" | "presets">): LLMPreset[] {
  if (Array.isArray(api.presets) && api.presets.length > 0) return api.presets;
  const providers = api.providers ?? {};
  if (Object.keys(providers).length === 0) return [];
  return providersToRuntimePresets(providers) as unknown as LLMPreset[];
}

function bindingToPreset(
  api: Pick<ApiConfig, "providers" | "presets">,
  ref: ApiRoleRef,
): LLMPreset | undefined {
  const presets = runtimePresets(api);
  const fromFlat =
    presets.find(
      (p) =>
        (p as unknown as { _providerName?: string })._providerName === ref.provider &&
        p.model === ref.model,
    ) ??
    presets.find((p) => p.name === ref.provider && p.model === ref.model) ??
    presets.find((p) => p.name === `${ref.provider}/${ref.model}`) ??
    presets.find((p) => p.name === ref.provider);
  if (fromFlat) return fromFlat;
  const fromProvider = resolveProviderModel(api.providers ?? {}, ref.provider, ref.model);
  return fromProvider as unknown as LLMPreset | undefined;
}

function coerceRef(ref: unknown): PresetRef | undefined {
  if (ref === undefined || ref === null) return undefined;
  const parsed = parseRoleBinding(ref);
  if (parsed) return parsed;
  if (typeof ref === "number" || typeof ref === "string") return ref;
  return undefined;
}

/**
 * 按 ref 从（已展开的）presets 取一项。
 *   1. { provider, model }
 *   2. 数字下标（legacy）
 *   3. name 精确
 *   4. model id 精确
 *   5. provider 前缀
 *   6. provider/model 后缀
 */
export function findPresetByRef(
  presets: LLMPreset[],
  ref: PresetRef | undefined | null,
): LLMPreset | undefined {
  if (ref === undefined || ref === null) return undefined;
  if (isApiRoleRef(ref)) {
    return (
      presets.find(
        (p) =>
          (p as unknown as { _providerName?: string })._providerName === ref.provider &&
          p.model === ref.model,
      ) ??
      presets.find((p) => p.name === `${ref.provider}/${ref.model}`) ??
      presets.find((p) => p.name === ref.provider && p.model === ref.model) ??
      presets.find((p) => p.name === ref.provider)
    );
  }
  if (typeof ref === "number") {
    if (ref >= 0 && ref < presets.length) return presets[ref];
    return undefined;
  }
  const name = String(ref).trim();
  if (!name) return undefined;
  const byName = presets.find((p) => p.name === name);
  if (byName) return byName;
  const byModel = presets.find((p) => p.model === name);
  if (byModel) return byModel;
  const prefixHits = presets.filter(
    (p) => p.name === name || p.name.startsWith(`${name}/`),
  );
  if (prefixHits.length > 0) return prefixHits[0];
  if (name.includes("/")) {
    const mid = name.split("/").slice(1).join("/");
    return presets.find((p) => p.model === mid && p.name.endsWith(`/${mid}`));
  }
  return undefined;
}

function resolveRef(
  api: Pick<ApiConfig, "providers" | "presets" | "defaultPreset" | "helperPreset" | "roles">,
  ref: unknown,
): LLMPreset | undefined {
  const c = coerceRef(ref);
  if (c === undefined) return undefined;
  if (isApiRoleRef(c)) return bindingToPreset(api, c);
  return findPresetByRef(runtimePresets(api), c);
}

function mainFromConfig(
  api: Pick<ApiConfig, "providers" | "presets" | "defaultPreset" | "roles">,
): LLMPreset | undefined {
  const fromRole = resolveRef(api, api.roles?.main);
  if (fromRole) return fromRole;
  const first = firstProviderModel(api.providers ?? {});
  if (first) {
    const hit = bindingToPreset(api, first);
    if (hit) return hit;
  }
  const presets = runtimePresets(api);
  const idx = api.defaultPreset ?? 0;
  return presets[idx] ?? presets[0];
}

export function resolveGlobalHelperPreset(
  api: Pick<ApiConfig, "providers" | "presets" | "helperPreset" | "roles">,
): LLMPreset | undefined {
  const roles: ApiModelRoles = api.roles ?? {};
  return (
    resolveRef(api, roles.helper) ??
    (typeof api.helperPreset === "number"
      ? findPresetByRef(runtimePresets(api), api.helperPreset)
      : undefined) ??
    resolveRef(api, roles.fast)
  );
}

export function resolveApiRolePreset(
  api: Pick<ApiConfig, "providers" | "presets" | "defaultPreset" | "helperPreset" | "roles">,
  role: ApiModelRole = "main",
): LLMPreset | undefined {
  const presets = runtimePresets(api);
  if (presets.length === 0 && Object.keys(api.providers ?? {}).length === 0) {
    return undefined;
  }

  const roles: ApiModelRoles = api.roles ?? {};
  const main = mainFromConfig(api);

  if (role === "main") return main;

  if (role === "helper") {
    return resolveGlobalHelperPreset(api) ?? main;
  }

  if (role === "fast") {
    return (
      resolveRef(api, roles.fast) ??
      resolveRef(api, roles.helper) ??
      (typeof api.helperPreset === "number"
        ? findPresetByRef(presets, api.helperPreset)
        : undefined) ??
      main
    );
  }

  if (role === "vision") {
    const named = resolveRef(api, roles.vision);
    if (named) return named;
    const visionCapable = presets.find((p) => p.supportsVision);
    return visionCapable ?? main;
  }

  return resolveRef(api, roles[role]) ?? main;
}

export function listConfiguredApiRoles(
  api: Pick<ApiConfig, "providers" | "presets" | "defaultPreset" | "helperPreset" | "roles">,
): ApiModelRole[] {
  const roles: ApiModelRole[] = ["main"];
  const r = api.roles ?? {};
  if (r.fast !== undefined || api.helperPreset !== undefined) roles.push("fast");
  if (
    r.vision !== undefined ||
    runtimePresets(api).some((p) => p.supportsVision)
  ) {
    roles.push("vision");
  }
  if (r.helper !== undefined || api.helperPreset !== undefined) roles.push("helper");
  for (const k of Object.keys(r)) {
    if (!roles.includes(k as ApiModelRole) && k !== "main") {
      roles.push(k);
    }
  }
  return roles;
}
