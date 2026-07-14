/**
 * 点击命中测试 —— 参考 ink-mouse 的 walkNodePosition + isIntersecting。
 *
 * 性能：rect 结果按 generation 缓存；布局变化时 invalidateClickTargetCache()。
 * 旧版每次 motion 对所有注册项重算 Yoga 父链 → 半秒级迟滞。
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
  getNode: () => DOMElement | null;
  onClick: () => void;
  id: string;
  /** 缓存的 rect 所属 generation */
  cacheGen: number;
  cachedRect: ElementRect | null;
}

const registry = new Map<string, ClickEntry>();
/** 布局世代：全量 paint / 注册变更时递增 */
let layoutGen = 0;

/** 布局变化后调用，丢弃 rect 缓存（下一帧 hitTest 重测） */
export function invalidateClickTargetCache(): void {
  layoutGen++;
  for (const e of registry.values()) {
    e.cacheGen = -1;
    e.cachedRect = null;
  }
}

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
  // 无效布局
  if (width <= 0 && height <= 0) return null;
  return { left, top, width, height };
}

function entryRect(entry: ClickEntry): ElementRect | null {
  // 命中且本世代已测过 → 用缓存
  if (entry.cacheGen === layoutGen && entry.cachedRect) return entry.cachedRect;
  // null 不锁死：yoga 常在注册后一帧才就绪；锁 null 会导致审批条/新按钮永远 hover 不到
  const r = getElementRect(entry.getNode());
  if (r && r.width > 0 && r.height > 0) {
    entry.cachedRect = r;
    entry.cacheGen = layoutGen;
    return r;
  }
  // 测不到：保持 cacheGen 旧值，下次 motion 再试
  return null;
}

/** 命中测试：鼠标 (col, row 1-based) 是否在 rect 内。 */
export function isIntersecting(col: number, row: number, rect: ElementRect): boolean {
  return col >= rect.left
    && col < rect.left + rect.width
    && row >= rect.top
    && row < rect.top + rect.height;
}

/** 注册可点击元素。返回注销函数。 */
export function registerClickTarget(
  id: string,
  getNode: () => DOMElement | null,
  onClick: () => void,
): () => void {
  registry.set(id, {
    getNode,
    onClick,
    id,
    cacheGen: -1,
    cachedRect: null,
  });
  // 新注册不立刻 invalidate 全部，避免 thrash；该项 cacheGen=-1 会自测
  return () => {
    registry.delete(id);
  };
}

/**
 * 遍历注册表，返回命中的元素（面积更小 = 更内层优先）。
 * 使用 rect 缓存；同一 layoutGen 内多次 motion 只测一次 Yoga。
 */
export function hitTestClick(col: number, row: number): ClickEntry | null {
  let hit: ClickEntry | null = null;
  let hitArea = Infinity;
  for (const entry of registry.values()) {
    const rect = entryRect(entry);
    if (!rect || rect.width <= 0 || rect.height <= 0) continue;
    if (!isIntersecting(col, row, rect)) continue;
    const area = rect.width * rect.height;
    if (area < hitArea) {
      hitArea = area;
      hit = entry;
    }
  }
  return hit;
}

/** 当前注册数量（调试） */
export function clickTargetCount(): number {
  return registry.size;
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
    // 节点可能下一帧才挂上 yoga，清该项缓存
    const e = registry.get(id);
    if (e) {
      e.cacheGen = -1;
      e.cachedRect = null;
    }
    return unregister;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, ...deps]);
  return id;
}
