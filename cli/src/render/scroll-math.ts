/**
 * ScrollHistory 纯函数：测量 / 找上一条 / 跳转 offset。
 * 与 Ink 解耦，便于单元测试。
 */

export interface LayoutItem {
  /** 相对 content 顶的起始行（含该节点 margin 造成的空隙之后的 border-box top） */
  top: number;
  /** border-box 高度（不含 margin） */
  height: number;
}

/**
 * 从「子节点 layout 列表」得到 starts/heights/total。
 * 优先用每个子节点的 top（Yoga 已含前序 margin），避免 height 累加丢 margin 导致越跳越偏。
 */
export function layoutFromChildBoxes(
  children: Array<{ top: number; height: number } | null | undefined>,
): { starts: number[]; heights: number[]; total: number } {
  const starts: number[] = [];
  const heights: number[] = [];
  let maxBottom = 0;
  for (const c of children) {
    const top = Math.max(0, Math.round(c?.top ?? 0));
    const h = Math.max(0, Math.round(c?.height ?? 0));
    starts.push(top);
    heights.push(h);
    maxBottom = Math.max(maxBottom, top + h);
  }
  return { starts, heights, total: maxBottom };
}

/**
 * 兼容旧路径：仅有 height 序列时累加（会丢 margin，仅作 fallback）。
 */
export function layoutFromHeights(heightsIn: number[]): {
  starts: number[];
  heights: number[];
  total: number;
} {
  const starts: number[] = [];
  const heights: number[] = [];
  let y = 0;
  for (const raw of heightsIn) {
    const h = Math.max(0, Math.round(raw));
    starts.push(y);
    heights.push(h);
    y += h;
  }
  return { starts, heights, total: y };
}

export function hasRealLayout(starts: number[], heights: number[]): boolean {
  if (heights.length === 0) return false;
  return heights.some((h) => h > 0) || starts.some((s, i) => i > 0 && s > 0);
}

/**
 * 视口顶 contentY 之上、完全不可见的最近一条 user。
 * @param isUser items[i] 是否为 user 消息
 */
export function findOlderUserIndex(
  isUser: boolean[],
  starts: number[],
  heights: number[],
  contentTopY: number,
): number {
  let last = -1;
  const top = Math.round(contentTopY);
  for (let i = 0; i < isUser.length; i++) {
    const y0 = starts[i] ?? 0;
    const h = heights[i] ?? 0;
    const y1 = y0 + h;
    // 完全在视口顶之上（终点不超过顶）
    if (y1 <= top) {
      if (isUser[i]) last = i;
      continue;
    }
    // 与视口相交或更下方 —— 后面不可能再「完全在上方」
    break;
  }
  return last;
}

/**
 * 把 contentY=targetY 的行对齐到视口顶：
 * contentTopY = maxScroll - offset = targetY
 * → offset = maxScroll - targetY
 */
export function offsetToAlignTop(maxScroll: number, targetY: number): number {
  const max = Math.max(0, Math.round(maxScroll));
  const y = Math.max(0, Math.round(targetY));
  return Math.max(0, Math.min(max, max - y));
}

/**
 * 校验：给定 offset/max，视口顶 contentY 是否贴住 targetY（允许 0 误差）。
 */
export function contentTopY(maxScroll: number, offset: number): number {
  return Math.max(0, Math.round(maxScroll) - Math.round(offset));
}
