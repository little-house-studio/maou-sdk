/**
 * CLI 设置目录 —— 设置弹窗（Ink / Ratatui）同源。
 *
 * 每项：id + 标签 + 当前值描述 + 行为类型。
 * 持久化字段走 config/cli-ui-prefs；会话态（审核/思考）走 store。
 */

export type SettingKind =
  | "toggle" // Enter 切换
  | "submenu" // 进入子页
  | "action" // 执行一次动作
  | "cycle"; // 循环枚举

export type SettingId =
  | "perf_hud"
  | "model"
  | "approval"
  | "thinking"
  | "theme"
  | "sound"
  | "mouse"
  | "help";

export interface SettingContext {
  provider: string;
  model: string;
  approvalMode: string;
  thinkingLevel: number;
  themeName: string;
  perfHud: boolean;
  mouseCapture: boolean;
  soundEnabled?: boolean;
}

export interface SettingDef {
  id: SettingId;
  label: string;
  kind: SettingKind;
  /** 主菜单是否显示（Ink 完整 / Ratatui 精简可过滤） */
  surfaces: Array<"ink" | "ratatui">;
  description: (ctx: SettingContext) => string;
}

const THINKING_LABELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export const CLI_SETTINGS: readonly SettingDef[] = [
  {
    id: "perf_hud",
    label: "Debug 显示",
    kind: "toggle",
    surfaces: ["ink", "ratatui"],
    description: (ctx) =>
      ctx.perfHud
        ? "开 · 右上角性能条 · Enter 关闭"
        : "关 · Enter 开启",
  },
  {
    id: "model",
    label: "API 配置",
    kind: "submenu",
    surfaces: ["ink"],
    description: (ctx) => `${ctx.provider}/${ctx.model || "未选"}`,
  },
  {
    id: "approval",
    label: "审核模式",
    kind: "cycle",
    surfaces: ["ink", "ratatui"],
    description: (ctx) =>
      `${ctx.approvalMode} · Shift+Tab 循环 normal/auto/yolo`,
  },
  {
    id: "thinking",
    label: "思考级别",
    kind: "cycle",
    surfaces: ["ink", "ratatui"],
    description: (ctx) =>
      `${ctx.thinkingLevel} (${THINKING_LABELS[ctx.thinkingLevel] ?? "?"} · 循环 0–5)`,
  },
  {
    id: "theme",
    label: "配色方案",
    kind: "submenu",
    surfaces: ["ink"],
    description: (ctx) => ctx.themeName,
  },
  {
    id: "sound",
    label: "音效开关",
    kind: "toggle",
    surfaces: ["ratatui"],
    description: () => "Ctrl+S 切换",
  },
  {
    id: "mouse",
    label: "鼠标捕获",
    kind: "toggle",
    surfaces: ["ink", "ratatui"],
    description: (ctx) =>
      ctx.mouseCapture ? "开 · SGR 点击/滚轮" : "关 · 终端原生选字",
  },
  {
    id: "help",
    label: "打开帮助",
    kind: "action",
    surfaces: ["ratatui"],
    description: () => "快捷键一览",
  },
] as const;

export interface SettingListItem {
  value: string;
  label: string;
  description?: string;
}

export function settingsForSurface(
  surface: "ink" | "ratatui",
  ctx: SettingContext,
): SettingListItem[] {
  return CLI_SETTINGS.filter((s) => s.surfaces.includes(surface)).map((s) => ({
    value: s.id,
    label: s.label,
    description: s.description(ctx),
  }));
}

export function getSetting(id: string): SettingDef | undefined {
  return CLI_SETTINGS.find((s) => s.id === id);
}
