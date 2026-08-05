/**
 * 从全局用户态 config.json 读取 api.presets。
 * 全系列产品共用：CLI / coding-agent / harness / 其它 agent。
 *
 * 路径：resolveUserConfigPath()（$MAOU_LLM_CONFIG 或 $MAOU_HOME/config.json 或 ~/.maou/config.json）
 *
 * 磁盘 SoT：api.presets[].models[]（至少一项）
 * 运行时 SoT：expand 后的扁平 APIPreset[]（每项一个 model）
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import {
  resolveUserConfigPath,
  resolveUserMaouRoot,
  resolveApiRolePreset,
  expandAllPresets,
  collapsePresetsToNested,
  migratePresetsToNested,
  type ApiModelRole,
} from "@little-house-studio/types";
import {
  normalizeApiPreset,
  type APIPreset,
} from "@little-house-studio/llm";

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

/**
 * 磁盘 presets → 嵌套 models[]（内存迁移，不写盘）。
 * 已是 models[] 的条目原样；旧扁平（仅顶层 model）迁成 models[]。
 */
function diskPresetsToNested(rawList: unknown[]): Array<Record<string, unknown>> {
  return migratePresetsToNested(rawList);
}

/**
 * 读取全部 presets（过滤非法项，展开 models[]，规范化 pricing/extraBody）。
 * 返回**扁平** APIPreset[]（每项一个 model），供 runtime / roles 使用。
 *
 * 与 ConfigStore 对齐：磁盘以 models[] 为准；旧扁平在内存 migrate 后再 expand。
 */
export function loadPresetsFromMaouConfig(configPath?: string): APIPreset[] {
  const path = configPath ?? resolveUserConfigPath();
  const raw = readApiPresetsArray(path);
  if (raw.length === 0) return [];
  try {
    const nested = diskPresetsToNested(raw);
    return expandAllPresets(nested).map((p) =>
      normalizeApiPreset(p as unknown as APIPreset),
    );
  } catch {
    return [];
  }
}

/**
 * 读取磁盘原始 presets（**不**展开 models[]），供 WebUI 编辑厂商/模型树。
 * 返回前会做内存 migrate，保证每项含 models[]。
 */
export function loadRawPresetsFromMaouConfig(
  configPath?: string,
): Array<Record<string, unknown>> {
  const path = configPath ?? resolveUserConfigPath();
  return diskPresetsToNested(readApiPresetsArray(path));
}

/** defaultPreset / roles.main 对应的主模型 preset，否则第一个 */
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

/**
 * 按角色取全局 preset（main / fast / vision / helper / 自定义）。
 * 全系列产品应走此函数，避免各写一套。
 */
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

/** 从 ConfigStore 形状取 default preset（harness / Runtime 已有 store 时用） */
export function getDefaultPresetFromConfigStore(store: {
  get: () => {
    api?: {
      presets?: unknown[];
      defaultPreset?: number;
      helperPreset?: number;
      roles?: Record<string, string | number | undefined> | {
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

/**
 * 是否已配置可用的全局 API。
 * 任一 preset 有非空 key，或常见环境变量有值 → true。
 */
export function isGlobalApiConfigured(configPath?: string): boolean {
  if (process.env.MAOU_API_KEY?.trim()) return true;
  if (process.env.OPENAI_API_KEY?.trim()) return true;
  if (process.env.ANTHROPIC_API_KEY?.trim()) return true;
  if (process.env.MAOU_SKIP_API_SETUP === "1") return true;

  const presets = loadPresetsFromMaouConfig(configPath);
  return presets.some(
    (p) => typeof p.key === "string" && p.key.trim().length > 0,
  );
}

export interface GlobalApiWriteOptions {
  /**
   * presets：扁平运行时（一 model 一项）或磁盘嵌套（含 models[]）。
   * 落盘前一律折叠为「厂商 + models[]」。
   */
  presets: APIPreset[] | Array<Record<string, unknown>>;
  defaultPreset?: number;
  /** true 时丢弃文件里旧 presets */
  replace?: boolean;
  /**
   * @deprecated 已忽略；落盘始终 nest 为 models[]。
   */
  nest?: boolean;
  /**
   * Agent 层角色绑定：main / fast / vision / helper → preset name 或下标。
   * 传入则写入 api.roles（覆盖同名字段）。
   */
  roles?: Record<string, string | number | undefined>;
  /**
   * 目标 config.json 路径（测试 / 多配置隔离）。
   * 缺省：resolveUserConfigPath()（$MAOU_LLM_CONFIG / ~/.maou/config.json）。
   */
  configPath?: string;
}

/**
 * 写入/合并全局 API 配置（全系列产品共用的 config.json）。
 * 保留 security / ui 等其它段。
 * 始终以「厂商 preset + models[]」嵌套格式落盘。
 *
 * 若磁盘仅有 legacy helperPreset、无 roles.helper，则提升为 roles.helper（name）。
 */
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

  // 合并：先规范为运行时扁平，再按 runtime name 覆盖，最后 collapse
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

  // defaultPreset：磁盘厂商数组下标；roles 优先用 name
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

  // legacy helperPreset → roles.helper（name）；读路径仍认 helperPreset，写路径尽量收敛到 roles
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
    defaultPreset: Math.min(
      defaultPreset,
      Math.max(0, nextPresets.length - 1),
    ),
  };
  if (Object.keys(nextRoles).length > 0) {
    nextApi.roles = nextRoles;
  }
  // 写路径收敛：已提升到 roles.helper 后不再保留 legacy helperPreset
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

export function getGlobalMaouRoot(): string {
  return resolveUserMaouRoot();
}
