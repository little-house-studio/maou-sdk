import { describe, expect, it } from "vitest";
import {
  isUnlimitedRounds,
  resolveRunRoundLimit,
  shouldContinueRound,
} from "./round-limit.js";

describe("resolveRunRoundLimit", () => {
  it("agent.json 的 0 生效，不回落到运行时默认", () => {
    expect(resolveRunRoundLimit(50, 0)).toBe(0);
  });

  it("coding 默认 0 且未写 agent.json 时仍是 0", () => {
    expect(resolveRunRoundLimit(0, undefined)).toBe(0);
  });

  it("正数 agent.json 覆盖运行时默认", () => {
    expect(resolveRunRoundLimit(0, 80)).toBe(80);
  });

  it("非法 agent.json 回落到运行时默认", () => {
    expect(resolveRunRoundLimit(0, -1)).toBe(0);
    expect(resolveRunRoundLimit(12, Number.NaN)).toBe(12);
  });
});

describe("shouldContinueRound", () => {
  it("0 不按 200 截断", () => {
    expect(isUnlimitedRounds(0)).toBe(true);
    expect(shouldContinueRound(200, 0)).toBe(true);
    expect(shouldContinueRound(1000, 0)).toBe(true);
  });

  it("正数打满即停", () => {
    expect(shouldContinueRound(49, 50)).toBe(true);
    expect(shouldContinueRound(50, 50)).toBe(false);
  });
});
