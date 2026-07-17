/**
 * 清屏并强制 TUI 全量重绘。
 *
 * 仅 Ratatui：Node 不得写 CSI 清屏（会弄乱 Rust 双缓冲）。
 * 只 bump screenEpoch，由 bridge 发 full_paint。
 */

export function clearTerminalScreen(): void {
  void import("../state/store.js")
    .then(({ useStore }) => {
      useStore.getState().bumpScreenEpoch();
    })
    .catch(() => {
      /* store not ready */
    });
}
