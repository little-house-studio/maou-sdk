/**
 * Per-card free canvas face for expanded dock boards.
 * - canvas-ui: pixel HUD paint loop
 * - html-canvas: optional HTML-in-canvas polyfill sample (soft fail → visible HTML)
 */
import React, { useEffect, useRef, useState } from "react";
import {
  linesForDockCard,
  paintDockCanvasUiFace,
  sizeCanvasToCss,
} from "./canvas-host";
import {
  loadHtmlInCanvasPolyfill,
  tryDrawHtmlElementToCanvas,
} from "./html-canvas";
import type { DockContentKind, DockCanvasPaintInput } from "./types";
import type { DockCardId } from "./ids";

export type DockCanvasFaceProps = {
  cardId: DockCardId;
  contentKind: DockContentKind;
  title: string;
  count?: number;
  accent?: string;
  logs?: string[];
  termLines?: string[];
  taskLines?: string[];
  agentLines?: string[];
  /** CSS size of the face (board body). */
  width: number;
  height: number;
};

export function DockCanvasFace({
  cardId,
  contentKind,
  title,
  count,
  accent,
  logs,
  termLines,
  taskLines,
  agentLines,
  width,
  height,
}: DockCanvasFaceProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const htmlSampleRef = useRef<HTMLDivElement | null>(null);
  const [polyOk, setPolyOk] = useState(false);
  const [polyDrawn, setPolyDrawn] = useState(false);

  const lines = linesForDockCard(cardId, {
    logs,
    termLines,
    taskLines,
    agentLines,
  });

  // Soft-load polyfill only for html-canvas cards
  useEffect(() => {
    if (contentKind !== "html-canvas") return;
    let cancelled = false;
    void loadHtmlInCanvasPolyfill().then((r) => {
      if (!cancelled) setPolyOk(r.ok);
    });
    return () => {
      cancelled = true;
    };
  }, [contentKind]);

  // canvas-ui paint path
  useEffect(() => {
    if (contentKind !== "canvas-ui") return;
    const canvas = canvasRef.current;
    if (!canvas || width < 8 || height < 8) return;
    const { dpr } = sizeCanvasToCss(canvas, width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const cssAccent = getComputedStyle(canvas)
      .getPropertyValue("--dock-fill")
      .trim();
    const input: DockCanvasPaintInput = {
      id: cardId,
      title,
      lines,
      count,
      accent:
        cssAccent ||
        (accent && !accent.startsWith("var(") ? accent : undefined),
    };
    paintDockCanvasUiFace(ctx, width, height, input, dpr);
  }, [
    contentKind,
    cardId,
    title,
    count,
    accent,
    width,
    height,
    lines.join("\n"),
  ]);

  // html-in-canvas sample loop (DungeonLab pattern)
  useEffect(() => {
    if (contentKind !== "html-canvas" || !polyOk) {
      setPolyDrawn(false);
      return;
    }
    const canvas = canvasRef.current;
    const sample = htmlSampleRef.current;
    if (!canvas || !sample || width < 8 || height < 8) return;

    let cancelled = false;
    let raf = 0;
    let fails = 0;

    const tick = () => {
      if (cancelled) return;
      sizeCanvasToCss(canvas, width, height);
      const ok = tryDrawHtmlElementToCanvas(canvas, sample, width, height);
      if (ok) {
        fails = 0;
        setPolyDrawn(true);
      } else {
        fails++;
        if (fails > 3) setPolyDrawn(false);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [contentKind, polyOk, width, height, title, lines.join("\n")]);

  if (contentKind === "react") {
    return null;
  }

  const showHtmlFallback =
    contentKind === "html-canvas" && (!polyOk || !polyDrawn);

  return (
    <div
      className="wire-dock-canvas-face"
      data-dock-canvas-face={cardId}
      data-dock-content-kind={contentKind}
      data-dock-polyfill={polyOk ? "ok" : "off"}
      data-dock-poly-drawn={polyDrawn ? "true" : "false"}
      style={{ width, height, position: "relative" }}
    >
      <canvas
        ref={canvasRef}
        className="wire-dock-card-canvas"
        data-dock-canvas-host={cardId}
        {...(contentKind === "html-canvas"
          ? ({ layoutsubtree: "" } as React.HTMLAttributes<HTMLCanvasElement>)
          : null)}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          imageRendering: "pixelated",
        }}
      />
      {/* HTML sample node for polyfill sampling; also visible fallback */}
      {contentKind === "html-canvas" ? (
        <div
          ref={htmlSampleRef}
          className={`wire-dock-html-sample${
            showHtmlFallback ? " is-visible-fallback" : " is-poly-source"
          }`}
          data-dock-html-sample={cardId}
          aria-hidden={!showHtmlFallback}
        >
          <header className="wire-dock-html-sample-head">{title}</header>
          <ul className="wire-dock-html-sample-list">
            {lines.slice(0, 12).map((ln, i) => (
              <li key={i}>{ln}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
