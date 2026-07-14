/**
 * 只跟踪 Box 的 width/height（不跟 left/top）。
 *
 * 不用 Ink useBoxMetrics：它在 layout 时若 top/left 变了也会 setState。
 * 对话区用 marginTop 滚动时，子树绝对坐标整页漂移 → 每张卡都 setState
 * → 嵌套更新爆掉（React #185）。
 *
 * 实现：render 后读 Yoga 尺寸；仅宽高变化时 setState。不订阅 layout 全树广播。
 */

import { useState, useEffect, useRef } from "react";
import type { DOMElement } from "ink";

export type BoxSize = { width: number; height: number };

const EMPTY: BoxSize = { width: 0, height: 0 };

function readSize(ref: React.RefObject<DOMElement | null>): BoxSize {
  const layout = ref.current?.yogaNode?.getComputedLayout?.();
  if (!layout) return EMPTY;
  return {
    width: Math.round(layout.width || 0),
    height: Math.round(layout.height || 0),
  };
}

/**
 * @param ref 目标 Box
 * @param deps 内容可能变高时传入（如 windowed.length），触发补测
 */
export function useBoxSize(
  ref: React.RefObject<DOMElement | null>,
  deps: unknown[] = [],
): BoxSize {
  const [size, setSize] = useState<BoxSize>(EMPTY);
  const sizeRef = useRef(size);
  sizeRef.current = size;

  useEffect(() => {
    let alive = true;

    const apply = () => {
      if (!alive) return;
      const next = readSize(ref);
      if (next.width <= 0 && next.height <= 0) return;
      const prev = sizeRef.current;
      if (prev.width === next.width && prev.height === next.height) return;
      sizeRef.current = next;
      setSize(next);
    };

    apply();
    // Ink layout 略晚于 React commit；2～3 拍足够，过多 setTimeout 会叠 CPU
    const timers = [0, 32, 80].map((ms) => setTimeout(apply, ms));

    return () => {
      alive = false;
      for (const t of timers) clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps 由调用方控制
  }, deps);

  return size;
}

/** 单次读取（toggle 后 expandShift 用） */
export function readBoxHeight(ref: React.RefObject<DOMElement | null>): number {
  return readSize(ref).height;
}

/**
 * 内容区高度：优先父节点 Yoga height；若子节点 bottom 更大则取子节点包络
 *（部分情况下父 height 未及时含折叠展开后的子树）。
 */
export function readContentHeight(ref: React.RefObject<DOMElement | null>): number {
  const el = ref.current;
  if (!el) return 0;
  const self = Math.round(el.yogaNode?.getComputedLayout?.()?.height ?? 0);
  let childBottom = 0;
  const kids = el.childNodes;
  if (kids?.length) {
    for (let i = 0; i < kids.length; i++) {
      const child = kids[i] as { yogaNode?: { getComputedLayout?: () => { top: number; height: number } } };
      const lay = child?.yogaNode?.getComputedLayout?.();
      if (!lay) continue;
      childBottom = Math.max(childBottom, Math.round(lay.top + lay.height));
    }
  }
  return Math.max(self, childBottom);
}
