import { describe, expect, it } from "vitest";
import {
  applyExitZeroWarning,
  detectExitZeroWarning,
  formatExitZeroWarning,
} from "./exit-zero-errors.js";

function fiftyErrorLines(): string {
  return Array.from({ length: 50 }, (_, i) => `ERROR line ${i + 1}`).join("\n");
}

describe("detectExitZeroWarning", () => {
  it("50 行 ERROR + exit 0 → warning + 最多 8 行样本", () => {
    const hit = detectExitZeroWarning(fiftyErrorLines(), 0);
    expect(hit).toBeTruthy();
    expect(hit!.count).toBe(50);
    expect(hit!.samples).toHaveLength(8);
    expect(hit!.samples[0]).toBe("ERROR line 1");
    expect(hit!.samples[7]).toBe("ERROR line 8");
    expect(formatExitZeroWarning(hit!)).toMatch(/^⚠ \[warning\]/);
    expect(formatExitZeroWarning(hit!)).toContain("ERROR line 1");
  });

  it("短输出 1 条 ERROR（echo err >&2; exit 0）也 warning", () => {
    const hit = detectExitZeroWarning("ERROR\n", 0);
    expect(hit).toBeTruthy();
    expect(hit!.count).toBe(1);
    expect(hit!.samples).toEqual(["ERROR"]);
  });

  it("短输出 1 条 ❌ 也 warning", () => {
    expect(detectExitZeroWarning("❌ boom", 0)?.count).toBe(1);
  });

  it("纯 warning: / npm warn / rustc warning / deprecated 不触发", () => {
    const noise = [
      "warning: unused variable",
      "npm warn deprecated foo@1.0.0",
      "rustc warning: dead_code",
      "this API is deprecated",
    ].join("\n");
    expect(detectExitZeroWarning(noise, 0)).toBeNull();
  });

  it("exit 1 不走这条", () => {
    expect(detectExitZeroWarning(fiftyErrorLines(), 1)).toBeNull();
    expect(detectExitZeroWarning("ERROR line 1", 1)).toBeNull();
  });

  it("弱错误行满 3 条才 warning，1 条 failed 不够", () => {
    expect(detectExitZeroWarning("build failed", 0)).toBeNull();
    const three = "cp: missing\nNo such file\ncannot open dir";
    const hit = detectExitZeroWarning(three, 0);
    expect(hit?.count).toBe(3);
  });

  it("正文最前加 ⚠ [warning]，payload/meta 带 warning=true", () => {
    const r = applyExitZeroWarning(
      "ok body",
      { exit_code: 0 },
      { exit_code: 0 },
      "ERROR line 1",
      0,
    );
    expect(r.body.startsWith("⚠ [warning]")).toBe(true);
    expect(r.body).toContain("ok body");
    expect(r.meta.warning).toBe(true);
    expect(r.payload.warning).toBe(true);
  });
});
