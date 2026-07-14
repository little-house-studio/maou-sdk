/**
 * MAOU_LITE —— 帧率 A/B 试验用「精简模式」
 *
 * 启动：
 *   MAOU_LITE=1 maou coding
 *   MAOU_LITE=1 maou          # 同
 *
 * 一口气关掉大量可疑 UI 开销，便于判断：
 *   - 关掉后变流畅 → 问题在被关的功能 / React 提交频率
 *   - 关掉后仍卡   → 更可能是 Ink 全树 layout + 全屏 paint 结构瓶颈
 *
 * 被关闭（见 isLite* 与下方说明）：
 *   - spinner / LIVE 动画时钟
 *   - 鼠标 hover 高亮
 *   - 输入光标闪烁 paint
 *   - 后台终端 1.5s 轮询
 *   - 选区 flash 二次 paint
 *   - OSC22 指针形状
 *   - 历史窗 200 → 12 条（大幅减 Yoga 节点）
 *   - StatusBar 时钟
 *   - 终端尺寸 1s 兜底 poll（仅 resize 事件）
 *
 * 保留：
 *   - PerfHud（方便对照 fps）
 *   - 滚轮 / 对话滚动 / 输入
 *   - 鼠标点击、选区拖选（无 hover 高亮）
 */

function envOn(name: string): boolean {
  const v = process.env[name];
  if (v == null || v === "") return false;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on" || s === "lite";
}

/** 主开关 */
export const LITE_MODE = envOn("MAOU_LITE") || envOn("MAOU_FPS_TEST");

/** 精简模式下贴底历史条数（默认 12，可用 MAOU_LITE_HISTORY=N 覆盖） */
export const LITE_HISTORY_BASE = (() => {
  const raw = process.env.MAOU_LITE_HISTORY;
  if (raw != null && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 3) return Math.min(80, Math.round(n));
  }
  return 12;
})();

export function isLiteMode(): boolean {
  return LITE_MODE;
}

export function isLiteNoAnim(): boolean {
  return LITE_MODE;
}

export function isLiteNoHover(): boolean {
  return LITE_MODE;
}

export function isLiteNoCursorBlink(): boolean {
  return LITE_MODE;
}

export function isLiteNoBgPoll(): boolean {
  return LITE_MODE;
}

export function isLiteNoSelFx(): boolean {
  return LITE_MODE;
}

export function isLiteNoPointerShape(): boolean {
  return LITE_MODE;
}

export function isLiteNoStatusClock(): boolean {
  return LITE_MODE;
}

export function isLiteNoTermSizePoll(): boolean {
  return LITE_MODE;
}

/** 精简模式下历史窗口基数 */
export function liteHistoryBase(normal: number): number {
  return LITE_MODE ? LITE_HISTORY_BASE : normal;
}

/** 启动时打到 stderr 的一行摘要（不污染 TUI 备用屏时也可见） */
export function liteModeBanner(): string {
  if (!LITE_MODE) return "";
  return (
    `[maou-lite] ON · history≤${LITE_HISTORY_BASE}` +
    ` · anim=off hover=off blink=off bgPoll=off selFx=off ptr=off clock=off sizePoll=off` +
    ` · PerfHud 仍开 · 关: unset MAOU_LITE`
  );
}

/** 给人看的短列表（toast） */
export function liteModeToast(): string {
  if (!LITE_MODE) return "";
  return `LITE 帧率试验 · 史${LITE_HISTORY_BASE}条 · 关动画/hover/闪烁/轮询`;
}
