/**
 * canvas-ui — pixel HUD + high-performance dither/ASCII filters
 *
 * @example Canvas2D UI
 * ```ts
 * import { CanvasUi, GALLERY_THEME, applyOrderedDither } from "./canvas-ui";
 * const ui = new CanvasUi(GALLERY_THEME);
 * ui.panel(ctx, { x: 8, y: 8, w: 120, h: 40 }, "STATUS");
 * ui.button(ctx, "ok", { x: 8, y: 56, w: 48, h: 16 }, "OK");
 * applyOrderedDither(ctx, w, h);
 * ```
 *
 * @example three.js GPU filter
 * ```ts
 * import { ThreeFilterPipeline } from "./canvas-ui";
 * const filter = new ThreeFilterPipeline(renderer, scene, camera);
 * filter.setMode("both");
 * filter.render(); // each frame
 * ```
 */

export const CANVAS_UI_VERSION = "0.1.0";
export const CANVAS_UI_NAME = "canvas-ui";

export type { Color, UiTheme } from "./theme";
export { GALLERY_THEME, DUNGEON_THEME, FILTER_PALETTE } from "./theme";

export type { Rect } from "./draw";
export { fillRect, strokeRectPixel, pointIn } from "./draw";

export { FONT, pixelText, measurePixelText } from "./font";

export type { HitId, HitRegion } from "./ui";
export { CanvasUi } from "./ui";

export { BAYER4, bayer4Threshold } from "./dither/bayer";
export {
  applyOrderedDither,
  type OrderedDitherOptions,
  type Rgb,
} from "./dither/cpu-ordered";
export { ASCII_RAMP, buildGlyphAtlas } from "./dither/ascii-atlas";
export {
  ThreeFilterPipeline,
  AsciiDitherPipeline,
  type FilterMode,
  type AsciiMode,
  type ThreeFilterOptions,
} from "./dither/three-filter";
