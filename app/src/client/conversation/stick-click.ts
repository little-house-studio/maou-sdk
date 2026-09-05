/** Child controls keep their own click. The stick itself is also role=button. */
export const STICK_CHILD_INTERACTIVE =
  'a, button, [role="button"], input, textarea, select';

/** Jump home unless the event landed on a nested control (not the stick). */
export function stickClickGoesHome(
  hit: EventTarget | null,
  stick: EventTarget | null,
): boolean {
  return hit == null || hit === stick;
}

/** Selecting text inside the stick should not jump. */
export function stickHasTextSelection(root: EventTarget | null): boolean {
  if (typeof window === "undefined" || !(root instanceof Node)) return false;
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
  const node = sel.anchorNode;
  return Boolean(node && root.contains(node));
}
