import type { Color } from "./theme";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function fillRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: Color,
) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.floor(x), Math.floor(y), Math.floor(w), Math.floor(h));
}

export function strokeRectPixel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: Color,
  width = 1,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.strokeRect(
    Math.floor(x) + 0.5,
    Math.floor(y) + 0.5,
    Math.floor(w) - 1,
    Math.floor(h) - 1,
  );
}

export function pointIn(x: number, y: number, r: Rect) {
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}
