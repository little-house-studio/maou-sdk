/**
 * Tau Ceti —— 默认主题入口。
 * 配色文件：assets/themes/tau-ceti.json（与画廊 assets/gallery 分离）
 */

import type { ThemeTokens } from "./tokens.js";
import { getDefaultThemeTokens, getActiveTheme } from "./load-theme.js";

/** 默认 / 当前主题 tokens */
export const TAU_CETI: ThemeTokens = getDefaultThemeTokens();

export function getTauCetiMeta(): { id: string; name: string; source: string | null } {
  const t = getActiveTheme();
  return { id: t.id, name: t.name, source: t.source };
}
