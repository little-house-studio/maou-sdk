import React, { type ReactNode } from "react";

/** Height fold. Children stay mounted; `data-open` drives `.n-fold`. */
export function Fold({
  open,
  children,
  className = "",
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`n-fold${className ? ` ${className}` : ""}`}
      data-open={open ? "" : undefined}
      inert={!open ? true : undefined}
      aria-hidden={!open}
    >
      <div className="n-fold-inner">{children}</div>
    </div>
  );
}
