// ── 顶栏：▌ MAOU // <agentName> ────── ●运行中/○待命 ────────────────

import { visibleWidth } from "@oh-my-pi/pi-tui";
import type { UIState } from "../state/types.js";
import { C, fg } from "../theme/colors.js";
import { SYM } from "../theme/symbols.js";
import { codename } from "./decorators.js";

export function renderTopBar(state: UIState, width: number): string[] {
  const left = `${fg(C.accent)(SYM.index)} ${fg(C.fg)("MAOU")} ${fg(C.muted)(codename(state.agentName))}`;
  const status = state.streaming
    ? `${fg(C.accent)(`${SYM.recDot} ${state.aborting ? "中断中" : "运行中"}`)}`
    : `${fg(C.dim)("○ 待命")}`;
  const leftW = visibleWidth(left);
  const statusW = visibleWidth(status);
  const gap = Math.max(1, width - leftW - statusW);
  return [left + " ".repeat(gap) + status];
}
