/** Maou CLI 主题 — 极简配色（纯数据） */
export type Theme = {
  bg: string; fg: string; dim: string; border: string;
  accent: string; accent2: string;
  overlayBg: string; selectionBg: string; overlayFg: string;
  role: { user: string; assistant: string; system: string; tool: string; toolResult: string };
  status: { ok: string; warn: string; err: string; info: string };
};

const ACID: Theme = {
  bg: "#0A0A0A", fg: "#E0E0E0", dim: "#555555", border: "#333333",
  accent: "#CCFF00", accent2: "#FF00FF",
  overlayBg: "#1A1A1A", selectionBg: "#CCFF00", overlayFg: "#E0E0E0",
  role: { user: "#00CCFF", assistant: "#CCFF00", system: "#555555", tool: "#FF00FF", toolResult: "#00FF88" },
  status: { ok: "#00FF88", warn: "#FF6600", err: "#FF0044", info: "#00CCFF" },
};

const VAMPIRE: Theme = {
  bg: "#1a0e1f", fg: "#e8dcee", dim: "#7a6a82", border: "#6b3fa0",
  accent: "#c026d3", accent2: "#f43f5e",
  overlayBg: "#2a1533", selectionBg: "#6b3fa0", overlayFg: "#f3e9f8",
  role: { user: "#60a5fa", assistant: "#e879f9", system: "#a78bfa", tool: "#fbbf24", toolResult: "#34d399" },
  status: { ok: "#34d399", warn: "#fbbf24", err: "#f43f5e", info: "#60a5fa" },
};

export const THEMES: Record<string, Theme> = { acid: ACID, vampire: VAMPIRE };
export let currentTheme: Theme = ACID;
export const setTheme = (name: string): void => { if (THEMES[name]) currentTheme = THEMES[name]!; };
