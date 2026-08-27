let leaveTimer = 0;

/** 缝上悬停时锁整页光标，避免和邻栏 pointer 光标来回抢。 */
export function setResizeCursor(
  kind: "col" | "row" | null,
  immediate = false,
) {
  window.clearTimeout(leaveTimer);
  if (kind) {
    document.documentElement.dataset.resizeCursor = kind;
    return;
  }
  const clear = () => {
    delete document.documentElement.dataset.resizeCursor;
  };
  if (immediate) {
    clear();
    return;
  }
  leaveTimer = window.setTimeout(clear, 120);
}
