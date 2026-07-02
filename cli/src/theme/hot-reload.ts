/**
 * 主题热重载 —— 监听 ~/.maou/themes/*.json，改文件即时 setTheme。
 * 阶段 6：JSON 文件 watch + 解析 + 合并 TAU_CETI 兜底。
 */

import { watch, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ThemeTokens } from "./tokens.js";
import { TAU_CETI } from "./tau-ceti.js";

const THEMES_DIR = join(homedir(), ".maou", "themes");

/** 从 JSON 文件加载主题（合并 TAU_CETI 兜底缺失字段） */
export function loadThemeFile(path: string): ThemeTokens | null {
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    if (!data || typeof data !== "object") return null;
    const colors = data.colors ?? data;
    // 合并：TAU_CETI 兜底，文件覆盖
    return { ...TAU_CETI, ...colors } as ThemeTokens;
  } catch {
    return null;
  }
}

/** 列出可用主题名 */
export function listThemes(): { id: string; name: string }[] {
  if (!existsSync(THEMES_DIR)) return [{ id: "tau-ceti", name: "Tau Ceti (内置)" }];
  const out = [{ id: "tau-ceti", name: "Tau Ceti (内置)" }];
  try {
    for (const f of readdirSync(THEMES_DIR)) {
      if (!f.endsWith(".json")) continue;
      const id = f.replace(/\.json$/, "");
      try {
        const data = JSON.parse(readFileSync(join(THEMES_DIR, f), "utf-8"));
        out.push({ id, name: data.name ?? id });
      } catch { /* skip */ }
    }
  } catch { /* ignore */ }
  return out;
}

/** 监听主题目录，文件变更时回调（setTheme） */
export function watchThemes(onChange: (theme: ThemeTokens) => void): () => void {
  if (!existsSync(THEMES_DIR)) return () => {};
  let debounce: NodeJS.Timeout | null = null;
  try {
    const watcher = watch(THEMES_DIR, { recursive: false }, (_event, filename) => {
      if (!filename || !filename.endsWith(".json")) return;
      // 防抖
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        const t = loadThemeFile(join(THEMES_DIR, filename));
        if (t) onChange(t);
      }, 200);
    });
    return () => watcher.close();
  } catch {
    return () => {};
  }
}
