/**
 * 清屏并强制 TUI 全量重绘。
 *
 * Ink：CSI 2J + invalidate vram diff，否则清屏后 diff 认为「未变」→ 空白/残影。
 * Ratatui：绝不能从 Node 写 CSI 清屏——会弄乱 Rust 侧双缓冲，导致花屏/黑条/残字。
 * 只 bump screenEpoch，由 bridge 发 full_paint / Rust 自行 hard clear。
 */

import { isRatatuiBackend } from "../tui-bridge/config.js";

export function clearTerminalScreen(): void {
  // Always bump epoch so Ratatui bridge / any subscriber can force full paint
  void import("../state/store.js")
    .then(({ useStore }) => {
      useStore.getState().bumpScreenEpoch();
    })
    .catch(() => {
      /* store not ready */
    });

  // Ratatui owns the alternate screen — Node must not CSI-clear the TTY
  if (isRatatuiBackend()) {
    return;
  }

  // Ink path
  void import("../render/vram-layer.js")
    .then((m) => {
      m.requestScreenRefresh({ clear: true });
      setTimeout(() => m.scheduleFullPaint(), 32);
      setTimeout(() => m.scheduleFullPaint(), 120);
    })
    .catch(() => {
      if (isRatatuiBackend()) return;
      try {
        if (process.stdout.isTTY) {
          process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
        }
      } catch {
        /* ignore */
      }
    });
}
