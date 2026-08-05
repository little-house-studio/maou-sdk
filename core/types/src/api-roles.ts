/**
 * 全局 API 模型角色解析 —— 全系列产品共用。
 *
 * 分层（勿混）：
 * - 全局：config.api.roles + legacy helperPreset/defaultPreset
 * - Agent 覆盖：agent.json helperModel（见 llm.resolveHelperPreset，不在此文件）
 * - 磁盘 nested models[] vs 运行时扁平：调用方先 expand，再对本模块传入扁平 presets
 *
 * 统一规则：
 * - ref 解析只走 findPresetByRef（name / 下标 / model / provider 前缀）
 * - 全局 helper 链只实现一次（resolveGlobalHelperPreset）
 */

import type { ApiConfig, ApiModelRoles, LLMPreset } from "./index.js";

export type ApiModelRole = "main" | "fast" | "vision" | "helper" | (string & {});

export type PresetRef = string | number;

/**
 * 按 ref 从（已展开的）presets 取一项。
 * 顺序固定（全产品唯一）：
 *   1. 数字下标（legacy）
 *   2. name 精确
 *   3. model id 精确
 *   4. provider 前缀（roles 写 "ds-flash" → 匹配 ds-flash 或 ds-flash/...）
 *   5. provider/model 后缀
 */
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
  // 精确 name
  const byName = presets.find((p) => p.name === name);
  if (byName) return byName;
  // model id
  const byModel = presets.find((p) => p.model === name);
  if (byModel) return byModel;
  // provider 前缀：roles.main = "ds-flash" → 匹配 name === ds-flash 或 name 以 ds-flash/ 开头的第一项
  const prefixHits = presets.filter(
    (p) => p.name === name || p.name.startsWith(`${name}/`),
  );
  if (prefixHits.length > 0) return prefixHits[0];
  // provider/model 后缀匹配
  if (name.includes("/")) {
    const mid = name.split("/").slice(1).join("/");
    return presets.find((p) => p.model === mid && p.name.endsWith(`/${mid}`));
  }
  return undefined;
}

function mainFromConfig(
  api: Pick<ApiConfig, "presets" | "defaultPreset" | "roles">,
): LLMPreset | undefined {
  const presets = api.presets ?? [];
  if (presets.length === 0) return undefined;
  const fromRole = findPresetByRef(presets, api.roles?.main);
  if (fromRole) return fromRole;
  const idx = api.defaultPreset ?? 0;
  return presets[idx] ?? presets[0];
}

/**
 * 全局 helper 链（不含 agent 覆盖、不含最终 main 回退）。
 *
 *   roles.helper → helperPreset（legacy 下标）→ roles.fast
 *
 * agent.helperModel 与 mainPreset 硬回退由 resolveHelperPreset（llm）叠加。
 */
export function resolveGlobalHelperPreset(
  api: Pick<ApiConfig, "presets" | "helperPreset" | "roles">,
): LLMPreset | undefined {
  const presets = api.presets ?? [];
  if (presets.length === 0) return undefined;
  const roles: ApiModelRoles = api.roles ?? {};
  return (
    findPresetByRef(presets, roles.helper) ??
    (typeof api.helperPreset === "number"
      ? findPresetByRef(presets, api.helperPreset)
      : undefined) ??
    findPresetByRef(presets, roles.fast)
  );
}

/**
 * 解析某角色对应的 preset（全局配置，无 agent 覆盖）。
 *
 * 回退链（唯一实现）：
 *   main   → roles.main → defaultPreset → presets[0]
 *   helper → resolveGlobalHelperPreset → main
 *   fast   → roles.fast → resolveGlobalHelperPreset 的 helper/helperPreset 部分
 *            → 即 roles.fast → roles.helper → helperPreset → main
 *   vision → roles.vision → 首个 supportsVision → main
 *            （vision 不走 fast；语义不同，勿与 helper 合并）
 *   其它   → roles[role] → main
 *
 * 推荐 roles 绑 runtime name；下标 / model id 为 legacy，findPresetByRef 仍支持。
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
    return resolveGlobalHelperPreset(api) ?? main;
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
    // 未指定 vision：优先 supportsVision 的第一项，否则 main（旧逻辑可取，单独保留）
    const visionCapable = presets.find((p) => p.supportsVision);
    return visionCapable ?? main;
  }

  // 自定义角色
  return findPresetByRef(presets, roles[role]) ?? main;
}

/** 列出已配置的角色名（有 key 由调用方再判） */
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
