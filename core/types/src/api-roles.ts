/**
 * 全局 API 模型角色解析 —— 全系列产品共用。
 *
 * config.api.roles 将用途绑定到 presets（name 或下标）。
 * 未配置时回退 defaultPreset / helperPreset / main。
 */

import type { ApiConfig, ApiModelRoles, LLMPreset } from "./index.js";

export type ApiModelRole = "main" | "fast" | "vision" | "helper" | (string & {});

export type PresetRef = string | number;

/** 按 name 或下标从 presets 取一项 */
export function findPresetByRef(
  presets: LLMPreset[],
  ref: PresetRef | undefined | null,
): LLMPreset | undefined {
  if (ref === undefined || ref === null) return undefined;
  if (typeof ref === "number") {
    if (ref >= 0 && ref < presets.length) return presets[ref];
    return undefined;
  }
  const name = String(ref).trim();
  if (!name) return undefined;
  return (
    presets.find((p) => p.name === name) ??
    presets.find((p) => p.model === name)
  );
}

function mainFromConfig(api: Pick<ApiConfig, "presets" | "defaultPreset" | "roles">): LLMPreset | undefined {
  const presets = api.presets ?? [];
  if (presets.length === 0) return undefined;
  const fromRole = findPresetByRef(presets, api.roles?.main);
  if (fromRole) return fromRole;
  const idx = api.defaultPreset ?? 0;
  return presets[idx] ?? presets[0];
}

/**
 * 解析某角色对应的 preset。
 *
 * 回退链：
 *   main   → roles.main → defaultPreset → presets[0]
 *   helper → roles.helper → helperPreset → roles.fast → main
 *   fast   → roles.fast → helper → main
 *   vision → roles.vision → main（且调用方宜再查 supportsVision）
 *   其它   → roles[role] → main
 */
export function resolveApiRolePreset(
  api: Pick<ApiConfig, "presets" | "defaultPreset" | "helperPreset" | "roles">,
  role: ApiModelRole = "main",
): LLMPreset | undefined {
  const presets = api.presets ?? [];
  if (presets.length === 0) return undefined;

  const roles: ApiModelRoles = api.roles ?? {};
  const main = mainFromConfig(api);

  if (role === "main") return main;

  if (role === "helper") {
    return (
      findPresetByRef(presets, roles.helper) ??
      (typeof api.helperPreset === "number"
        ? findPresetByRef(presets, api.helperPreset)
        : undefined) ??
      findPresetByRef(presets, roles.fast) ??
      main
    );
  }

  if (role === "fast") {
    return (
      findPresetByRef(presets, roles.fast) ??
      findPresetByRef(presets, roles.helper) ??
      (typeof api.helperPreset === "number"
        ? findPresetByRef(presets, api.helperPreset)
        : undefined) ??
      main
    );
  }

  if (role === "vision") {
    const named = findPresetByRef(presets, roles.vision);
    if (named) return named;
    // 未指定 vision：优先 presets 里声明 supportsVision 的第一项，否则 main
    const visionCapable = presets.find((p) => p.supportsVision);
    return visionCapable ?? main;
  }

  // 自定义角色
  return findPresetByRef(presets, roles[role]) ?? main;
}

/** 是否至少配置了可用主模型（有 key 由调用方再判） */
export function listConfiguredApiRoles(
  api: Pick<ApiConfig, "presets" | "defaultPreset" | "helperPreset" | "roles">,
): ApiModelRole[] {
  const roles: ApiModelRole[] = ["main"];
  const r = api.roles ?? {};
  if (r.fast !== undefined || api.helperPreset !== undefined) roles.push("fast");
  if (r.vision !== undefined || (api.presets ?? []).some((p) => p.supportsVision)) {
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
