import { describe, it, expect } from "vitest";
import {
  applyItemHeightChange,
  applyScrollDelta,
  maxScrollOf,
  topYOf,
  marginTopOf,
  virtualRange,
  buildStarts,
  scrollThumb,
} from "./chat-scroll.js";

describe("chat-scroll model", () => {
  it("贴底：topY = total - view，marginTop 钉底", () => {
    // total=100, view=20, fromBottom=0 → topY=80
    expect(maxScrollOf(100, 20)).toBe(80);
    expect(topYOf(100, 20, 0)).toBe(80);
    expect(marginTopOf(100, 20, 0)).toBe(-80);
  });

  it("上滚 fromBottom+=2：topY 减 2（看更早）", () => {
    expect(topYOf(100, 20, 2)).toBe(78);
    expect(applyScrollDelta(0, 100, 20, 2)).toBe(2);
  });

  it("上方条目变高：fromBottom 不变（不往上跳）", () => {
    // 视口 topY=80；条目 [0,10) 从 10→25，Δ=15 全在上方
    const r = applyItemHeightChange(100, 20, 0, 0, 10, 25);
    expect(r.totalH).toBe(115);
    expect(r.fromBottom).toBe(0); // 贴底仍贴底
    // 上滚中：fromBottom=10, topY=70；上方变高
    const r2 = applyItemHeightChange(100, 20, 10, 0, 10, 25);
    expect(r2.totalH).toBe(115);
    expect(r2.fromBottom).toBe(10); // 不 +15
    expect(topYOf(r2.totalH, 20, r2.fromBottom)).toBe(115 - 20 - 10); // 85 = 70+15
  });

  it("下方/视口内变高：fromBottom += Δ（钉住 topY）", () => {
    // topY=80；条目从 y=90 高 5→20，全在下方
    const r = applyItemHeightChange(100, 20, 0, 90, 5, 20);
    expect(r.totalH).toBe(115);
    expect(r.fromBottom).toBe(15);
    expect(topYOf(r.totalH, 20, r.fromBottom)).toBe(80); // 钉住
  });

  it("virtualRange 覆盖视口", () => {
    const heights = Array.from({ length: 30 }, () => 10);
    const { starts, total } = buildStarts(heights);
    const vr = virtualRange(heights, starts, total, 40, 0, 2);
    // 贴底 topY=260；应包含末尾
    expect(vr.endIdx).toBe(30);
    expect(vr.startIdx).toBeLessThan(30);
    expect(vr.padBottom).toBe(0);
  });

  it("scrollThumb 贴底在下、顶在上", () => {
    const bottom = scrollThumb(0, 100, 20);
    const top = scrollThumb(100, 100, 20);
    expect(bottom.thumbTop).toBeGreaterThan(top.thumbTop);
  });
});
