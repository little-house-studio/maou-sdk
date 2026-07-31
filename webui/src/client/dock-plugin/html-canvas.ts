/**
 * Soft-load HTML-in-canvas polyfill (three-html-render / DungeonLab pattern).
 * Install failure must never crash the dock shell.
 */

export type HtmlInCanvasPolyfillModule = {
  installHtmlInCanvasPolyfill?: (opts?: { force?: boolean }) => void;
};

export type PolyfillLoadResult =
  | { ok: true; mod: HtmlInCanvasPolyfillModule }
  | { ok: false; error: string };

let cached: PolyfillLoadResult | null = null;

/**
 * Dynamic import polyfill once. Safe for SSR (returns ok:false without window).
 */
export async function loadHtmlInCanvasPolyfill(
  forceReload = false,
): Promise<PolyfillLoadResult> {
  if (typeof window === "undefined") {
    return { ok: false, error: "no-window" };
  }
  if (cached && !forceReload) return cached;
  try {
    const mod = (await import(
      /* @vite-ignore */ "three-html-render/polyfill"
    )) as HtmlInCanvasPolyfillModule;
    mod.installHtmlInCanvasPolyfill?.({ force: false });
    cached = { ok: true, mod };
    return cached;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    cached = { ok: false, error: msg };
    return cached;
  }
}

/** Reset cache (tests). */
export function resetHtmlInCanvasPolyfillCache(): void {
  cached = null;
}

export type Ctx2dWithHtml = CanvasRenderingContext2D & {
  drawElementImage?: (
    el: Element,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ) => void;
};

/**
 * Sample a DOM subtree onto a canvas via drawElementImage when polyfill is live.
 * Returns false if API missing or draw throws.
 */
export function tryDrawHtmlElementToCanvas(
  canvas: HTMLCanvasElement,
  sample: HTMLElement,
  w: number,
  h: number,
): boolean {
  const ctx = canvas.getContext("2d") as Ctx2dWithHtml | null;
  if (!ctx || typeof ctx.drawElementImage !== "function") return false;
  try {
    if (sample.parentElement !== canvas) {
      canvas.appendChild(sample);
    }
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.clearRect(0, 0, w, h);
    ctx.drawElementImage(sample, 0, 0, w, h);
    return true;
  } catch {
    return false;
  }
}
