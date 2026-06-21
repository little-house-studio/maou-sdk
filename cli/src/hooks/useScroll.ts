/** useScroll —— 受控滚动偏移（行），供 ScrollView + 滚轮/方向键使用 */
import { useState } from "react";

export function useScroll(contentHeight: number, viewHeight: number) {
  const [offset, setOffset] = useState(0);
  const max = Math.max(0, contentHeight - viewHeight);
  const clamp = (o: number) => Math.max(0, Math.min(max, o));
  return {
    offset: clamp(offset),
    max,
    setOffset: (o: number) => setOffset(clamp(o)),
    scrollBy: (d: number) => setOffset((o) => clamp(o + d)),
    toTop: () => setOffset(0),
    toBottom: () => setOffset(max),
  };
}
