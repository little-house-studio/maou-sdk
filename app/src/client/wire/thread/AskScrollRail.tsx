/**
 * Custom thread rail: square thumb + ask ticks.
 * Ticks hide while the thread is scrolling.
 */
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { ASK_ANCHOR_SEL, readAskAnchor } from "../../conversation/contract";
import { animateScrollTop } from "../../conversation/scroll-offset";
import {
  type AskMark,
  ASK_GUTTER_PX,
  ASK_TRACK_INSET,
  canShowAskRail,
  clipAskPreview,
  layoutAskMarks,
  nearestTickTop,
  offsetInScroll,
  pointerOverAskGutter,
  sameAskMarks,
  scrollThumbLayout,
} from "./ask-scroll-rail";
import { HOVER_TIP_CLOSE_MS } from "./HoverTip";
import { scrollTopToAlignMessage } from "./jump-prev-user";

export type AskScrollRailProps = {
  scrollRef: { readonly current: HTMLElement | null };
  /** Remeasure when the thread list changes. */
  revision?: string;
};

function collectMarks(root: HTMLElement, trackHeight: number): AskMark[] {
  const nodes = root.querySelectorAll<HTMLElement>(ASK_ANCHOR_SEL);
  const raw: Array<{ id: string; preview: string; offsetTop: number }> = [];
  nodes.forEach((node) => {
    const ask = readAskAnchor(node);
    if (!ask) return;
    raw.push({
      id: ask.askId,
      preview: ask.askPreview,
      offsetTop: offsetInScroll(node, root),
    });
  });
  return layoutAskMarks(raw, root.scrollHeight, trackHeight);
}

export function AskScrollRail({ scrollRef, revision }: AskScrollRailProps) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const [scrolling, setScrolling] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [thumb, setThumb] = useState<{
    top: number;
    height: number;
    bottom: number;
  } | null>(null);
  const [marks, setMarks] = useState<AskMark[]>([]);
  const [railBox, setRailBox] = useState<{ top: number; height: number } | null>(
    null,
  );
  const [tip, setTip] = useState<{ mark: AskMark; open: boolean } | null>(null);
  const scrollHide = useRef<number>(0);
  const draggingRef = useRef(false);
  const tipOpenTimer = useRef<number>(0);
  const tipCloseTimer = useRef<number>(0);
  const marksRef = useRef<AskMark[]>([]);
  marksRef.current = marks;

  // 每个 scroll 事件都会进来；值没变就沿用旧对象，别让 rail 每帧重渲染。
  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      setOverflow(false);
      setThumb(null);
      setMarks((prev) => (prev.length === 0 ? prev : []));
      setRailBox(null);
      return;
    }
    const track = Math.max(0, el.clientHeight - ASK_TRACK_INSET * 2);
    setRailBox((prev) =>
      prev && prev.top === ASK_TRACK_INSET && prev.height === track
        ? prev
        : { top: ASK_TRACK_INSET, height: track },
    );
    const shown = canShowAskRail(el.scrollHeight, el.clientHeight);
    setOverflow(shown);
    const next = scrollThumbLayout(
      el.scrollTop,
      el.scrollHeight,
      el.clientHeight,
      track,
    );
    setThumb((prev) => {
      if (!next) return prev === null ? prev : null;
      if (prev && prev.top === next.top && prev.height === next.height) {
        return prev;
      }
      return { ...next, bottom: next.top + next.height };
    });
    const list = shown ? collectMarks(el, track) : [];
    setMarks((prev) => (sameAskMarks(prev, list) ? prev : list));
  }, [scrollRef]);

  const showTip = useCallback((mark: AskMark) => {
    window.clearTimeout(tipCloseTimer.current);
    window.clearTimeout(tipOpenTimer.current);
    setTip({ mark, open: true });
  }, []);

  const hideTip = useCallback(() => {
    window.clearTimeout(tipOpenTimer.current);
    setTip((t) => (t ? { ...t, open: false } : null));
    tipCloseTimer.current = window.setTimeout(
      () => setTip(null),
      HOVER_TIP_CLOSE_MS,
    );
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const paint = window.requestAnimationFrame(() => measure());
    const onScroll = () => {
      setScrolling(true);
      window.clearTimeout(tipOpenTimer.current);
      setTip(null);
      window.clearTimeout(scrollHide.current);
      scrollHide.current = window.setTimeout(() => setScrolling(false), 180);
      measure();
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    const onPointerMove = (e: PointerEvent) => {
      if (draggingRef.current) return;
      const host = railRef.current?.parentElement ?? el;
      setOpen(pointerOverAskGutter(e.clientX, e.clientY, host.getBoundingClientRect()));
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    const onRailMove = (e: PointerEvent) => {
      if (draggingRef.current) return;
      const rail = railRef.current;
      if (!rail) return;
      const list = marksRef.current;
      const y = e.clientY - rail.getBoundingClientRect().top;
      const top = nearestTickTop(list.map((m) => m.top), y);
      const mark = top != null ? list.find((m) => m.top === top) : undefined;
      if (mark) showTip(mark);
      else hideTip();
    };
    const railNode = railRef.current;
    railNode?.addEventListener("pointermove", onRailMove, { passive: true });
    railNode?.addEventListener("pointerleave", hideTip);
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => measure())
        : null;
    ro?.observe(el);
    return () => {
      window.cancelAnimationFrame(paint);
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("pointermove", onPointerMove);
      railNode?.removeEventListener("pointermove", onRailMove);
      railNode?.removeEventListener("pointerleave", hideTip);
      ro?.disconnect();
      window.clearTimeout(scrollHide.current);
      window.clearTimeout(tipOpenTimer.current);
      window.clearTimeout(tipCloseTimer.current);
    };
  }, [measure, scrollRef, revision, showTip, hideTip]);

  useEffect(() => {
    if (open) measure();
  }, [open, measure]);

  const jumpTo = useCallback(
    (offsetTop: number) => {
      const el = scrollRef.current;
      if (!el) return;
      animateScrollTop(
        el,
        scrollTopToAlignMessage(
          offsetTop,
          el.scrollHeight - el.clientHeight,
        ),
      );
    },
    [scrollRef],
  );

  const onThumbDown = useCallback(
    (ev: React.PointerEvent<HTMLDivElement>) => {
      const el = scrollRef.current;
      const rail = railRef.current;
      if (!el || !rail || !thumb) return;
      ev.preventDefault();
      ev.stopPropagation();
      const startY = ev.clientY;
      const startTop = el.scrollTop;
      const range = el.scrollHeight - el.clientHeight;
      const maxThumb = Math.max(1, rail.clientHeight - thumb.height);
      draggingRef.current = true;
      setDragging(true);
      const target = ev.currentTarget;
      target.setPointerCapture(ev.pointerId);
      const onMove = (e: PointerEvent) => {
        const dy = e.clientY - startY;
        el.scrollTop = Math.max(
          0,
          Math.min(range, startTop + (dy / maxThumb) * range),
        );
      };
      const onUp = () => {
        draggingRef.current = false;
        setDragging(false);
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
        target.removeEventListener("pointercancel", onUp);
      };
      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
      target.addEventListener("pointercancel", onUp);
    },
    [scrollRef, thumb],
  );

  const showTicks = overflow;

  const rail = (
    <div
      ref={railRef}
      className={`wire-ask-rail${overflow ? " is-overflow" : ""}${
        open ? " is-open" : ""
      }${scrolling ? " is-scrolling" : ""}${dragging ? " is-dragging" : ""}`}
      data-ask-rail=""
      data-overflow={overflow ? "true" : "false"}
      style={{
        width: ASK_GUTTER_PX,
        top: railBox?.top ?? 0,
        height: railBox?.height ?? undefined,
      }}
      aria-hidden={!overflow}
    >
      <div className="wire-ask-rail-track" />
      {showTicks
        ? marks.map((mark) => {
            return (
              <button
                key={mark.id}
                type="button"
                className={`wire-ask-tick${
                  tip?.mark.id === mark.id ? " is-hot" : ""
                }`}
                data-ask-tick={mark.id}
                style={{ top: mark.top }}
                aria-label={clipAskPreview(mark.preview) || "跳转到提问"}
                onPointerEnter={() => showTip(mark)}
                onPointerLeave={hideTip}
                onClick={(e) => {
                  e.stopPropagation();
                  jumpTo(mark.offsetTop);
                }}
              />
            );
          })
        : null}
      {thumb ? (
        <div
          className="wire-ask-thumb"
          data-ask-thumb=""
          style={{ top: thumb.top, height: thumb.height }}
          onPointerDown={onThumbDown}
        />
      ) : null}
      {tip ? (
        <div
          className={`wire-ask-tip${tip.open ? " is-open" : ""}`}
          role="tooltip"
          data-ask-tip=""
          style={{ top: tip.mark.top }}
        >
          {clipAskPreview(tip.mark.preview)}
        </div>
      ) : null}
    </div>
  );

  return rail;
}
