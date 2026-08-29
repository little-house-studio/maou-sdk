import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CaretBox } from "./caret";
import type { AppCommand } from "./commands";

type Pos = { left: number; top: number };

/** 斜杠指令默认带 `/`；权限座位等不是指令的调用方传空串。 */
export function flyoutItemName(name: string, prefix = "/"): string {
  return `${prefix}${name}`;
}

export function CommandFlyout({
  open,
  anchor,
  caret,
  items,
  activeIdx,
  onPick,
  onHighlight,
  namePrefix = "/",
}: {
  open: boolean;
  anchor: HTMLElement | null;
  caret?: CaretBox | null;
  items: readonly AppCommand[];
  activeIdx: number;
  onPick: (name: string) => void;
  onHighlight?: (index: number) => void;
  namePrefix?: string;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<Pos | null>(null);

  useLayoutEffect(() => {
    const box = caret ?? (anchor ? anchor.getBoundingClientRect() : null);
    if (!open || !box) {
      setPos(null);
      return;
    }
    const place = () => {
      const r = caret ?? anchor?.getBoundingClientRect();
      if (!r) return;
      const panel = panelRef.current;
      const w = Math.max(200, Math.min(260, panel?.offsetWidth ?? 220));
      const h = panel?.offsetHeight ?? 180;
      const gap = 4;
      let left = r.left;
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      let top = r.top - gap - h;
      if (top < 8) top = Math.min(r.bottom + gap, window.innerHeight - h - 8);
      setPos({ left, top });
    };
    place();
    const id = requestAnimationFrame(place);
    return () => cancelAnimationFrame(id);
  }, [open, anchor, caret, items]);

  useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const row = panel?.querySelector<HTMLElement>("[aria-selected='true']");
    row?.scrollIntoView({ block: "nearest" });
  }, [open, activeIdx, items]);

  useEffect(() => {
    const el = panelRef.current;
    if (!open || !el) return;
    const onWheel = (e: WheelEvent) => {
      e.stopPropagation();
      if (el.scrollHeight <= el.clientHeight) return;
      e.preventDefault();
      el.scrollTop += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [open, items.length]);

  if (!open || items.length === 0 || typeof document === "undefined") return null;

  const sel =
    items[Math.min(Math.max(0, activeIdx), items.length - 1)] ?? items[0];

  return createPortal(
    <div
      ref={panelRef}
      className="composer-cmd-flyout"
      role="listbox"
      data-composer-overlay="command"
      aria-label="指令"
      style={
        pos
          ? { position: "fixed", left: pos.left, top: pos.top, zIndex: 10060 }
          : { position: "fixed", left: -9999, top: 0, visibility: "hidden", zIndex: 10060 }
      }
    >
      {items.map((cmd, i) => {
        const active = cmd.name === sel?.name;
        return (
          <button
            key={cmd.name}
            type="button"
            role="option"
            aria-selected={active}
            className={`composer-cmd-flyout-item${active ? " is-active" : ""}`}
            title={cmd.description}
            onMouseEnter={() => onHighlight?.(i)}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(cmd.name);
            }}
          >
            <span className="composer-cmd-flyout-name">
              {flyoutItemName(cmd.name, namePrefix)}
            </span>
            <span className="composer-cmd-flyout-label">{cmd.label}</span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
