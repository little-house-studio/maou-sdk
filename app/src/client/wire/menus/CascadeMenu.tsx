/**
 * 纸面多级菜单：单触发器 + 一至两列面板。
 * Esc / 点面板外关闭；面板 portal 到 body，避免 composer overflow 裁切。
 */
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { presenceProps, usePresence } from "../../motion";

export type CascadeItem = {
  id: string;
  label: string;
  hint?: string;
  selected?: boolean;
  active?: boolean;
  disabled?: boolean;
  trailing?: "arrow" | "check" | null;
  lead?: ReactNode;
  danger?: boolean;
  dismiss?: boolean;
  onHover?: () => void;
  onSelect?: () => void;
};

export type CascadeColumn = {
  key: string;
  heading?: string;
  loading?: boolean;
  empty?: string;
  items: readonly CascadeItem[];
};

export type CascadeMenuHandle = {
  focus: () => void;
  open: () => void;
  close: () => void;
};

export type CascadeMenuProps = {
  triggerLabel: string;
  triggerTitle?: string;
  triggerLead?: ReactNode;
  ariaLabel: string;
  columns: readonly CascadeColumn[];
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  onOpen?: () => void;
};

type PanelPos = { left: number; top: number; openUp: boolean; minWidth: number };

export const CascadeMenu = forwardRef<CascadeMenuHandle, CascadeMenuProps>(
  function CascadeMenu(
    {
      triggerLabel,
      triggerTitle,
      triggerLead,
      ariaLabel,
      columns,
      disabled = false,
      className = "",
      triggerClassName = "",
      onOpen,
    },
    ref,
  ) {
    const uid = useId();
    const rootRef = useRef<HTMLDivElement | null>(null);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState<PanelPos | null>(null);
    const presence = usePresence(open);

    const close = useCallback(() => {
      setOpen(false);
      triggerRef.current?.focus();
    }, []);

    useImperativeHandle(ref, () => ({
      focus: () => triggerRef.current?.focus(),
      open: () => {
        if (disabled) return;
        setOpen(true);
        onOpen?.();
      },
      close,
    }));

    const updatePos = useCallback(() => {
      const trig = triggerRef.current;
      if (!trig) return;
      const r = trig.getBoundingClientRect();
      const panelH = panelRef.current?.offsetHeight ?? 280;
      const colCount = Math.max(1, columns.length);
      const panelW = Math.max(
        colCount > 1 ? 340 : 220,
        Math.min(colCount > 1 ? 440 : 320, window.innerWidth - 16),
      );
      const gap = 6;
      const spaceAbove = r.top;
      const spaceBelow = window.innerHeight - r.bottom;
      const openUp = spaceAbove >= panelH + gap || spaceAbove > spaceBelow;
      let top = openUp ? r.top - gap - panelH : r.bottom + gap;
      top = Math.max(
        8,
        Math.min(top, window.innerHeight - 8 - Math.min(panelH, window.innerHeight - 16)),
      );
      let left = r.left;
      left = Math.max(8, Math.min(left, window.innerWidth - panelW - 8));
      setPos({
        left,
        top,
        openUp,
        minWidth: Math.max(r.width, colCount > 1 ? 280 : 180),
      });
    }, [columns.length]);

    useLayoutEffect(() => {
      if (!open) {
        setPos(null);
        return;
      }
      updatePos();
      const id = requestAnimationFrame(() => updatePos());
      return () => cancelAnimationFrame(id);
    }, [open, columns, updatePos]);

    useEffect(() => {
      if (!open) return;
      const onScroll = () => updatePos();
      window.addEventListener("resize", onScroll);
      window.addEventListener("scroll", onScroll, true);
      return () => {
        window.removeEventListener("resize", onScroll);
        window.removeEventListener("scroll", onScroll, true);
      };
    }, [open, updatePos]);

    useEffect(() => {
      if (!open) return;
      const onDoc = (e: PointerEvent) => {
        const t = e.target as Node;
        if (rootRef.current?.contains(t)) return;
        if (panelRef.current?.contains(t)) return;
        setOpen(false);
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
      };
      document.addEventListener("pointerdown", onDoc);
      document.addEventListener("keydown", onKey);
      return () => {
        document.removeEventListener("pointerdown", onDoc);
        document.removeEventListener("keydown", onKey);
      };
    }, [open, close]);

    const pick = (item: CascadeItem) => {
      if (item.disabled) return;
      item.onSelect?.();
      const dismiss = item.dismiss ?? item.trailing !== "arrow";
      if (dismiss) setOpen(false);
    };

    const panel =
      presence.shown && typeof document !== "undefined" ? (
        <div
          ref={panelRef}
          id={`${uid}-panel`}
          className={`wire-cascade-panel${pos?.openUp ? " is-up" : " is-down"}`}
          role="menu"
          aria-label={ariaLabel}
          aria-hidden={presence.phase !== "open"}
          inert={presence.phase !== "open" ? true : undefined}
          data-cascade-panel=""
          {...presenceProps(presence)}
          style={
            pos
              ? {
                  position: "fixed",
                  left: pos.left,
                  top: pos.top,
                  minWidth: Math.max(pos.minWidth, columns.length > 1 ? 360 : 200),
                  zIndex: 10050,
                }
              : {
                  position: "fixed",
                  left: -9999,
                  top: 0,
                  visibility: "hidden",
                  zIndex: 10050,
                }
          }
        >
          <div className="wire-cascade-body">
            {columns.map((col) => (
              <div
                key={col.key}
                className={`wire-cascade-col${
                  columns.length > 1 ? " is-split" : ""
                }`}
              >
                {col.heading ? (
                  <div className="wire-cascade-col-head">
                    {col.heading}
                    {col.loading ? (
                      <span className="wire-cascade-loading">…</span>
                    ) : null}
                  </div>
                ) : null}
                <ul className="wire-cascade-list" role="none">
                  {col.items.length === 0 ? (
                    <li className="wire-cascade-empty">
                      {col.empty ?? (col.loading ? "加载中…" : "无选项")}
                    </li>
                  ) : (
                    col.items.map((item) => (
                      <li key={item.id} role="none">
                        <button
                          type="button"
                          role="menuitem"
                          disabled={item.disabled}
                          className={`wire-cascade-item${
                            item.active ? " is-active" : ""
                          }${item.selected ? " is-selected" : ""}${
                            item.danger ? " is-danger" : ""
                          }`}
                          onMouseEnter={() => item.onHover?.()}
                          onFocus={() => item.onHover?.()}
                          onClick={() => pick(item)}
                        >
                          {item.lead ? (
                            <span className="wire-cascade-lead">{item.lead}</span>
                          ) : null}
                          <span className="wire-cascade-item-text">{item.label}</span>
                          {item.hint ? (
                            <span className="wire-cascade-item-hint">{item.hint}</span>
                          ) : null}
                          {item.trailing === "arrow" ? (
                            <span className="wire-cascade-item-arrow" aria-hidden>
                              ›
                            </span>
                          ) : item.trailing === "check" || item.selected ? (
                            <span className="wire-cascade-check" aria-hidden>
                              ✓
                            </span>
                          ) : null}
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ) : null;

    return (
      <div
        ref={rootRef}
        className={`wire-cascade${open ? " is-open" : ""} ${className}`.trim()}
        data-cascade-menu=""
      >
        <button
          ref={triggerRef}
          type="button"
          className={`wire-cascade-trigger ${triggerClassName}`.trim()}
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={`${uid}-panel`}
          aria-label={ariaLabel}
          title={triggerTitle || triggerLabel}
          onClick={() => {
            if (disabled) return;
            setOpen((v) => {
              const next = !v;
              if (next) onOpen?.();
              return next;
            });
          }}
        >
          {triggerLead ? (
            <span className="wire-cascade-lead">{triggerLead}</span>
          ) : null}
          <span className="wire-cascade-trigger-label">{triggerLabel}</span>
        </button>
        {panel && createPortal(panel, document.body)}
      </div>
    );
  },
);
