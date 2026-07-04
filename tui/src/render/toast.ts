// ── 系统提示（toast）：居中框，颜色按 kind 区分 ─────────────────────

import { visibleWidth } from "@oh-my-pi/pi-tui";
import type { UIState } from "../state/types.js";
import { C, fg } from "../theme/colors.js";

export function renderToast(state: UIState, width: number): string[] {
  const t = state.toast;
  if (!t) return [];
  const color = t.kind === "err" ? fg(C.err) : t.kind === "warn" ? fg(C.warn) : t.kind === "ok" ? fg(C.ok) : fg(C.magenta);
  const text = ` ${t.text} `;
  const tw = visibleWidth(text);
  const pad = Math.max(0, Math.floor((width - tw) / 2));
  const line = " ".repeat(pad) + color(text);
  return [line];
}
