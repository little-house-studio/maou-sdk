/** Maou CLI 视觉主题 —— 酸性配色（Acid Palette）
 *  主色：酸性黄绿 #CCFF00（Acid Yellow-Green）
 *  辅色：酸性品红 #FF00FF / 酸性青 #00CCFF
 *  背景：近黑 #0A0A0A，极简冷淡机能风
 */

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
  overlayBg: string;
  overlayFg: string;
  overlayShadow: string;
  selectionBg: string;
  gradient: string[];
  role: { user: string; assistant: string; system: string; tool: string; toolResult: string };
  status: { ok: string; warn: string; err: string; info: string };
  gauge: string[];
  spark: string[];
};

// ─── 酸性配色（Acid Palette） ─────────────────────────────────────────────────
//
// 酸性黄绿系（Acid Yellow-Green）：
//   Acid Yellow-Green  #CCFF00  主交互色、光标、选中（黄绿，非纯绿）
//   Acid Lime          #B0FF00  次级高亮
//   Acid Chartreuse    #7FFF00  成功状态
//
// 酸性辅色：
//   Acid Magenta       #FF00FF  工具调用、高对比强调
//   Acid Cyan          #00CCFF  用户消息、信息
//   Acid Orange        #FF6600  警告、进度
//   Acid Red           #FF0044  错误、危险
//
// 中性色：
//   Near Black         #0A0A0A  主背景
//   Dark Gray          #1A1A1A  次级面板背景
//   Gray               #333333  线条
//   Mid Gray           #555555  失效/禁用
//   Off White          #E0E0E0  正文

const ACID: Theme = {
  name: "acid",
  bg: "#0A0A0A",          // 近黑 — 主背景
  fg: "#E0E0E0",          // Off White — 正文
  dim: "#555555",         // Mid Gray — 失效/禁用
  border: "#333333",       // 线条主色
  borderSoft: "#222222",  // 线条次级
  borderHeavy: "#CCFF00", // 线条激活（酸性黄绿）
  accent: "#CCFF00",      // Acid Yellow-Green — 主交互色、光标、选中
  accent2: "#FF00FF",     // Acid Magenta — 高对比强调
  overlayBg: "#1A1A1A",   // 次级面板背景
  overlayFg: "#E0E0E0",
  overlayShadow: "#000000",
  selectionBg: "#CCFF00", // Acid Yellow-Green
  // 渐变：黄绿 → 青绿 → 品红 → 橙（酸性色阶）
  gradient: ["#CCFF00", "#00FF88", "#00CCFF", "#FF00FF"],
  // 角色色
  role: {
    user: "#00CCFF",       // Acid Cyan — 用户消息
    assistant: "#CCFF00",  // Acid Yellow-Green — Agent 回复
    system: "#555555",     // Mid Gray — 系统消息
    tool: "#FF00FF",       // Acid Magenta — 工具调用
    toolResult: "#00FF88", // Acid Green-Cyan — 工具结果
  },
  // 状态色
  status: {
    ok: "#00FF88",        // Acid Green-Cyan
    warn: "#FF6600",      // Acid Orange
    err: "#FF0044",       // Acid Red
    info: "#00CCFF",      // Acid Cyan
  },
  // VU 表 / 计数器色阶
  gauge: ["#CCFF00", "#00FF88", "#FF6600", "#FF0044"],
  spark: ["#CCFF00", "#00FF88", "#00CCFF", "#FF00FF", "#555555"],
};

// ─── 备用主题 ──────────────────────────────────────────────────────────────

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
  overlayBg: "#2a1533",
  overlayFg: "#f3e9f8",
  overlayShadow: "#090410",
  selectionBg: "#6b3fa0",
  gradient: ["#c026d3", "#f43f5e", "#fb923c", "#fbbf24"],
  role: { user: "#60a5fa", assistant: "#e879f9", system: "#a78bfa", tool: "#fbbf24", toolResult: "#34d399" },
  status: { ok: "#34d399", warn: "#fbbf24", err: "#f43f5e", info: "#60a5fa" },
  gauge: ["#8b2c4a", "#c026d3", "#f43f5e", "#fb7185"],
  spark: ["#6b3fa0", "#c026d3", "#f43f5e", "#fb923c", "#fbbf24"],
};

export const THEMES: Record<string, Theme> = { acid: ACID, vampire: VAMPIRE };
export let currentTheme: Theme = ACID;
export const setTheme = (name: string): void => { if (THEMES[name]) currentTheme = THEMES[name]!; };
