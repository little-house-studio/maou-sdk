/**
 * 轻量动画帧：active 时按全局时钟递增 frame，供 spinner / 渐变色使用。
 *
 * 性能：全进程只挂 **一个** setInterval（默认 150ms），所有 spinner/LIVE
 * 共享 tick。旧实现每个 ToolCard/Thinking/Status 各自 setInterval，
 * 流式中 4–8 个独立 timer → 4–8 次 React setState → 多次 Ink 全树布局
 * + 全屏 paint，是卡顿主因之一。
 *
 * 注意：只要有任意组件 useAnimFrame(true)，就会驱动 React commit → Ink
 * onRender → 全屏 paint。空闲/仅后台任务时务必 active=false（用静态图标）。
 */

import { useSyncExternalStore } from "react";
import { perfInc } from "./perf.js";
import { ANIM_INTERVAL_MS } from "../config/ui-constants.js";
import { isLiteNoAnim } from "../config/lite-mode.js";

const DEFAULT_INTERVAL_MS = ANIM_INTERVAL_MS;

let globalFrame = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let intervalMs = DEFAULT_INTERVAL_MS;
const listeners = new Set<() => void>();

function emit(): void {
  globalFrame = (globalFrame + 1) % 1_000_000;
  perfInc("animTick");
  for (const l of listeners) l();
}

function ensureClock(): void {
  if (isLiteNoAnim()) return; // LITE：永不挂 spinner 时钟
  if (timer) return;
  timer = setInterval(emit, intervalMs);
  if (typeof timer === "object" && "unref" in timer) timer.unref();
}

function stopClockIfIdle(): void {
  if (listeners.size === 0 && timer) {
    clearInterval(timer);
    timer = null;
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  ensureClock();
  return () => {
    listeners.delete(cb);
    stopClockIfIdle();
  };
}

function getFrame(): number {
  return globalFrame;
}

/**
 * @param active 是否参与动画（false 时不订阅时钟、不触发重渲）
 * @param _intervalMs 兼容旧 API；实际由全局时钟决定（避免每组件不同 interval 分裂）
 */
export function useAnimFrame(active: boolean, _intervalMs = DEFAULT_INTERVAL_MS): number {
  // LITE / 未 active：不订阅时钟
  const on = active && !isLiteNoAnim();
  const frame = useSyncExternalStore(
    on ? subscribe : () => () => {},
    getFrame,
    getFrame,
  );
  void _intervalMs;
  return on ? frame : 0;
}

/** 测试 / 调试：当前全局帧 */
export function getAnimFrame(): number {
  return globalFrame;
}

/** 测试：强制停表 */
export function resetAnimClockForTests(): void {
  if (timer) clearInterval(timer);
  timer = null;
  listeners.clear();
  globalFrame = 0;
}

/** 经典 braille spinner */
export const SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";

export function spinnerChar(frame: number): string {
  return SPINNER[frame % SPINNER.length] ?? "⠋";
}

/**
 * UI 动效色表（spinner / LIVE 等）：酸绿 ↔ 青 ↔ 浅紫，中等明度。
 */
export const NEON_PALETTE: Array<[number, number, number]> = [
  [120, 160, 70],   // 哑光酸绿
  [70, 150, 130],   // 柔青
  [90, 120, 165],   // 灰蓝
  [120, 110, 165],  // 浅紫灰
];

function lerpPalette(
  palette: Array<[number, number, number]>,
  t: number,
): [number, number, number] {
  const n = palette.length;
  const x = ((t % n) + n) % n;
  const i = Math.floor(x);
  const f = x - i;
  const a = palette[i]!;
  const b = palette[(i + 1) % n]!;
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

/** 沿色环插值：t 任意实数，循环（UI 动效） */
export function neonRgb(t: number): [number, number, number] {
  return lerpPalette(NEON_PALETTE, t);
}

/**
 * 选区底色：Tau Ceti 计算机深蓝 #2121FF（纯色，无渐变）。
 * 保留 selRgb 供兼容调用；任意 t 均返回同一色。
 */
export const SEL_PALETTE: Array<[number, number, number]> = [
  [0x21, 0x21, 0xff],
];

/** @deprecated 选区已改为纯色；恒返回计算机蓝 */
export function selRgb(_t: number): [number, number, number] {
  return [0x21, 0x21, 0xff];
}

/** 选区固定前景：浅字（计算机蓝底上） */
export const SEL_FG_SGR = "\x1b[38;2;235;235;235m";

export function rgbSgrFg(r: number, g: number, b: number): string {
  return `\x1b[38;2;${r};${g};${b}m`;
}

export function rgbSgrBg(r: number, g: number, b: number): string {
  return `\x1b[48;2;${r};${g};${b}m`;
}

/** 亮度（0–255）→ 前景黑/白 */
export function contrastFg(r: number, g: number, b: number): string {
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 140 ? "\x1b[38;2;16;16;16m" : "\x1b[38;2;255;255;255m";
}
