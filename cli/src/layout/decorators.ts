/**
 * 磁带装饰元素 —— Marathon 美学的信息功能性装饰。
 *
 * 每个装饰都表达一个数据/状态（分隔/编号/标记/时码/录制/条/信道），
 * 无纯花纹。组件从这里取符号，便于全局统一样式。
 */

import { SYMBOLS } from "../theme/tokens.js";

/** 时码 HH:MM:SS（本地时间，状态栏/消息行用） */
export function timecode(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 信道编号 [ch.NN]（round 或 session 序号） */
export function channel(n: number): string {
  return `[${SYMBOLS.channel}.${String(n).padStart(2, "0")}]`;
}

/** 角色代号 // role */
export function codename(role: string): string {
  return `${SYMBOLS.separator} ${role}`;
}

/** 编号 ▌NN */
export function indexMark(n: number): string {
  return `${SYMBOLS.index}${String(n).padStart(2, "0")}`;
}

/** 数据条 ████████░░ 占比 */
export function bar(ratio: number, width = 10): string {
  const r = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(r * width);
  return SYMBOLS.barFull.repeat(filled) + SYMBOLS.barEmpty.repeat(width - filled);
}

/** REC ● 录制点（streaming 时用） */
export function rec(active: boolean): string {
  return active ? `${SYMBOLS.recDot}` : "○";
}

/** 思考级别 → thinking token 名 + 显示数字 */
export function thinkingLabel(level: number): string {
  const names = ["off", "min", "low", "med", "high", "xhigh"];
  const clamped = Math.max(0, Math.min(5, level));
  return `think:${names[clamped]}`;
}

/** 单位换算：token 数 → 12.3k / 200k 紧凑显示 */
export function compact(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
