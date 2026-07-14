import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetAnimClockForTests, getAnimFrame, spinnerChar } from "./useAnimFrame.js";

describe("useAnimFrame clock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetAnimClockForTests();
  });
  afterEach(() => {
    resetAnimClockForTests();
    vi.useRealTimers();
  });

  it("spinnerChar 循环", () => {
    expect(spinnerChar(0)).toBe("⠋");
    expect(spinnerChar(10)).toBe("⠋");
  });

  it("无订阅者时不推进 frame", () => {
    expect(getAnimFrame()).toBe(0);
    vi.advanceTimersByTime(500);
    expect(getAnimFrame()).toBe(0);
  });
});
