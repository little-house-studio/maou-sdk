import { describe, it, expect } from "vitest";
import {
  layoutFromChildBoxes,
  layoutFromHeights,
  hasRealLayout,
  findOlderUserIndex,
  offsetToAlignTop,
  contentTopY,
} from "./scroll-math.js";

describe("layoutFromChildBoxes（Yoga top，含 margin 空隙）", () => {
  it("用 top 而非 height 累加，保留消息间距", () => {
    // 每条消息 height=5，marginTop=1 → 实际 top 为 0, 6, 12
    const { starts, heights, total } = layoutFromChildBoxes([
      { top: 0, height: 5 },
      { top: 6, height: 5 },
      { top: 12, height: 5 },
    ]);
    expect(starts).toEqual([0, 6, 12]);
    expect(heights).toEqual([5, 5, 5]);
    expect(total).toBe(17);
  });

  it("height 累加会丢 margin（对照）", () => {
    const broken = layoutFromHeights([5, 5, 5]);
    expect(broken.starts).toEqual([0, 5, 10]); // 错误：缺了 1 行间距
    expect(broken.total).toBe(15);
  });
});

describe("findOlderUserIndex", () => {
  const isUser = [true, false, true, false];
  // tops with margins: u0 [0,4), ai [5,14), u1 [15,19), ai [20,24)
  const starts = [0, 5, 15, 20];
  const heights = [4, 9, 4, 4];

  it("贴底：视口顶在最后 → 最近完全在上方的 user 是 u1", () => {
    // content 总高 24，视口 10 → max=14，offset=0 → topY=14
    // u1 ends at 19 > 14，不完全在上方；u0 ends at 4 <= 14 → u0
    // wait contentTopY=14 means we see from y=14. u1 is [15,19) partially visible.
    // fully above: u0 only (y1=4<=14), ai ends 14<=14 so ai is fully above but not user
    expect(findOlderUserIndex(isUser, starts, heights, 14)).toBe(0);
  });

  it("视口顶正好在 u1 起点 → u0 是 older", () => {
    expect(findOlderUserIndex(isUser, starts, heights, 15)).toBe(0);
  });

  it("视口顶在 u1 之后 → u1 是 older", () => {
    expect(findOlderUserIndex(isUser, starts, heights, 20)).toBe(2);
  });

  it("视口顶在最前 → 无 older", () => {
    expect(findOlderUserIndex(isUser, starts, heights, 0)).toBe(-1);
  });
});

describe("offsetToAlignTop", () => {
  it("对齐到 targetY=15，max=40 → offset=25，contentTopY=15", () => {
    const off = offsetToAlignTop(40, 15);
    expect(off).toBe(25);
    expect(contentTopY(40, off)).toBe(15);
  });

  it("targetY=0 → offset=max（滚到最顶）", () => {
    expect(offsetToAlignTop(40, 0)).toBe(40);
    expect(contentTopY(40, 40)).toBe(0);
  });

  it("targetY>max 时 clamp 到 0 offset（顶对齐最早内容）", () => {
    // max-targetY < 0 → 0
    expect(offsetToAlignTop(10, 50)).toBe(0);
  });

  it("模拟带 margin 的跳转：正确 top=15 vs height 累加 13", () => {
    const correct = layoutFromChildBoxes([
      { top: 0, height: 4 },
      { top: 5, height: 9 },
      { top: 15, height: 4 },
    ]);
    const wrong = layoutFromHeights([4, 9, 4]);
    expect(correct.starts[2]).toBe(15);
    expect(wrong.starts[2]).toBe(13); // 4+9，丢了两段 margin 共 2 行

    const max = 30;
    const goodOff = offsetToAlignTop(max, correct.starts[2]!);
    const badOff = offsetToAlignTop(max, wrong.starts[2]!);
    // 错误 starts 偏小 → offset 偏大 → contentTopY 偏上 → 目标消息在视口里偏下
    expect(contentTopY(max, goodOff)).toBe(15);
    expect(contentTopY(max, badOff)).toBe(13);
    expect(badOff - goodOff).toBe(2);
  });
});

describe("hasRealLayout", () => {
  it("全 0 为 false", () => {
    expect(hasRealLayout([0, 0], [0, 0])).toBe(false);
  });
  it("有高度为 true", () => {
    expect(hasRealLayout([0, 5], [5, 3])).toBe(true);
  });
});
