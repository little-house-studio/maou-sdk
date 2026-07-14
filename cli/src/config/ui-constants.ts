/**
 * CLI UI / 性能相关命名常量（行为与原散落字面量一致）。
 * 后续若进 ~/.maou/config.json ui.*，在此做默认值即可。
 */

// ── 终端宽度断点（cols）────────────────────────────────────

export const TERM_BREAKPOINTS = {
  /** cols < this → narrow */
  narrowBelow: 80,
  /** cols <= this → normal，否则 wide */
  normalMax: 120,
  /** StatusBar / InfoBar 显示 model */
  showModelMin: 80,
  /** StatusBar 显示 cache 命中率 */
  showCacheMin: 100,
  /** 缺省终端宽高（stdout 未就绪） */
  fallbackCols: 80,
  fallbackRows: 24,
} as const;

export type TermBreakpointName = "narrow" | "normal" | "wide";

export function classifyTermBreakpoint(cols: number): TermBreakpointName {
  if (cols < TERM_BREAKPOINTS.narrowBelow) return "narrow";
  if (cols <= TERM_BREAKPOINTS.normalMax) return "normal";
  return "wide";
}

// ── 流式 / 绘制 ────────────────────────────────────────────

/** 流式 delta 合并窗口（ms） */
export const STREAM_THROTTLE_MS = 48;

/** 全量 paint 合并（空闲）——调度上限 ~60fps */
export const PAINT_FULL_MS = 16;

/** 全量 paint 合并（streaming）——抬到 ~40fps 调度上限 */
export const PAINT_FULL_STREAM_MS = 24;

/**
 * 全量 paint 合并（滚轮中）——默认跟手 ~60fps 调度。
 * 单帧若算不完，实测 fps 仍会低于此上限（结构瓶颈）。
 * MAOU_PAINT_SCROLL_MS 可覆盖（数字毫秒）。
 */
export const PAINT_FULL_SCROLL_MS = (() => {
  const raw = process.env.MAOU_PAINT_SCROLL_MS;
  if (raw != null && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return Math.min(200, Math.max(0, Math.round(n)));
  }
  return 16;
})();

/** 选区脏行：尽快画 */
export const PAINT_SEL_MS = 0;

/** 全局 spinner 时钟间隔 */
export const ANIM_INTERVAL_MS = 150;

/** 输入框插入光标闪烁半周期（亮/灭各一次，约 1Hz） */
export const CURSOR_BLINK_MS = 530;

/** 鼠标 hover 最小间隔（降采样，减 motion CPU） */
export const HOVER_MIN_MS = 80;

/** 滚轮 delta 合并窗口（ms）——略收以抬逻辑滚动频率 */
export const SCROLL_COALESCE_MS = 16;

/** 滚动结束后视为「已静止」的等待 ms */
export const SCROLL_IDLE_MS = 150;

// ── 对话历史窗口（轮 ≈ 消息条）────────────────────────────────

/** 贴底时只渲染最近 N 条消息 */
export const HISTORY_BASE_ROUNDS = 200;
/** 顶缘过滚满 N 格后，再向上加载 M 条 */
export const HISTORY_CHUNK_ROUNDS = 100;
/** 顶缘连滚多少格触发加载更早历史 */
export const HISTORY_OVERSCROLL_NOTCHES = 5;

// ── Toast / 文案截断 ───────────────────────────────────────

/** toast / 系统错误展示截断长度（字符） */
export const TOAST_TEXT_MAX = 80;

// ── 布局 hit-test 回退（inputRect 未就绪时）────────────────

/** InputBar " ❯ " 等前缀占的视觉列（实测 rect 优先） */
export const INPUT_TEXT_COL_OFFSET_DEFAULT = 4;

/** 全屏编辑器文字起点偏移 */
export const FULL_EDITOR_TEXT_COL_OFFSET = 1;
