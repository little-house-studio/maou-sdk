/**
 * 提问框内嵌滚动：同一手势滚到边就锁住外层；停一下后再滚交给上下文。
 */

import { THREAD_SCROLL_ATTR } from "./contract";
import { wheelStaysInScroller } from "./scroll-offset";

/** 两次 wheel 间隔超过此时长视为新一轮手势。 */
export const NESTED_WHEEL_GESTURE_MS = 48;

/** 顶到边后的回弹小于此像素，不重新武装内框。 */
export const NESTED_WHEEL_REARM_PX = 12;

export type NestedWheelKind = "inner" | "lock" | "outer";

export type NestedWheelLatch = {
  held: boolean;
  primed: boolean;
  dir: -1 | 0 | 1;
};

export function emptyNestedWheelLatch(): NestedWheelLatch {
  return { held: false, primed: false, dir: 0 };
}

function wheelSign(deltaY: number): -1 | 0 | 1 {
  if (deltaY > 0) return 1;
  if (deltaY < 0) return -1;
  return 0;
}

export function nestedWheelKind(
  box: { scrollHeight: number; scrollTop: number; clientHeight: number },
  deltaY: number,
  latch: NestedWheelLatch,
): NestedWheelKind {
  const sign = wheelSign(deltaY);
  if (sign === 0) return latch.held ? "lock" : "inner";
  if (wheelStaysInScroller(box, deltaY)) {
    if (latch.primed && Math.abs(deltaY) < NESTED_WHEEL_REARM_PX) return "lock";
    return "inner";
  }
  if (latch.held) return "lock";
  return "outer";
}

export function resolveNestedClipWheel(
  box: { scrollHeight: number; scrollTop: number; clientHeight: number },
  deltaY: number,
  latch: NestedWheelLatch,
): NestedWheelKind {
  const sign = wheelSign(deltaY);
  if (sign === 0) return nestedWheelKind(box, deltaY, latch);

  const kind = nestedWheelKind(box, deltaY, latch);
  if (kind === "inner") {
    latch.held = true;
    latch.primed = false;
    latch.dir = sign;
    return kind;
  }
  if (kind === "lock") {
    latch.primed = true;
    latch.dir = sign;
    return kind;
  }
  latch.primed = false;
  latch.dir = 0;
  return kind;
}

export function endNestedClipWheel(latch: NestedWheelLatch): void {
  latch.held = false;
}

export function wheelDeltaPx(
  deltaY: number,
  deltaMode: number,
  pageHeight: number,
): number {
  if (deltaMode === 1) return deltaY * 16;
  if (deltaMode === 2) return deltaY * pageHeight;
  return deltaY;
}

export function scrollThreadByWheel(
  inner: HTMLElement,
  deltaY: number,
  deltaMode: number,
): void {
  const scroller = inner.closest(`[${THREAD_SCROLL_ATTR}]`);
  if (!(scroller instanceof HTMLElement)) return;
  scroller.scrollTop += wheelDeltaPx(deltaY, deltaMode, scroller.clientHeight);
}
