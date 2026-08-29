import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type UiLang = "zh" | "en";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

function loadTable(name: "zh" | "en"): Record<string, string> {
  try {
    return require(join(here, `../../locales/${name}.json`)) as Record<string, string>;
  } catch {
    return {};
  }
}

const ZH = loadTable("zh");
const EN = loadTable("en");

export function resolveCliLang(env: NodeJS.ProcessEnv = process.env): UiLang {
  const raw = (env.MAOU_LANG || env.LANG || "").toLowerCase();
  if (raw.startsWith("en")) return "en";
  return "zh";
}

export function t(key: string, lang: UiLang = resolveCliLang()): string {
  const table = lang === "en" ? EN : ZH;
  return table[key] ?? key;
}
