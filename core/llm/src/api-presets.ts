/**
 * 用户 API 名单：读写 ~/.maou/config.json 的 api.presets。
 *
 * 这是全系列产品的权威名单（可用 $MAOU_LLM_CONFIG 改路径）。
 * 厂商目录（有哪些模型可选用）走 registry / LLMConfig。
 *
 * 磁盘 SoT：api.presets[].models[]
 * 运行时 SoT：expand 后的扁平 APIPreset[]
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  resolveUserConfigPath,
  resolveUserMaouRoot,
  resolveApiRolePreset,
  expandAllPresets,
  collapsePresetsToNested,
  migratePresetsToNested,
  type ApiModelRole,
} from "@little-house-studio/types";
import type { APIPreset } from "./adapters/types.js";
import { loadPersistedExtensionPresets } from "./extension-providers.js";
import { normalizeApiPreset } from "./preset-normalize.js";

/** @deprecated 使用 resolveUserConfigPath；保留别名兼容旧 import */
export function resolveMaouConfigPath(): string {
  return resolveUserConfigPath();
}

function readApiPresetsArray(path: string): unknown[] {
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(readFileSync(path, "utf-8")) as {
      api?: { presets?: unknown[] };
    };
    const presets = data?.api?.presets;
    return Array.isArray(presets) ? presets : [];
  } catch {
    return [];
  }
}

function diskPresetsToNested(rawList: unknown[]): Array<Record<string, unknown>> {
  return migratePresetsToNested(rawList);
}

export function loadPresetsFromMaouConfig(configPath?: string): APIPreset[] {
  const path = configPath ?? resolveUserConfigPath();
  const raw = readApiPresetsArray(path);
  let fromFile: APIPreset[] = [];
  if (raw.length > 0) {
    try {
      const nested = diskPresetsToNested(raw);
      fromFile = expandAllPresets(nested).map((p) =>
        normalizeApiPreset(p as unknown as APIPreset),
      );
    } catch {
      fromFile = [];
    }
  }
  const fromExt = loadPersistedExtensionPresets(
    join(dirname(path), "extension-providers.json"),
  );
  if (fromExt.length === 0) return fromFile;
  const seen = new Set(fromFile.map((p) => String(p.name ?? p.model ?? "")));
  const extra = fromExt.filter((p) => !seen.has(String(p.name ?? p.model ?? "")));
  return [...fromFile, ...extra];
}

export function loadRawPresetsFromMaouConfig(
  configPath?: string,
): Array<Record<string, unknown>> {
  const path = configPath ?? resolveUserConfigPath();
  return diskPresetsToNested(readApiPresetsArray(path));
}

export function getApiPreset(
  name: string,
  configPath?: string,
): APIPreset | undefined {
  const presets = loadPresetsFromMaouConfig(configPath);
  return presets.find((p) => p.name === name || p.model === name);
}

export function getDefaultPresetFromMaouConfig(
  configPath?: string,
): APIPreset | undefined {
  const path = configPath ?? resolveUserConfigPath();
  const presets = loadPresetsFromMaouConfig(path);
  if (presets.length === 0) return undefined;
  try {
    if (existsSync(path)) {
      const data = JSON.parse(readFileSync(path, "utf-8")) as {
        api?: {
          defaultPreset?: number;
          helperPreset?: number;
          roles?: Record<string, string | number>;
        };
      };
      const api = {
        presets: presets as unknown as import("@little-house-studio/types").LLMPreset[],
        defaultPreset: data.api?.defaultPreset ?? 0,
        helperPreset: data.api?.helperPreset,
        roles: data.api?.roles,
      };
      const resolved = resolveApiRolePreset(api, "main");
      if (resolved) return resolved as unknown as APIPreset;
      const idx = data.api?.defaultPreset ?? 0;
      return presets[idx] ?? presets[0];
    }
  } catch {
    /* fallthrough */
  }
  return presets[0];
}

export function getRolePresetFromMaouConfig(
  role: ApiModelRole = "main",
  configPath?: string,
): APIPreset | undefined {
  const path = configPath ?? resolveUserConfigPath();
  const presets = loadPresetsFromMaouConfig(path);
  if (presets.length === 0) return undefined;
  try {
    if (!existsSync(path)) return presets[0];
    const data = JSON.parse(readFileSync(path, "utf-8")) as {
      api?: {
        defaultPreset?: number;
        helperPreset?: number;
        roles?: Record<string, string | number>;
      };
    };
    const api = {
      presets: presets as unknown as import("@little-house-studio/types").LLMPreset[],
      defaultPreset: data.api?.defaultPreset ?? 0,
      helperPreset: data.api?.helperPreset,
      roles: data.api?.roles,
    };
    return resolveApiRolePreset(api, role) as unknown as APIPreset | undefined;
  } catch {
    return presets[0];
  }
}

export function getDefaultPresetFromConfigStore(store: {
  get: () => {
    api?: {
      presets?: unknown[];
      defaultPreset?: number;
      helperPreset?: number;
      roles?:
        | Record<string, string | number | undefined>
        | {
            main?: string | number;
            fast?: string | number;
            vision?: string | number;
            helper?: string | number;
            [k: string]: string | number | undefined;
          };
    };
  };
}): Record<string, unknown> | undefined {
  try {
    const config = store.get();
    const api = config.api;
    const presets = (api?.presets ?? []) as Record<string, unknown>[];
    if (presets.length === 0) return undefined;
    try {
      const resolved = resolveApiRolePreset(
        {
          presets: presets as unknown as import("@little-house-studio/types").LLMPreset[],
          defaultPreset: api?.defaultPreset ?? 0,
          helperPreset: api?.helperPreset,
          roles: api?.roles as import("@little-house-studio/types").ApiModelRoles | undefined,
        },
        "main",
      );
      if (resolved) {
        return normalizeApiPreset(resolved as unknown as APIPreset) as unknown as Record<
          string,
          unknown
        >;
      }
    } catch {
      /* fallthrough */
    }
    const idx = api?.defaultPreset ?? 0;
    const raw = (presets[idx] ?? presets[0]) as Record<string, unknown> | undefined;
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
  presets: APIPreset[] | Array<Record<string, unknown>>;
  defaultPreset?: number;
  replace?: boolean;
  /** @deprecated 已忽略；落盘始终 nest 为 models[]。 */
  nest?: boolean;
  roles?: Record<string, string | number | undefined>;
  configPath?: string;
}

export function saveGlobalApiConfig(opts: GlobalApiWriteOptions): string {
  const path = opts.configPath?.trim() || resolveUserConfigPath();
  mkdirSync(dirname(path), { recursive: true });

  let raw: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      raw = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    } catch {
      raw = {};
    }
  }

  const apiPrev =
    raw.api && typeof raw.api === "object"
      ? (raw.api as Record<string, unknown>)
      : {};

  let incoming = opts.presets as unknown as Record<string, unknown>[];

  if (!opts.replace) {
    const prevList = Array.isArray(apiPrev.presets)
      ? diskPresetsToNested(apiPrev.presets as unknown[])
      : [];
    const prevFlat = expandAllPresets(prevList);
    const nextFlat = expandAllPresets(incoming);
    const byName = new Map<string, Record<string, unknown>>();
    for (const p of prevFlat) {
      const n = String(p.name ?? p.model ?? "");
      if (n) byName.set(n, p);
    }
    for (const p of nextFlat) {
      const n = String(p.name ?? p.model ?? "");
      if (n) byName.set(n, p);
    }
    incoming = [...byName.values()];
  } else {
    incoming = expandAllPresets(incoming);
  }

  const nextPresets = collapsePresetsToNested(incoming);

  const defaultPreset =
    opts.defaultPreset ??
    (typeof apiPrev.defaultPreset === "number" ? apiPrev.defaultPreset : 0);

  const prevRoles =
    apiPrev.roles && typeof apiPrev.roles === "object"
      ? { ...(apiPrev.roles as Record<string, unknown>) }
      : {};
  const nextRoles: Record<string, unknown> =
    opts.roles != null
      ? {
          ...prevRoles,
          ...Object.fromEntries(
            Object.entries(opts.roles).filter(
              ([, v]) => v !== undefined && v !== null && String(v).trim() !== "",
            ),
          ),
        }
      : prevRoles;

  if (
    nextRoles.helper == null &&
    typeof apiPrev.helperPreset === "number" &&
    Array.isArray(apiPrev.presets)
  ) {
    const expanded = expandAllPresets(diskPresetsToNested(apiPrev.presets as unknown[]));
    const hp = expanded[apiPrev.helperPreset as number];
    if (hp?.name) nextRoles.helper = String(hp.name);
  }

  const nextApi: Record<string, unknown> = {
    ...apiPrev,
    presets: nextPresets,
    defaultPreset: Math.min(defaultPreset, Math.max(0, nextPresets.length - 1)),
  };
  if (Object.keys(nextRoles).length > 0) {
    nextApi.roles = nextRoles;
  }
  if (nextRoles.helper != null) {
    delete nextApi.helperPreset;
  }
  raw.api = nextApi;

  writeFileSync(path, JSON.stringify(raw, null, 2), "utf-8");
  try {
    chmodSync(path, 0o600);
  } catch {
    /* ignore */
  }
  return path;
}

/** 按 name 合并写入一条（不丢其它 preset） */
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

/** 按 name 删除一条。找不到返回 false。 */
export function removeApiPreset(name: string, opts?: { configPath?: string }): boolean {
  const path = opts?.configPath ?? resolveUserConfigPath();
  const existing = loadPresetsFromMaouConfig(path);
  const next = existing.filter((p) => p.name !== name);
  if (next.length === existing.length) return false;

  saveGlobalApiConfig({
    presets: next,
    replace: true,
    configPath: path,
  });

  try {
    if (!existsSync(path)) return true;
    const data = JSON.parse(readFileSync(path, "utf-8")) as {
      api?: { roles?: Record<string, string | number> };
    };
    const roles = data.api?.roles;
    if (!roles) return true;
    let changed = false;
    for (const [k, v] of Object.entries(roles)) {
      if (String(v) === name) {
        delete roles[k];
        changed = true;
      }
    }
    if (changed) {
      writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
    }
  } catch {
    /* 名单已删，角色清扫失败不回滚 */
  }
  return true;
}

export function getGlobalMaouRoot(): string {
  return resolveUserMaouRoot();
}
