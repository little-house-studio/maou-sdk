/**
 * 磁盘插件热装：~/.maou/plugins 与项目 .maou/plugins。
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  pluginColorsOk,
  registerToolCardPreset,
  resolveUserMaouRoot,
  type PluginManifest,
  type PluginPhase,
  type PluginRecord,
} from "@little-house-studio/types";

type Loaded = {
  record: PluginRecord;
  unload?: () => void | Promise<void>;
  dropPresets: Array<() => void>;
  uiFile?: string;
};

const loaded = new Map<string, Loaded>();

function scanDir(dir: string): Array<{ dir: string; manifest: PluginManifest }> {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const out: Array<{ dir: string; manifest: PluginManifest }> = [];
  for (const name of readdirSync(dir)) {
    const root = join(dir, name);
    const file = join(root, "plugin.json");
    if (!existsSync(file)) continue;
    try {
      const raw = JSON.parse(readFileSync(file, "utf-8")) as PluginManifest;
      if (!raw || typeof raw.id !== "string" || !raw.id.trim()) continue;
      out.push({ dir: root, manifest: raw });
    } catch {
      out.push({
        dir: root,
        manifest: { id: name, colors: { light: {}, dark: {} } },
      });
    }
  }
  return out;
}

function enabledMap(cfg?: { plugins?: Record<string, { enabled?: boolean }> }): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [id, row] of Object.entries(cfg?.plugins ?? {})) {
    out[id] = row?.enabled !== false;
  }
  return out;
}

export async function loadDiskPlugins(opts: {
  projectRoot: string;
  pluginSettings?: { plugins?: Record<string, { enabled?: boolean }> };
}): Promise<PluginRecord[]> {
  await unloadDiskPlugins();
  const enabled = enabledMap(opts.pluginSettings);
  const found = [
    ...scanDir(join(resolveUserMaouRoot(), "plugins")),
    ...scanDir(join(opts.projectRoot, ".maou", "plugins")),
  ];
  const records: PluginRecord[] = [];
  for (const row of found) {
    const id = row.manifest.id.trim();
    const on = enabled[id] ?? row.manifest.enabled ?? true;
    let phase: PluginPhase = on ? "declared" : "disabled";
    let error: string | undefined;
    const dropPresets: Array<() => void> = [];
    let unload: (() => void | Promise<void>) | undefined;
    if (!pluginColorsOk(row.manifest.colors)) {
      phase = "failed";
      error = "必须同时登记浅色和深色";
    } else if (on) {
      phase = "loading";
      try {
        if (row.manifest.host) {
          const href = pathToFileURL(resolve(row.dir, row.manifest.host)).href;
          const mod = (await import(href)) as {
            onLoad?: () => void | Promise<void>;
            onUnload?: () => void | Promise<void>;
            toolCardPresets?: Array<{
              id: string;
              match: { names?: string[]; prefix?: string };
              dress: "read" | "edit" | "search" | "web" | "todo" | "terminal" | "generic";
            }>;
          };
          await mod.onLoad?.();
          unload = mod.onUnload;
          for (const preset of mod.toolCardPresets ?? []) {
            dropPresets.push(registerToolCardPreset(preset));
          }
        }
        phase = "ready";
      } catch (err) {
        phase = "failed";
        error = err instanceof Error ? err.message : String(err);
      }
    }
    const uiRel = row.manifest.ui?.trim();
    const uiFile = uiRel ? resolve(row.dir, uiRel) : undefined;
    const record: PluginRecord = {
      id,
      name: row.manifest.name || id,
      version: row.manifest.version || "0",
      enabled: on,
      phase,
      dir: row.dir,
      ...(error ? { error } : {}),
      ...(pluginColorsOk(row.manifest.colors) ? { colors: row.manifest.colors } : {}),
      ...(uiFile && existsSync(uiFile) ? { ui: true } : {}),
    };
    loaded.set(id, { record, unload, dropPresets, uiFile });
    records.push(record);
  }
  return records;
}

export function listDiskPlugins(): PluginRecord[] {
  return [...loaded.values()].map((row) => row.record);
}

export async function unloadDiskPlugins(): Promise<void> {
  for (const [id, row] of loaded) {
    row.record.phase = "unloading";
    for (const off of row.dropPresets) off();
    try {
      await row.unload?.();
    } catch {
      /* ignore */
    }
    loaded.delete(id);
  }
}

export function pluginThemeVars(resolved: "light" | "dark"): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const row of loaded.values()) {
    if (row.record.phase !== "ready") continue;
    const set = row.record.colors?.[resolved];
    if (!set) continue;
    Object.assign(vars, set);
  }
  return vars;
}

export function pluginUiFile(id: string): string | undefined {
  const row = loaded.get(id);
  if (!row || row.record.phase !== "ready") return undefined;
  return row.uiFile;
}
