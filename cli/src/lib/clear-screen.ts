/**
 * 清屏并强制 TUI 全量重绘。
 *
 * 仅写 CSI 2J 会把终端擦空，但 vram 的 prevEncoded 行 diff 仍认为
 * 「行未变」→ 跳过写出 → 画面空白/残影。必须同步 invalidatePaintCache。
 */

export function clearTerminalScreen(): void {
  // 动态 import：避免 clear-screen ↔ store ↔ vram 循环依赖在模块初始化期炸掉
  void import("../render/vram-layer.js")
    .then((m) => {
      m.requestScreenRefresh({ clear: true });
      // Ink/React 状态更新后可能再来一帧；稍后再刷一次兜底
      setTimeout(() => m.scheduleFullPaint(), 32);
      setTimeout(() => m.scheduleFullPaint(), 120);
    })
    .catch(() => {
      try {
        if (process.stdout.isTTY) {
          process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
        }
      } catch {
        /* ignore */
      }
    });
}
