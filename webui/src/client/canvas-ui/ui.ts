/**
 * CanvasUi — pixel HUD widgets (panel / button / bar) drawn to Canvas2D.
 */

import { fillRect, pointIn, strokeRectPixel, type Rect } from "./draw";
import { measurePixelText, pixelText } from "./font";
import { GALLERY_THEME, type Color, type UiTheme } from "./theme";

export type HitId = string;

export interface HitRegion {
  id: HitId;
  rect: Rect;
}

export class CanvasUi {
  theme: UiTheme;
  private hits: HitRegion[] = [];
  private hoverId: HitId | null = null;
  private pressedId: HitId | null = null;
  private onClick: ((id: HitId) => void) | null = null;

  constructor(theme: UiTheme = GALLERY_THEME) {
    this.theme = theme;
  }

  setClickHandler(fn: (id: HitId) => void) {
    this.onClick = fn;
  }

  beginFrame() {
    this.hits = [];
  }

  setPointer(x: number, y: number, down: boolean) {
    const prev = this.hoverId;
    this.hoverId = null;
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i]!;
      if (pointIn(x, y, h.rect)) {
        this.hoverId = h.id;
        break;
      }
    }
    if (down && this.hoverId) this.pressedId = this.hoverId;
    if (!down && this.pressedId) {
      if (this.pressedId === this.hoverId) this.onClick?.(this.pressedId);
      this.pressedId = null;
    }
    return this.hoverId !== prev || this.pressedId != null;
  }

  panel(ctx: CanvasRenderingContext2D, r: Rect, title?: string) {
    const t = this.theme;
    fillRect(ctx, r.x + 2, r.y + 2, r.w, r.h, t.shadow);
    fillRect(ctx, r.x, r.y, r.w, r.h, t.panel);
    strokeRectPixel(ctx, r.x, r.y, r.w, r.h, t.border, 2);
    fillRect(ctx, r.x, r.y, 3, 3, t.borderHi);
    fillRect(ctx, r.x + r.w - 3, r.y, 3, 3, t.borderHi);
    fillRect(ctx, r.x, r.y + r.h - 3, 3, 3, t.borderHi);
    fillRect(ctx, r.x + r.w - 3, r.y + r.h - 3, 3, 3, t.borderHi);
    if (title) {
      pixelText(ctx, title, r.x + 8, r.y + 14, t.borderHi, 1);
      fillRect(ctx, r.x + 6, r.y + 20, r.w - 12, 1, t.border);
    }
  }

  button(
    ctx: CanvasRenderingContext2D,
    id: HitId,
    r: Rect,
    label: string,
  ): void {
    this.hits.push({ id, rect: r });
    const hot = this.hoverId === id;
    const press = this.pressedId === id;
    const t = this.theme;
    const y = press ? r.y + 1 : r.y;
    fillRect(ctx, r.x + 1, y + 1, r.w, r.h, t.shadow);
    fillRect(ctx, r.x, y, r.w, r.h, hot ? t.accent : t.panel);
    strokeRectPixel(ctx, r.x, y, r.w, r.h, hot ? t.borderHi : t.border, 2);
    const tw = measurePixelText(label, 1);
    pixelText(
      ctx,
      label,
      r.x + Math.max(4, (r.w - tw) / 2),
      y + r.h / 2 + 3,
      hot ? t.bg : t.text,
      1,
    );
  }

  bar(
    ctx: CanvasRenderingContext2D,
    r: Rect,
    ratio: number,
    fill: Color,
    label?: string,
  ) {
    const t = this.theme;
    fillRect(ctx, r.x, r.y, r.w, r.h, t.shadow);
    strokeRectPixel(ctx, r.x, r.y, r.w, r.h, t.border, 1);
    const w = Math.max(
      0,
      Math.floor((r.w - 4) * Math.min(1, Math.max(0, ratio))),
    );
    fillRect(ctx, r.x + 2, r.y + 2, w, r.h - 4, fill);
    if (label) pixelText(ctx, label, r.x + 4, r.y + r.h - 3, t.text, 1);
  }
}
