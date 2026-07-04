// ── 空对话占位 ─────────────────────────────────────────────────────────

import { C, fg } from "../theme/colors.js";
import { SYM } from "../theme/symbols.js";

export function renderEmpty(width: number): string[] {
  const lines = [
    `${fg(C.dim)("─".repeat(Math.min(width, 50)))}`,
    `${fg(C.muted)(`${SYM.separator} 欢迎使用 MAOU TUI`)}`,
    `${fg(C.muted)("输入消息后回车发送，Alt+Enter 换行")}`,
    `${fg(C.dim)("/new /quit /help /tools /expand /collapse  · 输入 / 查看所有命令")}`,
  ];
  return lines;
}
