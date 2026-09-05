/**
 * 中栏侧空白 / 输入条两侧：滚轮交给线程滚动口。
 * 提问框等内嵌滚动还能动时不抢。
 */
import { THREAD_SCROLL_ATTR } from "./contract";
import { wheelDeltaPx } from "./nested-wheel";
import { wheelStaysInScroller } from "./scroll-offset";

export function paneWheelAction(
  inThread: boolean,
  inner: { scrollHeight: number; scrollTop: number; clientHeight: number } | null,
  deltaY: number,
): "native" | "forward" {
  if (inThread) return "native";
  if (inner && wheelStaysInScroller(inner, deltaY)) return "native";
  return "forward";
}

export function overflowYScrolls(el: HTMLElement): boolean {
  const oy = getComputedStyle(el).overflowY;
  return (oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 1;
}

export function nearestYScroller(
  from: EventTarget | null,
  stop: Element,
): HTMLElement | null {
  let n: Node | null = from instanceof Node ? from : null;
  while (n && n !== stop) {
    if (n instanceof HTMLElement && overflowYScrolls(n)) return n;
    n = n.parentNode;
  }
  return null;
}

export function applyPaneWheel(host: HTMLElement, e: WheelEvent): boolean {
  const thread = host.querySelector(`[${THREAD_SCROLL_ATTR}]`);
  if (!(thread instanceof HTMLElement)) return false;
  const target = e.target;
  const inThread = target instanceof Node && thread.contains(target);
  const inner = nearestYScroller(target, host);
  const box =
    inner && inner !== thread && inner !== host
      ? inner
      : null;
  if (paneWheelAction(inThread, box, e.deltaY) !== "forward") return false;
  e.preventDefault();
  thread.scrollTop += wheelDeltaPx(e.deltaY, e.deltaMode, thread.clientHeight);
  return true;
}
