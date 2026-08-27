/**
 * Informational hover: label/value rows on the shared HoverTip panel.
 */
import React, { type ReactNode } from "react";
import { HoverTip } from "./HoverTip";
import type { InfoHoverRow } from "./message-meta";
import { formatInfoHoverLabel } from "./message-meta";

export type InfoHoverProps = {
  rows: readonly InfoHoverRow[];
  /** Screen-reader / closed-state label; defaults to joined rows. */
  label?: string;
  children: ReactNode;
  className?: string;
};

export function InfoHover({
  rows,
  label,
  children,
  className = "",
}: InfoHoverProps) {
  const aria = label || formatInfoHoverLabel(rows);
  const panel =
    rows.length === 0 ? null : (
      <div className="wire-info-hover-panel" data-info-hover-panel="">
        {rows.map((row) => (
          <div key={row.label} className="wire-info-hover-row">
            <span className="wire-info-hover-k">{row.label}</span>
            <span className="wire-info-hover-v">{row.value}</span>
          </div>
        ))}
      </div>
    );
  return (
    <HoverTip
      content={panel}
      label={aria}
      className={`wire-info-hover${className ? ` ${className}` : ""}`}
    >
      {children}
    </HoverTip>
  );
}
