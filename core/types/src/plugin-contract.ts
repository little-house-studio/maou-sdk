/**
 * 磁盘插件合同。不接 Hub PluginBase。
 */

export type PluginPhase =
  | "declared"
  | "waiting_deps"
  | "loading"
  | "ready"
  | "failed"
  | "unloading"
  | "disabled";

export type PluginColorSet = {
  light: Record<string, string>;
  dark: Record<string, string>;
};

export type PluginManifest = {
  id: string;
  name?: string;
  version?: string;
  colors: PluginColorSet;
  host?: string;
  ui?: string;
  enabled?: boolean;
};

export type PluginRecord = {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  phase: PluginPhase;
  error?: string;
  dir: string;
  colors?: PluginColorSet;
  ui?: boolean;
};

export function pluginColorsOk(colors: unknown): colors is PluginColorSet {
  if (!colors || typeof colors !== "object") return false;
  const rec = colors as PluginColorSet;
  return Boolean(
    rec.light &&
      rec.dark &&
      typeof rec.light === "object" &&
      typeof rec.dark === "object" &&
      Object.keys(rec.light).length > 0 &&
      Object.keys(rec.dark).length > 0,
  );
}
