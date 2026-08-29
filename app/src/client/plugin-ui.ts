import { registerToolCardPreset } from "@little-house-studio/types/tool-card";
import { registerSlotPlugin } from "./slots";
import {
  paintThemeSnapshot,
  readThemeSnapshot,
} from "./theme";

declare global {
  interface Window {
    maouPluginApi?: {
      registerToolCardPreset: typeof registerToolCardPreset;
      registerSlotPlugin: typeof registerSlotPlugin;
    };
  }
}

if (typeof window !== "undefined") {
  window.maouPluginApi = { registerToolCardPreset, registerSlotPlugin };
}

export async function refreshThemeAndPlugins(
  root: HTMLElement = document.documentElement,
): Promise<void> {
  const snap = readThemeSnapshot(
    typeof localStorage === "undefined" ? null : localStorage,
  );
  let vars: Record<string, string> = {};
  try {
    const r = await fetch("/api/plugins");
    const j = (await r.json()) as {
      plugins?: Array<{ id: string; phase: string; ui?: boolean }>;
      themeVars?: { light?: Record<string, string>; dark?: Record<string, string> };
    };
    vars = j.themeVars?.[snap.resolved] ?? {};
    for (const p of j.plugins ?? []) {
      if (p.phase !== "ready" || !p.ui) continue;
      try {
        const src = await fetch(`/api/plugins/${encodeURIComponent(p.id)}/ui`).then((x) => {
          if (!x.ok) throw new Error(String(x.status));
          return x.text();
        });
        const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
        await import(/* @vite-ignore */ url);
      } catch {
        /* ui 入口坏了不挡壳 */
      }
    }
  } catch {
    /* 离线 */
  }
  paintThemeSnapshot(snap, root, vars);
}

export function watchSystemTheme(root: HTMLElement = document.documentElement): () => void {
  try {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => {
      const snap = readThemeSnapshot(localStorage);
      if (snap.preference === "system") void refreshThemeAndPlugins(root);
    };
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  } catch {
    return () => undefined;
  }
}
