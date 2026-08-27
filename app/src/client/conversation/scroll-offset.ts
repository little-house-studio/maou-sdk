import { THREAD_SCROLL_ATTR } from "./contract";

export type StackPrev = {
  height: number;
  marginTop: number;
  marginBottom: number;
};

/** In-flow Y of a child after previous stacked siblings (flex column / block). */
export function stackFlowOffset(
  paddingTop: number,
  gap: number,
  prev: readonly StackPrev[],
): number {
  let y = paddingTop;
  for (const p of prev) {
    y += p.height + p.marginTop + p.marginBottom;
  }
  if (prev.length > 0) y += gap * prev.length;
  return y;
}

function columnGap(ps: CSSStyleDeclaration): number {
  const display = ps.display;
  const flexCol =
    (display === "flex" || display === "inline-flex") &&
    (ps.flexDirection === "column" || ps.flexDirection === "column-reverse");
  if (flexCol || display === "grid") return parseFloat(ps.rowGap) || 0;
  return 0;
}

function isOutOfFlow(cs: CSSStyleDeclaration): boolean {
  return (
    cs.display === "none" ||
    cs.position === "absolute" ||
    cs.position === "fixed"
  );
}

function isStickyPosition(el: HTMLElement): boolean {
  return getComputedStyle(el).position === "sticky";
}

function inFlowOffsetInParent(el: HTMLElement, parent: HTMLElement): number {
  const ps = getComputedStyle(parent);
  const prev: StackPrev[] = [];
  for (const child of parent.children) {
    if (child === el) break;
    if (!(child instanceof HTMLElement)) continue;
    const cs = getComputedStyle(child);
    if (isOutOfFlow(cs)) continue;
    prev.push({
      height: child.offsetHeight,
      marginTop: parseFloat(cs.marginTop) || 0,
      marginBottom: parseFloat(cs.marginBottom) || 0,
    });
  }
  return stackFlowOffset(parseFloat(ps.paddingTop) || 0, columnGap(ps), prev);
}

function offsetTopToward(el: HTMLElement, ancestor: HTMLElement): number {
  let y = 0;
  let n: HTMLElement | null = el;
  while (n && n !== ancestor) {
    y += n.offsetTop;
    const parent = n.offsetParent as HTMLElement | null;
    if (!parent || parent === ancestor) break;
    n = parent;
  }
  return y;
}

/** In-flow offset inside a scroller. Sticky nodes use sibling stack, not used offsetTop. */
export function offsetInScroll(el: HTMLElement, root: HTMLElement): number {
  let y = 0;
  let n: HTMLElement | null = el;
  while (n && n !== root) {
    if (isStickyPosition(n)) {
      const parent = n.parentElement;
      if (!parent) break;
      y += inFlowOffsetInParent(n, parent);
      if (parent === root) break;
      n = parent;
      continue;
    }
    const parent = n.offsetParent as HTMLElement | null;
    y += n.offsetTop;
    if (!parent || parent === root) break;
    if (root.contains(parent)) {
      n = parent;
      continue;
    }
    y -= offsetTopToward(root, parent);
    break;
  }
  return Math.max(0, y);
}

/** ScrollTop that pins a stuck stick back to its in-flow home. Null if not stuck. */
export function stickHomeScrollTop(
  flowTop: number,
  scrollTop: number,
  maxScrollTop: number,
): number | null {
  if (scrollTop <= flowTop + 1) return null;
  const y = Math.max(0, Math.round(flowTop));
  const max = Math.max(0, Math.round(maxScrollTop));
  return Math.max(0, Math.min(max, y));
}

export function scrollStickHome(stick: HTMLElement): void {
  const scroller = stick.closest(`[${THREAD_SCROLL_ATTR}]`);
  if (!(scroller instanceof HTMLElement)) return;
  const max = scroller.scrollHeight - scroller.clientHeight;
  const next = stickHomeScrollTop(
    offsetInScroll(stick, scroller),
    scroller.scrollTop,
    max,
  );
  if (next == null) return;
  scroller.scrollTop = next;
}
