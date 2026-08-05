/**
 * Per-card canvas face painters using canvas-ui (pixel HUD).
 * Pure paint helpers — no React; unit-testable with node-canvas-less 2d mocks.
 */
import { CanvasUi, GALLERY_THEME, pixelText } from "../canvas-ui";
import type { DockCanvasPaintInput } from "./types";

/** Size a canvas to CSS pixels (devicePixelRatio-aware when window present). */
export function sizeCanvasToCss(
  canvas: HTMLCanvasElement,
  cssW: number,
  cssH: number,
): { w: number; h: number; dpr: number } {
  const dpr =
    typeof window !== "undefined" && window.devicePixelRatio
      ? Math.min(2, window.devicePixelRatio)
      : 1;
  const w = Math.max(1, Math.floor(cssW * dpr));
  const h = Math.max(1, Math.floor(cssH * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  canvas.style.width = `${Math.max(1, Math.floor(cssW))}px`;
  canvas.style.height = `${Math.max(1, Math.floor(cssH))}px`;
  return { w, h, dpr };
}

/**
 * Paint a dock board face with canvas-ui panel + scrolled lines.
 * Uses logical coordinates after setTransform(dpr).
 */
export function paintDockCanvasUiFace(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  input: DockCanvasPaintInput,
  dpr = 1,
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  // Transparent-friendly base so folder SVG fill can show through if needed
  ctx.fillStyle = "rgba(20, 18, 16, 0.55)";
  ctx.fillRect(0, 0, cssW, cssH);

  const ui = new CanvasUi(GALLERY_THEME);
  ui.beginFrame();
  const pad = 6;
  const panelW = Math.max(40, cssW - pad * 2);
  const panelH = Math.max(32, cssH - pad * 2);
  ui.panel(ctx, { x: pad, y: pad, w: panelW, h: panelH }, input.title);

  const accent = input.accent ?? GALLERY_THEME.accent;
  ctx.fillStyle = accent;
  ctx.fillRect(pad + 4, pad + 24, Math.min(48, panelW - 8), 3);

  const lineStartY = pad + 36;
  const lineH = 12;
  const maxLines = Math.max(1, Math.floor((panelH - 44) / lineH));
  const lines = input.lines.length ? input.lines : ["(empty)"];
  const slice = lines.slice(0, maxLines);
  for (let i = 0; i < slice.length; i++) {
    const raw = slice[i] ?? "";
    const text = raw.length > 42 ? `${raw.slice(0, 40)}…` : raw;
    pixelText(ctx, text, pad + 10, lineStartY + i * lineH, GALLERY_THEME.text, 1);
  }

  if (typeof input.count === "number") {
    const label = `#${input.count}`;
    pixelText(
      ctx,
      label,
      pad + panelW - 36,
      pad + 14,
      GALLERY_THEME.borderHi,
      1,
    );
  }
}

/** Build paint lines for a card id from simple string bags (host supplies data). */
export function linesForDockCard(
  id: string,
  bags: {
    logs?: string[];
    termLines?: string[];
    taskLines?: string[];
    agentLines?: string[];
  },
): string[] {
  switch (id) {
    case "logs":
      return bags.logs?.length ? bags.logs : ["no logs"];
    case "terminal":
      return bags.termLines?.length ? bags.termLines : ["$ ready"];
    case "tasks":
      return bags.taskLines?.length ? bags.taskLines : ["no tasks"];
    case "agent":
      return bags.agentLines?.length ? bags.agentLines : ["idle"];
    case "proactive":
      return bags.taskLines?.length
        ? bags.taskLines
        : ["主动智能 · 扫描 / 看板 / 派发"];
    default:
      return ["—"];
  }
}
