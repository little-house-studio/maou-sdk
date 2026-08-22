/**
 * 产品路径：扩展注册供应商并写入 config / extension-providers.json。
 */

import {
  registerExtensionProviderRuntime,
  unregisterExtensionProviderRuntime,
  upsertPersistedExtensionProvider,
  removePersistedExtensionProvider,
  loadPersistedExtensionProviders,
  loginExtensionProvider as loginExtensionProviderRuntime,
  type ExtensionProviderInput,
  type APIPreset,
} from "@little-house-studio/llm";
import { loadPresetsFromMaouConfig, saveGlobalApiConfig } from "./presets.js";

export async function registerExtensionProvider(
  input: ExtensionProviderInput,
  opts?: { persist?: boolean; intoConfig?: boolean },
): Promise<APIPreset[]> {
  const presets = registerExtensionProviderRuntime(input);
  if (opts?.persist !== false) {
    upsertPersistedExtensionProvider(input);
  }
  if (opts?.intoConfig) {
    saveGlobalApiConfig({ presets, replace: false });
  }
  return presets;
}

export function unregisterExtensionProvider(
  name: string,
  opts?: { persist?: boolean },
): void {
  unregisterExtensionProviderRuntime(name);
  if (opts?.persist !== false) {
    removePersistedExtensionProvider(name);
  }
}

export async function loginExtensionProvider(
  name: string,
  interaction: {
    onAuth: (info: { url: string }) => void;
    onPrompt: (opts: { message: string; type?: "text" | "secret" }) => Promise<string>;
  },
  opts?: { intoConfig?: boolean },
): Promise<{ key: string; credentials: { access: string; refresh?: string; expires?: number } }> {
  const result = await loginExtensionProviderRuntime(name, interaction);
  const persisted = loadPersistedExtensionProviders().find((p) => p.name === name);
  if (persisted) {
    upsertPersistedExtensionProvider({ ...persisted, apiKey: result.key });
  }
  if (opts?.intoConfig) {
    const presets = loadPresetsFromMaouConfig();
    const updated = presets.map((p) =>
      p.name === name || String(p.name ?? "").startsWith(`${name}/`)
        ? { ...p, key: result.key }
        : p,
    );
    saveGlobalApiConfig({ presets: updated, replace: true });
  }
  return result;
}
