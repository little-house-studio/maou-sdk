/** Sheet theme — light paper / dark plate. Painted on `<html data-theme>`. */

export type SheetTheme = "light" | "dark";

export const SHEET_THEME_KEY = "maou-sheet-theme";

export function resolveSheetTheme(stored?: string | null): SheetTheme {
  return stored === "dark" ? "dark" : "light";
}

export function readSheetTheme(
  storage?: Pick<Storage, "getItem"> | null,
): SheetTheme {
  try {
    return resolveSheetTheme(storage?.getItem(SHEET_THEME_KEY));
  } catch {
    return "light";
  }
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

export function paintSheetTheme(
  root: { dataset: { theme?: string } } = document.documentElement,
  theme: SheetTheme = "light",
): void {
  root.dataset.theme = theme;
}

export function applySheetTheme(
  theme: SheetTheme,
  root: { dataset: { theme?: string } } = document.documentElement,
  storage?: Pick<Storage, "setItem"> | null,
): void {
  writeSheetTheme(theme, storage);
  paintSheetTheme(root, theme);
}
