import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  selFxLive,
  selFxRelease,
  selFxClear,
  getSelFxPhase,
  selCellSgr,
  bindSelFxPaint,
  selFxColPhase,
  SEL_BG_RGB,
} from "./sel-fx.js";

describe("sel-fx visual phases (solid computer blue)", () => {
  let paints = 0;
  beforeEach(() => {
    paints = 0;
    selFxClear();
    bindSelFxPaint(() => {
      paints++;
    });
    vi.useFakeTimers();
  });
  afterEach(() => {
    selFxClear();
    vi.useRealTimers();
  });

  it("无列向渐变相位", () => {
    expect(selFxColPhase()).toBe(0);
  });

  it("live 不启动定时重绘；纯色计算机蓝 + 浅字", () => {
    selFxLive();
    expect(getSelFxPhase()).toBe("live");
    const n = paints;
    vi.advanceTimersByTime(500);
    expect(paints).toBe(n);
    const sgr = selCellSgr(10);
    expect(sgr).toContain(`48;2;${SEL_BG_RGB[0]};${SEL_BG_RGB[1]};${SEL_BG_RGB[2]}`);
    expect(sgr).toMatch(/38;2;235;235;235/);
  });

  it("live 各列同色（无渐变）", () => {
    selFxLive();
    const a = selCellSgr(1);
    for (const col of [1, 20, 40, 80, 120]) {
      expect(selCellSgr(col)).toBe(a);
      expect(selCellSgr(col)).toMatch(/38;2;235;235;235/);
    }
  });

  it("release → flash paint → settled 仍为计算机蓝", () => {
    selFxLive();
    paints = 0;
    selFxRelease();
    expect(getSelFxPhase()).toBe("flash");
    expect(paints).toBe(1);
    expect(selCellSgr(1)).toMatch(/220;220;220/);

    vi.advanceTimersByTime(60);
    expect(getSelFxPhase()).toBe("settled");
    expect(paints).toBe(2);
    expect(selCellSgr(1)).toContain(
      `48;2;${SEL_BG_RGB[0]};${SEL_BG_RGB[1]};${SEL_BG_RGB[2]}`,
    );
  });

  it("clear 复位", () => {
    selFxLive();
    selFxClear();
    expect(getSelFxPhase()).toBe("none");
  });
});
