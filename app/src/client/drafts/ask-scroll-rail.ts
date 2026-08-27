/** Ask-mark rail: tick each user question on the thread scrollbar. */

export { ASK_PREVIEW_MAX, clipAskPreview } from "../conversation/ask-preview";
import { clipAskPreview } from "../conversation/ask-preview";

export const ASK_THUMB_MIN = 24;
export const ASK_GUTTER_PX = 24;
/** Rail sits inset from the thread top/bottom so the bar is shorter. */
export const ASK_TRACK_INSET = 16;

export function canShowAskRail(
  scrollHeight: number,
  clientHeight: number,
): boolean {
  return scrollHeight > clientHeight + 1;
}

export function askTickTop(
  offsetTop: number,
  scrollHeight: number,
  trackHeight: number,
): number {
  if (scrollHeight <= 0 || trackHeight <= 0) return 0;
  const y = (offsetTop / scrollHeight) * trackHeight;
  const edge = 2;
  return Math.max(edge, Math.min(trackHeight - edge, y));
}

export function scrollThumbLayout(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  trackHeight: number,
  minThumb = ASK_THUMB_MIN,
): { top: number; height: number } | null {
  if (!canShowAskRail(scrollHeight, clientHeight) || trackHeight <= 0) {
    return null;
  }
  const height = Math.min(
    trackHeight,
    Math.max(minThumb, (clientHeight / scrollHeight) * trackHeight),
  );
  const maxTop = Math.max(0, trackHeight - height);
  const range = scrollHeight - clientHeight;
  const top = range <= 0 ? 0 : (scrollTop / range) * maxTop;
  return {
    top: Math.max(0, Math.min(maxTop, top)),
    height,
  };
}

export type AskMark = {
  id: string;
  preview: string;
  offsetTop: number;
  top: number;
};

export function layoutAskMarks(
  marks: Array<{ id: string; preview: string; offsetTop: number }>,
  scrollHeight: number,
  trackHeight: number,
): AskMark[] {
  return marks.map((m) => ({
    ...m,
    preview: clipAskPreview(m.preview),
    top: askTickTop(m.offsetTop, scrollHeight, trackHeight),
  }));
}

/** In-flow offset. Ignores sticky visual shift so rail ticks stay put. */
export function offsetInScroll(el: HTMLElement, root: HTMLElement): number {
  let y = 0;
  let n: HTMLElement | null = el;
  while (n && n !== root) {
    y += n.offsetTop;
    const parent = n.offsetParent as HTMLElement | null;
    if (!parent || parent === root) break;
    if (root.contains(parent)) {
      n = parent;
      continue;
    }
    let r: HTMLElement | null = root;
    let rootY = 0;
    while (r && r !== parent) {
      rootY += r.offsetTop;
      const rp = r.offsetParent as HTMLElement | null;
      if (!rp || rp === parent) break;
      r = rp;
    }
    y -= rootY;
    break;
  }
  return Math.max(0, y);
}

export function pointerOverAskGutter(
  clientX: number,
  clientY: number,
  rect: { left: number; right: number; top: number; bottom: number },
  gutter = ASK_GUTTER_PX,
): boolean {
  return (
    clientY >= rect.top &&
    clientY <= rect.bottom &&
    clientX >= rect.right - gutter &&
    clientX <= rect.right + 2
  );
}

/** Pick the tick nearest to the pointer; null when farther than maxDist. */
export function nearestTickTop(
  tops: readonly number[],
  pointerY: number,
  maxDist = 14,
): number | null {
  let best: number | null = null;
  let bestDist = Infinity;
  for (const top of tops) {
    const d = Math.abs(top - pointerY);
    if (d < bestDist) {
      bestDist = d;
      best = top;
    }
  }
  return best != null && bestDist <= maxDist ? best : null;
}
