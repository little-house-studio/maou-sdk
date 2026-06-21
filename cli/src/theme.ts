/** Maou CLI 视觉主题 —— RPG 风调色板（truecolor，降级由终端处理） */

export type Theme = {
  name: string;
  bg: string;
  fg: string;
  dim: string;
  border: string;
  borderSoft: string;
  borderHeavy: string;
  accent: string;
  accent2: string;
  role: { user: string; assistant: string; system: string; tool: string; toolResult: string };
  status: { ok: string; warn: string; err: string; info: string };
  gauge: string[];
  spark: string[];
};

const VAMPIRE: Theme = {
  name: "vampire",
  bg: "#1a0e1f",
  fg: "#e8dcee",
  dim: "#7a6a82",
  border: "#6b3fa0",
  borderSoft: "#9b6fc4",
  borderHeavy: "#8b2c4a",
  accent: "#c026d3",
  accent2: "#f43f5e",
  role: { user: "#60a5fa", assistant: "#e879f9", system: "#a78bfa", tool: "#fbbf24", toolResult: "#34d399" },
  status: { ok: "#34d399", warn: "#fbbf24", err: "#f43f5e", info: "#60a5fa" },
  gauge: ["#8b2c4a", "#c026d3", "#f43f5e", "#fb7185"],
  spark: ["#6b3fa0", "#c026d3", "#f43f5e", "#fb923c", "#fbbf24"],
};

const CYBER: Theme = {
  ...VAMPIRE,
  name: "cyber",
  bg: "#04101a",
  fg: "#d6f5ff",
  dim: "#4a7a8a",
  border: "#06b6d4",
  borderSoft: "#22d3ee",
  borderHeavy: "#0e7490",
  accent: "#22d3ee",
  accent2: "#ec4899",
  role: { user: "#22d3ee", assistant: "#a78bfa", system: "#64748b", tool: "#fbbf24", toolResult: "#34d399" },
  status: { ok: "#34d399", warn: "#fbbf24", err: "#ef4444", info: "#22d3ee" },
  gauge: ["#0e7490", "#06b6d4", "#22d3ee", "#67e8f9"],
  spark: ["#0e7490", "#06b6d4", "#22d3ee", "#67e8f9", "#a5f3fc"],
};

export const THEMES: Record<string, Theme> = { vampire: VAMPIRE, cyber: CYBER };
export let currentTheme: Theme = VAMPIRE;
export const setTheme = (name: string): void => { if (THEMES[name]) currentTheme = THEMES[name]; };
