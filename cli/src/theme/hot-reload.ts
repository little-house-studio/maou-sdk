/**
 * 主题热重载 —— 监听 ~/.maou/themes/*.json
 * 包内主题目录：assets/themes/<name>.json
 */

import { watch, existsSync } from "node:fs";
import { join } from "node:path";
import type { ThemeTokens } from "./tokens.js";
import {
  loadThemeFromPath,
  listThemesMeta,
  packageThemesDir,
  userThemesDir,
  type LoadedTheme,
} from "./load-theme.js";

export function loadThemeFile(path: string): ThemeTokens | null {
  return loadThemeFromPath(path)?.tokens ?? null;
}

export function loadFullThemeFile(path: string): LoadedTheme | null {
  return loadThemeFromPath(path);
}

/** 列出可用主题（用户 + 包内） */
export function listThemes(): { id: string; name: string }[] {
  return listThemesMeta().map((t) => ({
    id: t.id,
    name: t.source === "user" ? `${t.name} (用户)` : t.name,
  }));
}

/** 监听用户主题目录 */
export function watchThemes(onChange: (theme: ThemeTokens) => void): () => void {
  const dir = userThemesDir();
  if (!existsSync(dir)) return () => {};
  let debounce: NodeJS.Timeout | null = null;
  try {
    const watcher = watch(dir, { recursive: false }, (_event, filename) => {
      if (!filename || !String(filename).endsWith(".json")) return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        const t = loadThemeFile(join(dir, String(filename)));
        if (t) onChange(t);
      }, 200);
    });
    return () => watcher.close();
  } catch {
    return () => {};
  }
}

export { packageThemesDir, userThemesDir };
