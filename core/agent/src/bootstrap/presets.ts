/**
 * 从全局 ~/.maou/config.json（或 MAOU_LLM_CONFIG）读取 api.presets。
 * CLI / coding-agent / harness 共用，避免各写一套。
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { APIPreset } from "@little-house-studio/llm";

export function resolveMaouConfigPath(): string {
  return process.env.MAOU_LLM_CONFIG ?? join(homedir(), ".maou", "config.json");
}

/** 读取全部 presets（过滤非法项） */
export function loadPresetsFromMaouConfig(configPath?: string): APIPreset[] {
  const path = configPath ?? resolveMaouConfigPath();
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

/** defaultPreset 索引对应的 preset，否则第一个 */
export function getDefaultPresetFromMaouConfig(
  configPath?: string,
): APIPreset | undefined {
  const path = configPath ?? resolveMaouConfigPath();
  const presets = loadPresetsFromMaouConfig(path);
  if (presets.length === 0) return undefined;
  try {
    if (existsSync(path)) {
      const data = JSON.parse(readFileSync(path, "utf-8")) as {
        api?: { defaultPreset?: number };
      };
      const idx = data.api?.defaultPreset ?? 0;
      return presets[idx] ?? presets[0];
    }
  } catch {
    /* fallthrough */
  }
  return presets[0];
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
