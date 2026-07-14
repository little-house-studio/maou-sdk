/**
 * 从全局用户态 config.json 读取 api.presets。
 * 全系列产品共用：CLI / coding-agent / harness / 其它 agent。
 *
 * 路径：resolveUserConfigPath()（$MAOU_LLM_CONFIG 或 $MAOU_HOME/config.json 或 ~/.maou/config.json）
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import {
  resolveUserConfigPath,
  resolveUserMaouRoot,
  resolveApiRolePreset,
  type ApiModelRole,
} from "@little-house-studio/types";
import type { APIPreset } from "@little-house-studio/llm";

/** @deprecated 使用 resolveUserConfigPath；保留别名兼容旧 import */
export function resolveMaouConfigPath(): string {
  return resolveUserConfigPath();
}

/** 读取全部 presets（过滤非法项） */
export function loadPresetsFromMaouConfig(configPath?: string): APIPreset[] {
  const path = configPath ?? resolveUserConfigPath();
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(readFileSync(path, "utf-8")) as {
      api?: { presets?: unknown[]; defaultPreset?: number };
      presets?: unknown[];
    };
    const presets = (data?.api?.presets ?? data?.presets ?? []) as unknown[];
    return presets.filter(
      (p): p is APIPreset =>
        !!p && typeof p === "object" && ("name" in p || "model" in p),
    );
  } catch {
    return [];
  }
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
          presets?: unknown[];
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
    api?: { presets?: unknown[]; defaultPreset?: number };
  };
}): Record<string, unknown> | undefined {
  try {
    const config = store.get();
    const presets = (config.api?.presets ?? []) as Record<string, unknown>[];
    const idx = config.api?.defaultPreset ?? 0;
    return (presets[idx] ?? presets[0]) as Record<string, unknown> | undefined;
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
  /** 完整替换 presets；默认与现有合并（按 name 覆盖） */
  presets: APIPreset[];
  defaultPreset?: number;
  /** true 时丢弃文件里旧 presets */
  replace?: boolean;
}

/**
 * 写入/合并全局 API 配置（全系列产品共用的 config.json）。
 * 保留 security / ui 等其它段。
 */
export function saveGlobalApiConfig(opts: GlobalApiWriteOptions): string {
  const path = resolveUserConfigPath();
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

  let nextPresets = opts.presets as unknown as Record<string, unknown>[];
  if (!opts.replace) {
    const prevList = Array.isArray(apiPrev.presets)
      ? (apiPrev.presets as Record<string, unknown>[])
      : [];
    const byName = new Map<string, Record<string, unknown>>();
    for (const p of prevList) {
      const n = String(p.name ?? p.model ?? "");
      if (n) byName.set(n, p);
    }
    for (const p of opts.presets) {
      const n = String(p.name ?? p.model ?? "");
      if (n) byName.set(n, p as unknown as Record<string, unknown>);
    }
    nextPresets = [...byName.values()];
  }

  const defaultPreset =
    opts.defaultPreset ??
    (typeof apiPrev.defaultPreset === "number" ? apiPrev.defaultPreset : 0);

  raw.api = {
    ...apiPrev,
    presets: nextPresets,
    defaultPreset: Math.min(defaultPreset, Math.max(0, nextPresets.length - 1)),
  };

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
