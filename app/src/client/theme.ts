/** Sheet theme. Shell paints from a snapshot; plugins do not touch the root. */

export type SheetTheme = "light" | "dark" | "system";
export type ResolvedSheetTheme = "light" | "dark";

export const SHEET_THEME_KEY = "maou-sheet-theme";

export type ThemeSnapshot = {
  preference: SheetTheme;
  resolved: ResolvedSheetTheme;
};

export function systemResolved(
  matchMedia: ((q: string) => { matches: boolean }) | null = typeof window !== "undefined"
    ? window.matchMedia.bind(window)
    : null,
): ResolvedSheetTheme {
  try {
    return matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function resolveSheetTheme(
  stored?: string | null,
  matchMedia?: ((q: string) => { matches: boolean }) | null,
): ResolvedSheetTheme {
  if (stored === "dark" || stored === "light") return stored;
  return systemResolved(matchMedia);
}

export function readSheetPreference(
  storage?: Pick<Storage, "getItem"> | null,
): SheetTheme {
  try {
    const v = storage?.getItem(SHEET_THEME_KEY);
    if (v === "dark" || v === "light" || v === "system") return v;
  } catch {
    /* ignore */
  }
  return "light";
}

export function readThemeSnapshot(
  storage?: Pick<Storage, "getItem"> | null,
  matchMedia?: ((q: string) => { matches: boolean }) | null,
): ThemeSnapshot {
  const preference = readSheetPreference(storage);
  return { preference, resolved: resolveSheetTheme(preference, matchMedia) };
}

/** @deprecated 用 readThemeSnapshot */
export function readSheetTheme(
  storage?: Pick<Storage, "getItem"> | null,
): ResolvedSheetTheme {
  return readThemeSnapshot(storage).resolved;
}

export function writeSheetTheme(
  theme: SheetTheme,
  storage?: Pick<Storage, "setItem"> | null,
): void {
  try {
    storage?.setItem(SHEET_THEME_KEY, theme);
  } catch {
    /* quota */
  }
}

export function paintThemeSnapshot(
  snap: ThemeSnapshot,
  root: { dataset: { theme?: string } } = document.documentElement,
  pluginVars?: Record<string, string>,
): void {
  root.dataset.theme = snap.resolved;
  if (pluginVars && "style" in root) {
    const style = (root as unknown as HTMLElement).style;
    for (const [k, v] of Object.entries(pluginVars)) {
      style.setProperty(k, v);
    }
  }
}

export function paintSheetTheme(
  root: { dataset: { theme?: string } } = document.documentElement,
  theme: ResolvedSheetTheme = "light",
): void {
  paintThemeSnapshot({ preference: theme, resolved: theme }, root);
}

export function applySheetTheme(
  theme: SheetTheme,
  root: { dataset: { theme?: string } } = document.documentElement,
  storage?: Pick<Storage, "setItem"> | null,
  pluginVars?: Record<string, string>,
): ThemeSnapshot {
  writeSheetTheme(theme, storage);
  const snap = {
    preference: theme,
    resolved: resolveSheetTheme(theme),
  };
  paintThemeSnapshot(snap, root, pluginVars);
  return snap;
}
