export const FILES_ACTIVITY_ID = "files";
export const SIDEBAR_ACTIVITY_ID = "sidebar";

export type ActivityBarProps = {
  activeId: string | null;
  onSelect: (id: string) => void;
  edge?: "left" | "right";
};

/** Same tab again closes the pane; any other id opens it. */
export function toggleAsideTab(
  current: string | null,
  id: string,
): string | null {
  return current === id ? null : id;
}
