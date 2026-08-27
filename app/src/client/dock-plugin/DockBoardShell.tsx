/**
 * Standard content host for expanded dock boards.
 *
 * Surfaces:
 * - paper: translucent panes + dock-ink (design against --dock-ink)
 * - dark: wire shell dark panel (--n-* tokens)
 * - transparent: raw on manila fill
 *
 * Layout helpers (optional classes for face authors):
 * - .dock-board-toolbar  top action strip
 * - .dock-board-body     flex grow region
 * - .dock-board-grid-2/3 multi-pane grids
 * - .dock-board-pane     inset panel on paper/dark
 */
import type { ReactNode } from "react";
import type { DockBoardSurface } from "./layout";
import type { DockCardId } from "./ids";

export type DockBoardShellProps = {
  cardId: DockCardId;
  surface?: DockBoardSurface;
  className?: string;
  children: ReactNode;
};

export function DockBoardShell({
  cardId,
  surface = "transparent",
  className,
  children,
}: DockBoardShellProps) {
  const classes = [
    "wire-dock-board-shell",
    `surface-${surface}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      data-dock-body={cardId}
      data-dock-surface={surface}
      data-dock-plugin="shell"
    >
      {children}
    </div>
  );
}
