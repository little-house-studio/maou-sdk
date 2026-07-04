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

/**
 * 传入 Rust native truncateToWidth 之前的字符数上限。
 *
 * 原因：pi-natives Rust 实现在超长 CJK+ANSI 串上用字节索引切片，与 Node
 * 下 Bun.stringWidth shim 的列宽计算在某些边界字符上不一致，算出的偏移
 * 落到多字节字符中间 → str::get panic → 进程 abort（191KB assistant 消息
 * 曾触发 terminal.rs:372 panic）。Rust panic 跨线程 abort，try/catch 接不住，
 * 故只能在调用前 JS 层按字符截到安全长度，让 native 永远拿不到超长串。
 */
const TRUNC_SAFE_CHARS = 4000;

// ── Pi TUI truncateToWidth 适配：返回纯文本截断（带省略号） ──────────
/**
 * CJK 安全截断：按可见宽度截断，超宽追加 …
 * 调用前先在 JS 层按字符截到 4000，规避 Rust native 在超长串上 panic。
 */
export function trunc(s: string, maxCols: number): string {
  const safe = s.length > TRUNC_SAFE_CHARS ? s.slice(0, TRUNC_SAFE_CHARS) : s;
  return truncateToWidth(safe, maxCols, Ellipsis.Unicode);
}
