/** Grow/shrink the composer textarea with the draft. */

export const COMPOSER_TEXT_MIN_PX = 56;

export function composerTextMaxPx(
  viewH = typeof window !== "undefined" ? window.innerHeight : 720,
): number {
  return Math.max(COMPOSER_TEXT_MIN_PX, Math.round(viewH / 3));
}

export function fitComposerHeight(el: HTMLTextAreaElement): void {
  el.style.height = "auto";
  const min =
    parseFloat(getComputedStyle(el).minHeight) || COMPOSER_TEXT_MIN_PX;
  const next = Math.min(Math.max(el.scrollHeight, min), composerTextMaxPx());
  el.style.height = `${next}px`;
}
