/**
 * 终端视口恢复 —— 修 IME 长预编辑把画面「横向卷走」后不回弹。
 *
 * 现象：第三方输入法组字很长时，预编辑/光标顶到终端右缘外，Terminal/iTerm
 * 会横向跟随；组字完成后文字进了输入框（已 wrap），但视口仍停在偏右位置。
 *
 * 策略：
 * 1. 输入布局上报：任意逻辑行视觉宽 > 输入区可用宽 → 记 overflowLatch
 * 2. 宽回落且右侧不再需要溢出 → restore（复位滚动区 + 全量重绘）
 * 3. 每帧绘制后把隐藏硬件光标钉在输入格内（限 cols 内），让 IME 贴在框里而不是跟到右下角
 */

import stringWidth from "string-width";

export interface ImePinTarget {
  focused: boolean;
  /** 1-based 屏幕行列（已 clamp 到终端内） */
  row: number;
  col: number;
  cols: number;
  rows: number;
}

let overflowLatch = false;
let restoreTimer: ReturnType<typeof setTimeout> | null = null;
let pin: ImePinTarget | null = null;
let fullPaintFn: (() => void) | null = null;

/** 由 app/vram 注入全量重绘 */
export function bindViewportFullPaint(fn: () => void): void {
  fullPaintFn = fn;
}

/** InputBar 每帧/光标变化时更新 IME 锚点（屏幕坐标 1-based） */
export function setImePinTarget(next: ImePinTarget | null): void {
  if (next) {
    // 调用方若算出 col 越界，先打 latch（IME 长预编辑典型信号）
    if (next.col > next.cols || next.col < 1) {
      overflowLatch = true;
    }
    pin = {
      ...next,
      col: Math.max(1, Math.min(next.cols, next.col)),
      row: Math.max(1, Math.min(next.rows, next.row)),
    };
  } else {
    pin = null;
  }
}

export function getImePinTarget(): ImePinTarget | null {
  return pin;
}

/**
 * 复位终端滚动区域 / 边距，并请求全量重绘。
 * 尽量兼容 xterm 系；不支持的序列会被忽略。
 */
export function restoreTerminalViewport(): void {
  if (!process.stdout.isTTY) return;
  // Ratatui owns alternate screen — Node CSI viewport reset desyncs Rust buffers (花屏)
  const tui = (
    process.env.MAOU_TUI_ACTIVE ||
    process.env.MAOU_TUI ||
    ""
  ).toLowerCase();
  if (tui === "ratatui" || tui === "rust" || tui === "rt") {
    void import("../state/store.js")
      .then(({ useStore }) => useStore.getState().bumpScreenEpoch())
      .catch(() => {});
    return;
  }
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  try {
    process.stdout.write(
      // 复位滚动区 + 关掉左右边距模式 + 开自动换行
      "\x1b[r" +
        "\x1b[?69l" +
        "\x1b[?7h" +
        // 光标回原点再钉回输入（避免停在越界列）
        "\x1b[1;1H" +
        "\x1b[?25l",
    );
  } catch {
    /* ignore */
  }
  // 全量重绘把布局画回正常；随后 afterTerminalPaint 会 pin IME
  fullPaintFn?.();
  // 再钉一次光标（paint 异步时也兜底）
  queueMicrotask(() => pinHardwareCursorForIme());
  void cols;
  void rows;
}

/** 每帧 paint 结束后调用：把硬件光标（隐藏）放到输入位置，供 IME 跟随 */
export function pinHardwareCursorForIme(): void {
  if (!process.stdout.isTTY) return;
  // Ratatui pins HW caret itself after each frame — Node must not fight it
  const tui = (
    process.env.MAOU_TUI_ACTIVE ||
    process.env.MAOU_TUI ||
    ""
  ).toLowerCase();
  if (tui === "ratatui" || tui === "rust" || tui === "rt") return;
  const p = pin;
  if (!p?.focused) {
    try {
      process.stdout.write("\x1b[?25l");
    } catch {
      /* ignore */
    }
    return;
  }
  const col = Math.max(1, Math.min(p.cols, p.col));
  const row = Math.max(1, Math.min(p.rows, p.row));
  try {
    // 始终隐藏：显示仍靠 TextArea 软件光标，硬件位只服务 IME 定位
    process.stdout.write(`\x1b[${row};${col}H\x1b[?25l`);
  } catch {
    /* ignore */
  }
}

/**
 * 根据输入内容是否仍「逻辑溢出」决定是否恢复视口。
 * @param value 当前输入框文本
 * @param contentCols 输入区内容可用列（不含 ❯ 前缀）
 */
export function noteInputContentWidth(value: string, contentCols: number): void {
  const avail = Math.max(8, contentCols);
  let maxW = 0;
  for (const line of value.split("\n")) {
    const w = stringWidth(line);
    if (w > maxW) maxW = w;
  }

  if (maxW > avail) {
    // 仍有超宽逻辑行（IME 有时会把预编辑灌进 value）
    overflowLatch = true;
    return;
  }

  if (overflowLatch) {
    // 曾溢出，现在右侧不再需要横向空间 → 恢复
    overflowLatch = false;
    scheduleRestore(40);
  }
}

/** 强制认为发生过溢出（例如检测到布局异常时） */
export function markViewportOverflow(): void {
  overflowLatch = true;
}

/**
 * 输入空闲后：仅当曾经溢出（latch）时才恢复。
 * 避免每个按键都全量重绘闪屏。
 */
export function scheduleIdleViewportCheck(ms = 120): void {
  if (!overflowLatch) return;
  scheduleRestore(ms);
}

/** 测试用：当前是否处于溢出闩锁 */
export function isViewportOverflowLatched(): boolean {
  return overflowLatch;
}

function scheduleRestore(ms: number): void {
  if (restoreTimer) clearTimeout(restoreTimer);
  restoreTimer = setTimeout(() => {
    restoreTimer = null;
    // 空闲恢复：若 latch 已清仍可能 OS 卷轴未回，保险 restore 一次
    restoreTerminalViewport();
  }, ms);
}

/**
 * 计算输入内容最大视觉宽；供调试/测试。
 */
export function maxLineVisualWidth(value: string): number {
  let maxW = 0;
  for (const line of value.split("\n")) {
    const w = stringWidth(line);
    if (w > maxW) maxW = w;
  }
  return maxW;
}

/**
 * 按终端列宽估算输入框「视觉行数」（含软折行）。
 *
 * InputBar 外壳高度、鼠标 hit、滚动条都依赖它。
 * 仅按 `\n` 计数会把超长单行当成 1 行 → 外壳 1 行高、右侧被裁切。
 *
 * 规则与 react-ink-textarea 的 buildVisualRows 一致：
 * 空逻辑行占 1 视觉行；非空行 ceil(visualWidth / contentCols)。
 */
export function countInputVisualLines(value: string, contentCols: number): number {
  const cols = Math.max(1, contentCols);
  if (!value) return 1;
  let total = 0;
  for (const line of value.split("\n")) {
    const w = stringWidth(line);
    total += w <= 0 ? 1 : Math.ceil(w / cols);
  }
  return Math.max(1, total);
}

/**
 * 输入区可用内容列宽（整屏 cols 减去 ❯ 前缀与右侧滚动条槽）。
 * prompt "❯ " = 2，右侧 1 列指示条 → 默认减 3。
 */
export function inputContentCols(termCols: number, reserved = 3): number {
  return Math.max(8, termCols - reserved);
}
