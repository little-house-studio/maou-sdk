/**
 * CPU ordered dither (Canvas2D getImageData).
 * Prefer ThreeFilterPipeline for realtime 3D.
 */

import { BAYER4 } from "./bayer";
import { FILTER_PALETTE } from "../theme";

export type Rgb = readonly [number, number, number];

export interface OrderedDitherOptions {
  levels?: number;
  /** Custom palette light→dark or dark→light (first = darkest) */
  palette?: Rgb[];
}

const DEFAULT_PAL: Rgb[] = [
  FILTER_PALETTE.inkRgb,
  [58, 48, 36],
  [140, 96, 48],
  [212, 180, 120],
  FILTER_PALETTE.paperRgb,
];

export function applyOrderedDither(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts: OrderedDitherOptions = {},
) {
  let img: ImageData;
  try {
    img = ctx.getImageData(0, 0, w, h);
  } catch {
    return;
  }
  const d = img.data;
  const levels = opts.levels ?? 4;
  const pal = opts.palette ?? DEFAULT_PAL;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = d[i]!;
      const g = d[i + 1]!;
      const b = d[i + 2]!;
      const lum = (r * 0.3 + g * 0.59 + b * 0.11) / 255;
      const thr = (BAYER4[y & 3]![x & 3]! + 0.5) / 16;
      let li = Math.floor(lum * levels + thr * 0.35);
      if (li < 0) li = 0;
      if (li >= pal.length) li = pal.length - 1;
      const p = pal[li]!;
      d[i] = p[0]!;
      d[i + 1] = p[1]!;
      d[i + 2] = p[2]!;
    }
  }
  ctx.putImageData(img, 0, 0);
}
