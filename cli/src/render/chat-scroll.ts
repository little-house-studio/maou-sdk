/**
 * 对话区滚动纯模型（与 Ink 解耦）。
 *
 * 坐标系（内容从上到下：旧 → 新）：
 *   y = 0           最早消息顶
 *   y = totalH      最新消息底
 *
 * 滚动锚（chat 常用）：
 *   fromBottom = 0     贴底看最新
 *   fromBottom 增大    往上看更早
 *   maxScroll = max(0, totalH - viewH)
 *   fromBottom ∈ [0, maxScroll]
 *
 * 视口顶在内容中的 y：
 *   topY = totalH - viewH - fromBottom   （当 totalH > viewH）
 *        = 0                              （当内容不足一屏）
 *
 * marginTop（内容 Box 上移）：
 *   marginTop = -topY
 *
 * 高度变化时的锚定（防跳格 / 反向跑）：
 *   若条目在 topY 之上变高 Δ：fromBottom 不变（视口钉住同一内容）
 *   若在 topY 之下（含视口内）变高 Δ：fromBottom += Δ（钉住视口顶 y）
 */

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function maxScrollOf(totalH: number, viewH: number): number {
  return Math.max(0, Math.round(totalH) - Math.max(1, Math.round(viewH)));
}

/** 视口顶对应的内容 y */
export function topYOf(totalH: number, viewH: number, fromBottom: number): number {
  const th = Math.max(0, Math.round(totalH));
  const vh = Math.max(1, Math.round(viewH));
  const fb = clamp(Math.round(fromBottom), 0, maxScrollOf(th, vh));
  if (th <= vh) return 0;
  return th - vh - fb;
}

/** 内容 Box 的 marginTop（负值上移） */
export function marginTopOf(totalH: number, viewH: number, fromBottom: number): number {
  return -topYOf(totalH, viewH, fromBottom);
}

export function applyScrollDelta(
  fromBottom: number,
  totalH: number,
  viewH: number,
  deltaFromBottom: number,
): number {
  const max = maxScrollOf(totalH, viewH);
  return clamp(fromBottom + deltaFromBottom, 0, max);
}

/**
 * maxScroll 变化时的 offset 锚定（对齐 store.setMaxChatScroll）。
 *
 * - autoFollow：永远钉底 (fromBottom=0)
 * - pin-content：底部追加时 fromBottom += Δ，保持 contentTopY（离开 tail 时流式增高不吸底）
 * - pin-offset：fromBottom 不动，只 clamp（测高修正 / 上方变高）
 */
export function applyMaxScrollChange(
  fromBottom: number,
  prevMax: number,
  nextMax: number,
  opts: { autoFollow?: boolean; mode?: "pin-content" | "pin-offset" } = {},
): { maxScroll: number; fromBottom: number } {
  const max = Math.max(0, Math.round(nextMax));
  const prev = Math.max(0, Math.round(prevMax));
  const fb0 = Math.max(0, Math.round(fromBottom));
  if (opts.autoFollow) {
    return { maxScroll: max, fromBottom: 0 };
  }
  const delta = max - prev;
  const mode = opts.mode ?? "pin-content";
  if (mode === "pin-offset" || delta <= 0) {
    return { maxScroll: max, fromBottom: clamp(fb0, 0, max) };
  }
  return { maxScroll: max, fromBottom: clamp(fb0 + delta, 0, max) };
}

/**
 * 某条目高度 oldH→newH，起点 startY（旧坐标系）。
 * 返回新的 totalH 与 fromBottom。
 */
export function applyItemHeightChange(
  totalH: number,
  viewH: number,
  fromBottom: number,
  startY: number,
  oldH: number,
  newH: number,
): { totalH: number; fromBottom: number } {
  const d = Math.round(newH) - Math.round(oldH);
  if (d === 0) {
    return {
      totalH: Math.round(totalH),
      fromBottom: clamp(fromBottom, 0, maxScrollOf(totalH, viewH)),
    };
  }
  const top = topYOf(totalH, viewH, fromBottom);
  const newTotal = Math.max(0, Math.round(totalH) + d);
  // 整段在视口顶之上 → 上方变高：fromBottom 不变
  const fullyAbove = startY + oldH <= top + 0.5;
  const newFb = fullyAbove ? fromBottom : fromBottom + d;
  return {
    totalH: newTotal,
    fromBottom: clamp(newFb, 0, maxScrollOf(newTotal, viewH)),
  };
}

export type HeightFn = (index: number) => number;

export function buildStarts(heights: number[]): { starts: number[]; total: number } {
  const starts: number[] = new Array(heights.length);
  let y = 0;
  for (let i = 0; i < heights.length; i++) {
    starts[i] = y;
    y += Math.max(0, Math.round(heights[i] ?? 0));
  }
  return { starts, total: y };
}

/** 虚拟窗口：按 topY/viewH 取 [start,end) + spacer */
export function virtualRange(
  heights: number[],
  starts: number[],
  totalH: number,
  viewH: number,
  fromBottom: number,
  buffer = 4,
): { startIdx: number; endIdx: number; padTop: number; padBottom: number } {
  const n = heights.length;
  if (n === 0) {
    return { startIdx: 0, endIdx: 0, padTop: 0, padBottom: 0 };
  }
  const top = topYOf(totalH, viewH, fromBottom);
  const bot = top + Math.max(1, viewH);

  let startIdx = 0;
  while (startIdx < n - 1 && (starts[startIdx]! + heights[startIdx]!) <= top) {
    startIdx++;
  }
  let endIdx = startIdx;
  while (endIdx < n && starts[endIdx]! < bot) {
    endIdx++;
  }
  startIdx = Math.max(0, startIdx - buffer);
  endIdx = Math.min(n, endIdx + buffer);

  const padTop = starts[startIdx] ?? 0;
  const padBottom = endIdx >= n ? 0 : totalH - (starts[endIdx] ?? totalH);
  return { startIdx, endIdx, padTop, padBottom };
}

/** 滚动条：fromBottom=0 → 滑块在底；=max → 在顶 */
export function scrollThumb(
  fromBottom: number,
  maxScroll: number,
  trackH: number,
): { thumbTop: number; thumbH: number } {
  const h = Math.max(3, Math.round(trackH));
  if (maxScroll <= 0) {
    return { thumbTop: Math.max(0, h - 1), thumbH: h };
  }
  const thumbH = Math.max(1, Math.min(h, Math.round((h * h) / (h + maxScroll)) || 1));
  const travel = Math.max(0, h - thumbH);
  const fromTop = 1 - clamp(fromBottom / maxScroll, 0, 1);
  const thumbTop = Math.round(fromTop * travel);
  return { thumbTop, thumbH };
}
