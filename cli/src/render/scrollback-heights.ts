/**
 * Scrollback 行高缓存 + 估算（Grok 式虚拟列表的数据层）。
 *
 * - 已测高度：写入 cache，滚动只靠 cache 算 totalH / 可见窗
 * - 未测：按内容粗估，测到后替换（可能轻微跳动，换取少挂载）
 */

import stringWidth from "string-width";
import type { ChatMessage, SystemEvent } from "../state/types.js";

export type ScrollItem =
  | { type: "msg"; ts: number; id: string; data: ChatMessage }
  | { type: "sys"; ts: number; id: string; data: SystemEvent };

/** 环境开关：MAOU_VIRTUAL_SCROLL=0 关闭虚拟化（回退全量挂载） */
export function virtualScrollEnabled(): boolean {
  const v = process.env.MAOU_VIRTUAL_SCROLL;
  if (v === "0" || v === "false" || v === "off") return false;
  return true;
}

/** 视口外缓冲条目数（上下各多挂，减少快速滑时空洞） */
export const VIRTUAL_BUFFER = (() => {
  const n = Number(process.env.MAOU_VIRTUAL_BUFFER);
  if (Number.isFinite(n) && n >= 0) return Math.min(20, Math.round(n));
  // 默认 4：略增跑道，滚动冻结窗更少扩展 remount
  return 4;
})();

function linesOfText(text: string, cols: number): number {
  const c = Math.max(12, cols);
  if (!text) return 0;
  let lines = 0;
  for (const para of text.split("\n")) {
    const w = stringWidth(para) || 0;
    lines += Math.max(1, Math.ceil(w / c));
  }
  return lines;
}

/** 未测高时的粗估（行） */
export function estimateItemHeight(item: ScrollItem, cols: number): number {
  const bodyCols = Math.max(16, cols - 6);
  if (item.type === "sys") {
    return Math.min(6, 1 + linesOfText(item.data.content || item.data.kind || "", bodyCols));
  }
  const m = item.data;
  // 头 2 行 + 正文 + think + tool 折叠行
  let h = 2;
  h += Math.min(30, linesOfText(m.content || "", bodyCols));
  for (const t of m.thinkingBlocks ?? []) {
    h += Math.min(8, 1 + linesOfText(t.content || "", bodyCols));
  }
  for (const tc of m.toolCalls ?? []) {
    // 折叠态约 1 行；有结果时预留一点
    h += 1;
    if (tc.result && !tc.done) h += 2;
    else if (tc.result) h += Math.min(4, Math.ceil((tc.result.length || 0) / (bodyCols * 4)));
  }
  return Math.max(2, Math.min(48, h));
}

export type HeightCache = Map<string, number>;

export function resolveHeights(
  items: ScrollItem[],
  cache: HeightCache,
  cols: number,
): number[] {
  return items.map((it) => {
    const hit = cache.get(it.id);
    if (hit != null && hit > 0) return hit;
    return estimateItemHeight(it, cols);
  });
}

export function sumHeights(heights: number[]): number {
  let t = 0;
  for (const h of heights) t += Math.max(0, h);
  return t;
}
