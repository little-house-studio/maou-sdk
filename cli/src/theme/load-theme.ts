/**
 * 主题加载 —— 个性化配色方案。
 *
 * 目录约定（与画廊 assets/gallery 分离）：
 *   包内：  cli/assets/themes/<name>.json
 *   用户：  ~/.maou/themes/<name>.json
 *   偏好：  ~/.maou/cli-ui.json  → { "theme": "tau-ceti" }
 *
 * 颜色项可为纯字符串，或 { "base", "hover?" }。
 * 未写 hover 时用 defaults.hover（lighten / fallback）。
 *
 * CLI：maou coding --theme tau-ceti | --theme /path/to.json
 * 设置：Ctrl+, → 配色方案
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import type { ThemeTokens } from "./tokens.js";

// ── 类型 ──────────────────────────────────────────────────

/** 色值：纯 hex，或带悬浮色 */
export type ColorValue = string | { base: string; hover?: string };

export interface ThemeHoverDefaults {
  /** lighten = 提亮 base；fixed = 用 fallback */
  mode?: "lighten" | "fixed";
  amount?: number;
  /** 提亮失败或 fixed 时的默认悬停色 */
  fallback?: string;
}

export interface ThemeDefaults {
  hover?: ThemeHoverDefaults;
}

export interface NavItemThemeRaw {
  label?: string;
  short?: string;
  bg?: ColorValue;
  bgHover?: string;
  fg?: ColorValue;
  fgHover?: string;
  badge?: number;
}

export interface NavItemTheme {
  label: string;
  short: string;
  bg: string;
  bgHover: string;
  fg: string;
  fgHover: string;
  badge?: number;
}

export interface ThemeNavConfig {
  order: string[];
  items: Record<string, NavItemTheme>;
  defaults?: {
    fg?: string;
    fgHover?: string;
    bgHover?: string;
  };
}

export interface ThemeFile {
  id?: string;
  name?: string;
  description?: string;
  defaults?: ThemeDefaults;
  palette?: Record<string, ColorValue>;
  colors?: Record<string, ColorValue>;
  nav?: {
    order?: string[];
    defaults?: ThemeNavConfig["defaults"];
    items?: Record<string, NavItemThemeRaw>;
  };
}

export interface LoadedTheme {
  id: string;
  name: string;
  tokens: ThemeTokens;
  /** token 名 → hover 色（未定义时已按 defaults 解析） */
  tokenHovers: Partial<Record<keyof ThemeTokens, string>>;
  nav: ThemeNavConfig;
  palette: Record<string, { base: string; hover: string }>;
  source: string | null;
}

// ── 内置兜底 ──────────────────────────────────────────────

export const BUILTIN_THEME_COLORS: ThemeTokens = {
  bg: "#101010",
  panelBg: "#242424",
  fg: "#C5C5C5",
  muted: "#808080",
  dim: "#808080",
  border: "#242424",
  borderMuted: "#242424",
  borderAccent: "#C7FF20",
  accent: "#C7FF20",
  accent2: "#3BFFA7",
  ok: "#3BFFA7",
  warn: "#FFD900",
  err: "#FF741D",
  info: "#2121FF",
  user: "#FFFFFF",
  assistant: "#C5C5C5",
  system: "#8363FF",
  tool: "#C7FF20",
  toolResult: "#3BFFA7",
  thinkingOff: "#242424",
  thinkingMinimal: "#808080",
  thinkingLow: "#C5C5C5",
  thinkingMedium: "#FFD900",
  thinkingHigh: "#C7FF20",
  thinkingXhigh: "#FF741D",
  syntaxComment: "#808080",
  syntaxKeyword: "#C7FF20",
  syntaxString: "#3BFFA7",
  syntaxNumber: "#FFD900",
  syntaxFunction: "#2121FF",
  syntaxType: "#8363FF",
  syntaxOperator: "#C5C5C5",
  syntaxVariable: "#FFFFFF",
  syntaxPunctuation: "#808080",
  mdHeading: "#C7FF20",
  mdHeading2: "#3BFFA7",
  mdHeading3: "#FFD900",
  mdCode: "#3BFFA7",
  mdCodeBlock: "#C5C5C5",
  mdCodeBlockBorder: "#242424",
  mdQuote: "#808080",
  mdQuoteBorder: "#C7FF20",
  mdHr: "#242424",
  mdLink: "#2121FF",
  mdListBullet: "#C7FF20",
  toolDiffAdded: "#3BFFA7",
  toolDiffRemoved: "#FF741D",
  toolDiffContext: "#808080",
  selectedBg: "#242424",
  userBg: "#242424",
  systemBg: "#242424",
  toolPendingBg: "#242424",
  toolSuccessBg: "#101010",
  toolErrorBg: "#242424",
  footerBg: "#C5C5C5",
  inputFieldBg: "#B0B0B0",
  assistantMdBg: "#1A1A1A",
  mdPaperBorder: "#242424",
  bashMode: "#3BFFA7",
};

export const BUILTIN_NAV: ThemeNavConfig = {
  order: ["agent", "sessions", "terminal", "todo", "inbox", "notice", "settings"],
  defaults: { fg: "#FFFFFF", fgHover: "#FFFFFF" },
  items: {
    agent: {
      label: "agent",
      short: "A",
      bg: "#FF741D",
      bgHover: "#FF8A3D",
      fg: "#000000",
      fgHover: "#000000",
    },
    sessions: {
      label: "会话",
      short: "会",
      bg: "#F5F0D8",
      bgHover: "#FFF8E0",
      fg: "#000000",
      fgHover: "#000000",
    },
    terminal: {
      label: "终端",
      short: "终",
      bg: "#4A4A4A",
      bgHover: "#5A5A5A",
      fg: "#FFFFFF",
      fgHover: "#FFFFFF",
    },
    todo: {
      label: "任务",
      short: "务",
      bg: "#3A3A3A",
      bgHover: "#4A4A4A",
      fg: "#FFFFFF",
      fgHover: "#FFFFFF",
    },
    inbox: {
      label: "收件箱",
      short: "收",
      bg: "#2A2A2A",
      bgHover: "#353535",
      fg: "#FFFFFF",
      fgHover: "#FFFFFF",
      badge: 0,
    },
    notice: {
      label: "公告",
      short: "告",
      bg: "#1A1A1A",
      bgHover: "#242424",
      fg: "#FFFFFF",
      fgHover: "#FFFFFF",
      badge: 0,
    },
    settings: {
      label: "设置",
      short: "设",
      bg: "#C7FF20",
      bgHover: "#D4FF4A",
      fg: "#000000",
      fgHover: "#000000",
    },
  },
};

const DEFAULT_HOVER: Required<ThemeHoverDefaults> = {
  mode: "lighten",
  amount: 0.14,
  fallback: "#404040",
};

// ── 路径 ──────────────────────────────────────────────────

export function packageThemesDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "assets", "themes"), // dist/assets/themes
    join(here, "..", "..", "assets", "themes"), // src/theme → cli/assets/themes
  ];
  for (const d of candidates) {
    if (existsSync(d)) return d;
  }
  return candidates[0]!;
}

export function userThemesDir(): string {
  return join(homedir(), ".maou", "themes");
}

export function cliUiConfigPath(): string {
  return join(homedir(), ".maou", "cli-ui.json");
}

// ── 色值解析 ──────────────────────────────────────────────

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function toHex(r: number, g: number, b: number): string {
  const h = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

/** 提亮 hex；失败返回 null */
export function lightenHex(hex: string, amount = 0.14): string | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb;
  return toHex(
    r + (255 - r) * amount,
    g + (255 - g) * amount,
    b + (255 - b) * amount,
  );
}

export function splitColorValue(v: ColorValue | undefined | null): {
  base: string;
  hover?: string;
} | null {
  if (v == null) return null;
  if (typeof v === "string") {
    const s = v.trim();
    return s ? { base: s } : null;
  }
  if (typeof v === "object" && typeof v.base === "string") {
    return {
      base: v.base.trim(),
      hover: typeof v.hover === "string" ? v.hover.trim() : undefined,
    };
  }
  return null;
}

/** 解析悬浮色：显式 hover → lighten(base) → defaults.fallback */
export function resolveHoverColor(
  base: string,
  explicitHover: string | undefined,
  defaults: ThemeHoverDefaults = DEFAULT_HOVER,
): string {
  if (explicitHover && parseHex(explicitHover)) return explicitHover;
  const mode = defaults.mode ?? "lighten";
  const amount = defaults.amount ?? 0.14;
  const fallback = defaults.fallback ?? DEFAULT_HOVER.fallback;
  if (mode === "fixed") return fallback;
  return lightenHex(base, amount) ?? fallback;
}

// ── 文件 IO ───────────────────────────────────────────────

function tryParseThemeFile(path: string): ThemeFile | null {
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf-8")) as ThemeFile;
    if (!data || typeof data !== "object") return null;
    return data;
  } catch {
    return null;
  }
}

function listJsonNames(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/i, ""));
  } catch {
    return [];
  }
}

/** 列出可用主题 id（用户覆盖同名优先展示一次） */
export function listThemeIds(): string[] {
  const ids = new Set<string>();
  for (const id of listJsonNames(packageThemesDir())) ids.add(id);
  for (const id of listJsonNames(userThemesDir())) ids.add(id);
  if (ids.size === 0) ids.add("tau-ceti");
  return [...ids].sort();
}

export function listThemesMeta(): { id: string; name: string; source: "package" | "user" | "builtin" }[] {
  const out: { id: string; name: string; source: "package" | "user" | "builtin" }[] = [];
  const seen = new Set<string>();
  for (const id of listJsonNames(userThemesDir())) {
    const t = loadThemeFromPath(join(userThemesDir(), `${id}.json`));
    out.push({ id, name: t?.name ?? id, source: "user" });
    seen.add(id);
  }
  for (const id of listJsonNames(packageThemesDir())) {
    if (seen.has(id)) continue;
    const t = loadThemeFromPath(join(packageThemesDir(), `${id}.json`));
    out.push({ id, name: t?.name ?? id, source: "package" });
    seen.add(id);
  }
  if (out.length === 0) {
    out.push({ id: "tau-ceti", name: "Tau Ceti", source: "builtin" });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

// ── 偏好 ──────────────────────────────────────────────────

export function getPreferredThemeId(): string {
  try {
    const p = cliUiConfigPath();
    if (!existsSync(p)) return "tau-ceti";
    const raw = JSON.parse(readFileSync(p, "utf-8")) as { theme?: string };
    const id = (raw.theme ?? "").trim();
    return id || "tau-ceti";
  } catch {
    return "tau-ceti";
  }
}

export function setPreferredThemeId(id: string): void {
  const p = cliUiConfigPath();
  mkdirSync(dirname(p), { recursive: true });
  let prev: Record<string, unknown> = {};
  try {
    if (existsSync(p)) prev = JSON.parse(readFileSync(p, "utf-8")) as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  prev.theme = id;
  writeFileSync(p, JSON.stringify(prev, null, 2) + "\n", "utf-8");
}

// ── 解析主题文件 ──────────────────────────────────────────

function resolveColorMap(
  map: Record<string, ColorValue> | undefined,
  hoverDefaults: ThemeHoverDefaults,
): Record<string, { base: string; hover: string }> {
  const out: Record<string, { base: string; hover: string }> = {};
  if (!map) return out;
  for (const [k, v] of Object.entries(map)) {
    const s = splitColorValue(v);
    if (!s) continue;
    out[k] = {
      base: s.base,
      hover: resolveHoverColor(s.base, s.hover, hoverDefaults),
    };
  }
  return out;
}

function mergeTokensFromColors(
  colors: Record<string, ColorValue> | undefined,
  hoverDefaults: ThemeHoverDefaults,
): { tokens: ThemeTokens; tokenHovers: Partial<Record<keyof ThemeTokens, string>> } {
  const tokens = { ...BUILTIN_THEME_COLORS };
  const tokenHovers: Partial<Record<keyof ThemeTokens, string>> = {};
  if (!colors) return { tokens, tokenHovers };
  for (const key of Object.keys(BUILTIN_THEME_COLORS) as (keyof ThemeTokens)[]) {
    const s = splitColorValue(colors[key]);
    if (!s) continue;
    tokens[key] = s.base;
    tokenHovers[key] = resolveHoverColor(s.base, s.hover, hoverDefaults);
  }
  return { tokens, tokenHovers };
}

function mergeNav(
  nav: ThemeFile["nav"] | undefined,
  hoverDefaults: ThemeHoverDefaults,
): ThemeNavConfig {
  const order =
    Array.isArray(nav?.order) && nav!.order!.length > 0
      ? nav!.order!
      : [...BUILTIN_NAV.order];
  const navDefaults = {
    fg: nav?.defaults?.fg ?? BUILTIN_NAV.defaults?.fg ?? "#FFFFFF",
    fgHover: nav?.defaults?.fgHover ?? BUILTIN_NAV.defaults?.fgHover ?? "#FFFFFF",
    bgHover: nav?.defaults?.bgHover,
  };
  const items: Record<string, NavItemTheme> = {};
  // start from builtin
  for (const [id, it] of Object.entries(BUILTIN_NAV.items)) {
    items[id] = { ...it };
  }
  if (nav?.items) {
    for (const [id, raw] of Object.entries(nav.items)) {
      if (!raw || typeof raw !== "object") continue;
      const prev = items[id];
      const bgSplit = splitColorValue(raw.bg) ?? {
        base: prev?.bg ?? "#242424",
        hover: prev?.bgHover,
      };
      const fgSplit = splitColorValue(raw.fg) ?? {
        base: raw.fg
          ? String(raw.fg)
          : (prev?.fg ?? navDefaults.fg),
      };
      // raw.fg as string only if ColorValue string — already handled
      const bg = bgSplit.base;
      const bgHover =
        (typeof raw.bgHover === "string" && raw.bgHover) ||
        navDefaults.bgHover ||
        resolveHoverColor(bg, bgSplit.hover, hoverDefaults);
      const fg =
        typeof raw.fg === "string"
          ? raw.fg
          : fgSplit.base || prev?.fg || navDefaults.fg;
      const fgHover =
        (typeof raw.fgHover === "string" && raw.fgHover) ||
        resolveHoverColor(fg, fgSplit.hover, hoverDefaults) ||
        navDefaults.fgHover;
      items[id] = {
        label: String(raw.label ?? prev?.label ?? id),
        short: String(raw.short ?? prev?.short ?? id.slice(0, 1)),
        bg,
        bgHover,
        fg,
        fgHover,
        badge:
          typeof raw.badge === "number"
            ? raw.badge
            : prev?.badge,
      };
    }
  }
  // ensure hover filled for builtin-only items
  for (const [id, it] of Object.entries(items)) {
    if (!it.bgHover) {
      items[id] = {
        ...it,
        bgHover: resolveHoverColor(it.bg, undefined, hoverDefaults),
      };
    }
    if (!it.fgHover) {
      items[id] = {
        ...items[id]!,
        fgHover: it.fgHover || navDefaults.fgHover || it.fg,
      };
    }
  }
  return { order, items, defaults: navDefaults };
}

export function themeFromFile(data: ThemeFile, source: string | null = null): LoadedTheme {
  const hoverDefaults: ThemeHoverDefaults = {
    ...DEFAULT_HOVER,
    ...(data.defaults?.hover ?? {}),
  };
  const palette = resolveColorMap(data.palette, hoverDefaults);
  const { tokens, tokenHovers } = mergeTokensFromColors(data.colors, hoverDefaults);
  const nav = mergeNav(data.nav, hoverDefaults);
  const id =
    data.id?.trim() ||
    (source ? basename(source, ".json") : "custom");
  return {
    id,
    name: data.name?.trim() || id,
    tokens,
    tokenHovers,
    nav,
    palette,
    source,
  };
}

export function loadThemeFromPath(path: string): LoadedTheme | null {
  const file = tryParseThemeFile(path);
  if (!file) return null;
  return themeFromFile(file, path);
}

/**
 * 按主题名加载：用户目录优先，再包内 assets/themes/<id>.json
 */
export function loadThemeById(id: string): LoadedTheme | null {
  const name = id.replace(/\.json$/i, "").trim();
  if (!name) return null;
  const userPath = join(userThemesDir(), `${name}.json`);
  const pkgPath = join(packageThemesDir(), `${name}.json`);
  return loadThemeFromPath(userPath) ?? loadThemeFromPath(pkgPath);
}

/**
 * 解析 --theme 参数：路径或主题名
 */
export function resolveThemeArg(arg: string | undefined | null): LoadedTheme {
  if (arg && arg.trim()) {
    const a = arg.trim();
    // 绝对/相对路径
    if (a.includes("/") || a.endsWith(".json") || existsSync(a)) {
      const abs = resolve(a);
      const fromPath = loadThemeFromPath(abs);
      if (fromPath) return fromPath;
    }
    const byId = loadThemeById(a);
    if (byId) return byId;
  }
  return loadPreferredTheme();
}

export function loadPreferredTheme(): LoadedTheme {
  const id = getPreferredThemeId();
  return (
    loadThemeById(id) ??
    loadThemeById("tau-ceti") ??
    {
      id: "tau-ceti",
      name: "Tau Ceti",
      tokens: { ...BUILTIN_THEME_COLORS },
      tokenHovers: {},
      nav: structuredClone(BUILTIN_NAV),
      palette: {},
      source: null,
    }
  );
}

// ── 进程内当前主题 ────────────────────────────────────────

let active: LoadedTheme | null = null;

export function clearThemeCache(): void {
  active = null;
}

export function getActiveTheme(): LoadedTheme {
  if (!active) active = loadPreferredTheme();
  return active;
}

export function setActiveTheme(theme: LoadedTheme, persist = false): void {
  active = theme;
  if (persist) setPreferredThemeId(theme.id);
}

export function getDefaultThemeTokens(): ThemeTokens {
  return getActiveTheme().tokens;
}

export function getDefaultNavConfig(): ThemeNavConfig {
  return getActiveTheme().nav;
}

/** @deprecated 用 loadPreferredTheme / getActiveTheme */
export function loadDefaultTheme(): LoadedTheme {
  return getActiveTheme();
}
