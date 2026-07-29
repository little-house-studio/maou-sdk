/**
 * CanvasUI — 轻量 canvas 像素风 UI 原语（按钮 / 条 / 面板）
 * 复古地牢 HUD：石板 / 火把琥珀 / 羊皮纸，供 DungeonLab 与 DOM HUD 并列演示。
 */

export type Color = string;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface UiTheme {
  bg: Color;
  panel: Color;
  border: Color;
  borderHi: Color;
  text: Color;
  muted: Color;
  accent: Color;
  danger: Color;
  shadow: Color;
}

/** 暖色复古地牢：深褐石、琥珀火光、羊皮纸字 */
export const DUNGEON_THEME: UiTheme = {
  bg: "#1a1410",
  panel: "#2a2218",
  border: "#5a4a32",
  borderHi: "#d4a574",
  text: "#e8dcc8",
  muted: "#9a8a70",
  accent: "#c4783a",
  danger: "#b84a3a",
  shadow: "#0c0a08",
};

export type HitId = string;

export interface HitRegion {
  id: HitId;
  rect: Rect;
}

/** 有序 Bayer 4x4 矩阵（0..15），用于 dither */
export const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

export class CanvasUi {
  theme: UiTheme;
  private hits: HitRegion[] = [];
  private hoverId: HitId | null = null;
  private pressedId: HitId | null = null;
  private onClick: ((id: HitId) => void) | null = null;

  constructor(theme: UiTheme = DUNGEON_THEME) {
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
    // 石板角钉
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
    const tw = label.length * 6;
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
    const w = Math.max(0, Math.floor((r.w - 4) * Math.min(1, Math.max(0, ratio))));
    fillRect(ctx, r.x + 2, r.y + 2, w, r.h - 4, fill);
    if (label) pixelText(ctx, label, r.x + 4, r.y + r.h - 3, t.text, 1);
  }
}

function pointIn(x: number, y: number, r: Rect) {
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
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

/** 极简 5x7 位图字体（仅 A-Z 0-9 空格与少量符号） */
const FONT: Record<string, number[]> = {
  " ": [0, 0, 0, 0, 0],
  A: [0x0e, 0x11, 0x1f, 0x11, 0x11],
  B: [0x1e, 0x11, 0x1e, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x11, 0x0e],
  D: [0x1e, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x1e, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x1e, 0x10, 0x10],
  G: [0x0e, 0x10, 0x13, 0x11, 0x0e],
  H: [0x11, 0x11, 0x1f, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x0e],
  K: [0x11, 0x12, 0x1c, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x1e, 0x10, 0x10],
  R: [0x1e, 0x11, 0x1e, 0x12, 0x11],
  S: [0x0f, 0x10, 0x0e, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x15, 0x1b, 0x11],
  X: [0x11, 0x0a, 0x04, 0x0a, 0x11],
  Y: [0x11, 0x0a, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x02, 0x04, 0x08, 0x1f],
  "0": [0x0e, 0x13, 0x15, 0x19, 0x0e],
  "1": [0x04, 0x0c, 0x04, 0x04, 0x0e],
  "2": [0x0e, 0x11, 0x02, 0x08, 0x1f],
  "3": [0x1e, 0x01, 0x06, 0x01, 0x1e],
  "4": [0x02, 0x06, 0x0a, 0x1f, 0x02],
  "5": [0x1f, 0x10, 0x1e, 0x01, 0x1e],
  "6": [0x06, 0x08, 0x1e, 0x11, 0x0e],
  "7": [0x1f, 0x01, 0x02, 0x04, 0x08],
  "8": [0x0e, 0x11, 0x0e, 0x11, 0x0e],
  "9": [0x0e, 0x11, 0x0f, 0x01, 0x0c],
  ":": [0x00, 0x04, 0x00, 0x04, 0x00],
  "/": [0x01, 0x02, 0x04, 0x08, 0x10],
  "-": [0x00, 0x00, 0x1f, 0x00, 0x00],
  "!": [0x04, 0x04, 0x04, 0x00, 0x04],
  "?": [0x0e, 0x11, 0x02, 0x00, 0x04],
  ".": [0x00, 0x00, 0x00, 0x00, 0x04],
  "*": [0x00, 0x0a, 0x04, 0x0a, 0x00],
  "+": [0x00, 0x04, 0x1f, 0x04, 0x00],
  "[": [0x0e, 0x08, 0x08, 0x08, 0x0e],
  "]": [0x0e, 0x02, 0x02, 0x02, 0x0e],
};

export function pixelText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: Color,
  scale = 1,
) {
  ctx.fillStyle = color;
  let cx = Math.floor(x);
  const baseY = Math.floor(y) - 5 * scale;
  for (const ch of text.toUpperCase()) {
    const g = FONT[ch] ?? FONT["?"]!;
    for (let row = 0; row < 5; row++) {
      const bits = g[row] ?? 0;
      for (let col = 0; col < 5; col++) {
        if (bits & (1 << (4 - col))) {
          ctx.fillRect(cx + col * scale, baseY + row * scale, scale, scale);
        }
      }
    }
    cx += 6 * scale;
  }
}

/**
 * 4-level 有序 dither：暖色地牢调色板（深褐 / 石 / 琥珀 / 羊皮纸）
 * 在独立 offscreen 上做，避免污染主 canvas 状态。
 */
export function applyOrderedDither(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  levels = 4,
) {
  let img: ImageData;
  try {
    img = ctx.getImageData(0, 0, w, h);
  } catch {
    return;
  }
  const d = img.data;
  // ink-wash dungeon: near-black → stone → torch amber → parchment
  const pal = [
    [12, 10, 8],
    [58, 48, 36],
    [140, 96, 48],
    [212, 180, 120],
    [232, 220, 200],
  ];
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
