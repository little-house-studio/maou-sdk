import { EN } from "../../../locales/en.js";
import { ZH } from "../../../locales/zh.js";

export type UiLang = "zh" | "en";

const KEY = "maou-ui-lang";

function browserLang(): UiLang {
  try {
    const nav = typeof navigator !== "undefined" ? navigator.language : "";
    return nav.toLowerCase().startsWith("zh") ? "zh" : "en";
  } catch {
    return "zh";
  }
}

export function readUiLang(storage?: Pick<Storage, "getItem"> | null): UiLang {
  try {
    const v = storage?.getItem(KEY);
    if (v === "en" || v === "zh") return v;
  } catch {
    /* ignore */
  }
  return browserLang();
}

export function writeUiLang(lang: UiLang, storage?: Pick<Storage, "setItem"> | null): void {
  try {
    storage?.setItem(KEY, lang);
  } catch {
    /* ignore */
  }
}

export function t(key: string, lang: UiLang = readUiLang(typeof localStorage !== "undefined" ? localStorage : null)): string {
  const table = lang === "en" ? EN : ZH;
  return table[key] ?? key;
}
