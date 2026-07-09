/**
 * 点击命中测试 —— 参考 ink-mouse 的 walkNodePosition + isIntersecting。
 *
 * Ink 的 measureElement 只返回 {width, height}，无绝对坐标。
 * 这里遍历 yogaNode 父链累加 left/top，算出元素在终端的绝对 (1-based) 坐标，
 * 再判断鼠标 (col, row) 是否落在元素矩形内。
 *
 * 可点击元素用 useClickTarget(ref, onClick) 注册，点击时 hitTestClick 遍历注册表。
 */

import React, { useEffect } from "react";
import type { DOMElement } from "ink";

export interface ElementRect {
  left: number;   // 1-based 绝对列
  top: number;    // 1-based 绝对行
  width: number;
  height: number;
}

interface ClickEntry {
  rect: () => ElementRect | null;  // 惰性测量（点击时才算）
  onClick: () => void;
  id: string;
}

const registry = new Map<string, ClickEntry>();

/** 遍历父链累加 getComputedLayout().left/top，算元素绝对坐标（1-based）。 */
export function getElementRect(node: DOMElement | null): ElementRect | null {
  if (!node) return null;
  let current: DOMElement | undefined = node;
  let left = 1;
  let top = 1;
  let width = 0;
  let height = 0;
  let first = true;
  while (current) {
    if (!current.yogaNode) break;
    const layout = current.yogaNode.getComputedLayout();
    if (first) {
      width = layout.width;
      height = layout.height;
      first = false;
    }
    left += layout.left;
    top += layout.top;
    current = current.parentNode;
  }
  return { left, top, width, height };
}

/** 命中测试：鼠标 (col, row 1-based) 是否在 rect 内。 */
export function isIntersecting(col: number, row: number, rect: ElementRect): boolean {
  return col >= rect.left
    && col < rect.left + rect.width
    && row >= rect.top
    && row < rect.top + rect.height;
}

/** 注册可点击元素。返回注销函数。 */
export function registerClickTarget(id: string, getNode: () => DOMElement | null, onClick: () => void): () => void {
  registry.set(id, {
    rect: () => getElementRect(getNode()),
    onClick,
    id,
  });
  return () => { registry.delete(id); };
}

/** 遍历注册表，返回命中的元素（取最深的，即后注册的优先，通常是最内层子元素）。 */
export function hitTestClick(col: number, row: number): ClickEntry | null {
  let hit: ClickEntry | null = null;
  for (const entry of registry.values()) {
    const rect = entry.rect();
    if (rect && isIntersecting(col, row, rect)) {
      // 取面积更小的（更内层的子元素）优先
      if (!hit || (rect.width * rect.height) < (hit.rect()?.width ?? 0) * (hit.rect()?.height ?? 0)) {
        hit = entry;
      }
    }
  }
  return hit;
}

/** React hook：给 ref 注册点击回调。返回 id（供组件订阅 hoverId 匹配）。 */
export function useClickTarget(
  ref: React.RefObject<DOMElement | null>,
  onClick: () => void,
  deps: unknown[] = [],
): string {
  const id = React.useId();
  useEffect(() => {
    const unregister = registerClickTarget(id, () => ref.current, onClick);
    return unregister;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, ...deps]);
  return id;
}
