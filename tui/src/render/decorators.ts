// ── 装饰元素（移植自 cli/layout/decorators.ts） ───────────────────────
//
// 纯函数装饰器：timecode / codename / compact / trunc。
// 不持有状态，供各 render 模块调用。

import { truncateToWidth, Ellipsis } from "@oh-my-pi/pi-tui";
import { SYM } from "../theme/symbols.js";

export function timecode(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function codename(role: string): string {
  return `${SYM.separator} ${role}`;
}

export function compact(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// ── Pi TUI truncateToWidth 适配：返回纯文本截断（带省略号） ──────────
/** CJK 安全截断：按可见宽度截断，超宽追加 … */
export function trunc(s: string, maxCols: number): string {
  return truncateToWidth(s, maxCols, Ellipsis.Unicode);
}
