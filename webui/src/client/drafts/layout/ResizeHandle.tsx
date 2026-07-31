import { useCallback, useEffect, useRef, useState } from "react";

export type ResizeHandleProps = {
  /** Which edge is being dragged (affects cursor + delta sign) */
  edge: "left" | "right";
  /** Current size of the panel being resized (px) */
  size: number;
  min: number;
  max: number;
  onResize: (next: number) => void;
  /** Accessible name */
  label: string;
  className?: string;
};

/**
 * Drag strip between panels. `edge: "right"` = grow when pointer moves right
 * (sidebar right edge). `edge: "left"` = grow when pointer moves left
 * (rail left edge — width increases as x decreases).
 */
export function ResizeHandle({
  edge,
  size,
  min,
  max,
  onResize,
  label,
  className = "",
}: ResizeHandleProps) {
  const startX = useRef(0);
  const startSize = useRef(0);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      startX.current = e.clientX;
      startSize.current = size;
      setDragging(true);
    },
    [size],
  );

  useEffect(() => {
    if (!dragging) return;

    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - startX.current;
      const delta = edge === "right" ? dx : -dx;
      const next = Math.min(max, Math.max(min, startSize.current + delta));
      onResize(next);
    };

    const onUp = () => setDragging(false);

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [dragging, edge, min, max, onResize]);

  return (
    <div
      className={`draft-resize-handle draft-resize-${edge}${
        dragging ? " is-dragging" : ""
      } ${className}`.trim()}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(size)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 24 : 8;
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          onResize(
            Math.min(
              max,
              Math.max(min, size + (edge === "right" ? -step : step)),
            ),
          );
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          onResize(
            Math.min(
              max,
              Math.max(min, size + (edge === "right" ? step : -step)),
            ),
          );
        }
      }}
    />
  );
}
