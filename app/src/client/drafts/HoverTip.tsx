/**
 * Shared hover preview: 100ms open delay, grows from the right edge,
 * folds back on leave. Portals into `.wire-shell` so sheet tokens apply.
 */
import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export const HOVER_TIP_OPEN_MS = 100;
export const HOVER_TIP_CLOSE_MS = 140;

export type HoverTipSide = "right" | "left" | "auto";

export type HoverTipProps = {
  /** Panel content; empty disables the tip. */
  content: ReactNode;
  /** Screen-reader / closed-state label. */
  label?: string;
  /** Preferred side; "auto" flips when there is no room. */
  side?: HoverTipSide;
  /** Open delay in ms; defaults to HOVER_TIP_OPEN_MS. */
  delayMs?: number;
  children: ReactNode;
  className?: string;
};

type TipPos = { left: number; top: number; side: "right" | "left" };

function placeTip(
  anchor: DOMRect,
  panelW: number,
  panelH: number,
  side: HoverTipSide,
): TipPos {
  const gap = 6;
  const pad = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let resolved: "right" | "left" =
    side === "auto"
      ? anchor.right + gap + panelW <= vw - pad
        ? "right"
        : "left"
      : side;
  let left =
    resolved === "right" ? anchor.right + gap : anchor.left - gap - panelW;
  if (resolved === "right" && left + panelW > vw - pad) {
    resolved = "left";
    left = anchor.left - gap - panelW;
  }
  if (resolved === "left" && left < pad) {
    resolved = "right";
    left = anchor.right + gap;
  }
  left = Math.max(pad, Math.min(left, vw - panelW - pad));
  let top = anchor.top;
  if (top + panelH > vh - pad) top = Math.max(pad, anchor.bottom - panelH);
  top = Math.max(pad, Math.min(top, vh - panelH - pad));
  return { left, top, side: resolved };
}

export function HoverTip({
  content,
  label,
  side = "auto",
  delayMs = HOVER_TIP_OPEN_MS,
  children,
  className = "",
}: HoverTipProps) {
  const uid = useId();
  const panelId = `${uid}-panel`;
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const openTimer = useRef<number>(0);
  const closeTimer = useRef<number>(0);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<TipPos | null>(null);

  const clearTimers = useCallback(() => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
  }, []);

  const show = useCallback(() => {
    if (content == null || content === false) return;
    window.clearTimeout(closeTimer.current);
    openTimer.current = window.setTimeout(() => {
      setMounted(true);
      setOpen(true);
    }, Math.max(0, delayMs));
  }, [content, delayMs]);

  const hide = useCallback(() => {
    window.clearTimeout(openTimer.current);
    setOpen(false);
    closeTimer.current = window.setTimeout(
      () => setMounted(false),
      HOVER_TIP_CLOSE_MS,
    );
  }, []);

  const updatePos = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const panelW = panelRef.current?.offsetWidth ?? 132;
    const panelH = panelRef.current?.offsetHeight ?? 40;
    setPos(placeTip(r, panelW, panelH, side));
  }, [side]);

  useLayoutEffect(() => {
    if (!mounted) return;
    updatePos();
  }, [mounted, updatePos, content]);

  useEffect(() => {
    if (!mounted) return;
    const onScroll = () => hide();
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") hide();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("keydown", onKey);
    };
  }, [mounted, hide]);

  useEffect(() => clearTimers, [clearTimers]);

  if (content == null || content === false) {
    return children;
  }

  const panel = mounted ? (
    <div
      ref={panelRef}
      id={panelId}
      className={`wire-hover-tip-panel${open ? " is-open" : ""}`}
      role="tooltip"
      data-hover-tip-panel=""
      data-side={pos?.side ?? side}
      style={
        pos
          ? {
              position: "fixed",
              left: pos.left,
              top: pos.top,
              zIndex: 10040,
            }
          : {
              position: "fixed",
              left: -9999,
              top: 0,
              visibility: "hidden",
              zIndex: 10040,
            }
      }
    >
      {content}
    </div>
  ) : null;

  return (
    <span
      ref={anchorRef}
      className={`wire-hover-tip${open ? " is-open" : ""}${
        className ? ` ${className}` : ""
      }`}
      aria-label={label}
      aria-describedby={open ? panelId : undefined}
      data-hover-tip=""
      onPointerEnter={show}
      onPointerLeave={hide}
    >
      {children}
      {panel && typeof document !== "undefined"
        ? createPortal(
            panel,
            document.querySelector(".wire-shell") ?? document.body,
          )
        : null}
    </span>
  );
}
