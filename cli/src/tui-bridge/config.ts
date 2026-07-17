/**
 * TUI 后端 —— 仅 Ratatui。
 * Ink 已删除；MAOU_TUI=ink 由 launchAgent 拒绝。
 */

export type TuiBackend = "ratatui";

/**
 * Ratatui 是否正在占用 TTY（alternate screen + 双缓冲）。
 * Node 侧禁止对此写 CSI 清屏 / 视口复位，否则会花屏。
 */
export function isRatatuiBackend(): boolean {
  const active = (process.env.MAOU_TUI_ACTIVE || "").toLowerCase();
  if (active === "ratatui" || active === "rust" || active === "rt") return true;
  // 产品唯一后端
  return true;
}

/** 标记当前进程由 Ratatui 持有 TTY */
export function markRatatuiActive(): void {
  process.env.MAOU_TUI_ACTIVE = "ratatui";
  process.env.MAOU_TUI = "ratatui";
}

/** @deprecated 仅 ratatui；保留 API 兼容 */
export function resolveTuiBackend(_flag?: string | null): TuiBackend {
  return "ratatui";
}
