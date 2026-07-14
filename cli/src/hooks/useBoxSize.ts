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
    // Ink 提交 layout 略晚于 React commit（Node 无 rAF，用 setTimeout）
    const t0 = setTimeout(apply, 0);
    const t1 = setTimeout(apply, 16);
    const t2 = setTimeout(apply, 48);

    return () => {
      alive = false;
      clearTimeout(t0);
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps 由调用方控制
  }, deps);

  return size;
}

/** 单次读取（toggle 后 expandShift 用） */
export function readBoxHeight(ref: React.RefObject<DOMElement | null>): number {
  return readSize(ref).height;
}
