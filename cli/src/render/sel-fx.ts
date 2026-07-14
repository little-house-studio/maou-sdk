/**
 * 选区视觉 —— 性能优先版。
 *
 * 现策略：
 * - live / settled：纯色计算机蓝底 + 浅字（无渐变、无时间动画）
 * - release：闪白 1 次 → 定格蓝（共 2 次 paint，无 interval）
 */

import { rgbSgrBg, SEL_FG_SGR } from "../hooks/useAnimFrame.js";
import { isLiteNoSelFx } from "../config/lite-mode.js";

export type SelVisualPhase = "none" | "live" | "flash" | "fade" | "settled";

let phase: SelVisualPhase = "none";
let phaseStarted = 0;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;
let paintKick: (() => void) | null = null;

const FLASH_MS = 50;

/** Tau Ceti 计算机深蓝 #2121FF —— 选区唯一底色，无渐变 */
export const SEL_BG_RGB: [number, number, number] = [0x21, 0x21, 0xff];
const SEL_BG_SGR = rgbSgrBg(SEL_BG_RGB[0], SEL_BG_RGB[1], SEL_BG_RGB[2]);

export function bindSelFxPaint(fn: () => void, _fullFn?: () => void): void {
  paintKick = fn;
}

function now(): number {
  return Date.now();
}

function clearReleaseTimer(): void {
  if (releaseTimer) {
    clearTimeout(releaseTimer);
    releaseTimer = null;
  }
}

/** 开始/维持拖选：仅切换 phase，不启动动画定时器 */
export function selFxLive(): void {
  clearReleaseTimer();
  if (phase !== "live") {
    phase = "live";
    phaseStarted = now();
  }
}

/** 松手：闪白 → 蓝底定格（两次 paint，无循环） */
export function selFxRelease(): void {
  if (phase === "none") return;
  clearReleaseTimer();
  // LITE：直接定格，少一次 flash paint
  if (isLiteNoSelFx()) {
    phase = "settled";
    phaseStarted = now();
    paintKick?.();
    return;
  }
  phase = "flash";
  phaseStarted = now();
  paintKick?.();

  releaseTimer = setTimeout(() => {
    releaseTimer = null;
    phase = "settled";
    phaseStarted = now();
    paintKick?.();
  }, FLASH_MS);
}

export function selFxClear(): void {
  phase = "none";
  clearReleaseTimer();
}

export function getSelFxPhase(): SelVisualPhase {
  return phase;
}

/**
 * 选区格子 bg+fg。
 * live / settled：固定计算机蓝 + 浅字；不依赖列、不依赖时间。
 */
export function selCellSgr(_screenCol1based: number): string {
  if (phase === "none") {
    return `${SEL_BG_SGR}${SEL_FG_SGR}`;
  }

  if (phase === "flash") {
    return "\x1b[48;2;220;220;220m\x1b[38;2;20;20;20m";
  }

  // live / fade / settled：同一纯色计算机蓝
  return `${SEL_BG_SGR}${SEL_FG_SGR}`;
}

export function selFxHasActive(): boolean {
  return phase !== "none";
}

/** @deprecated 已无列向渐变；保留 API 兼容，恒为 0 */
export function selFxColPhase(): number {
  return 0;
}
