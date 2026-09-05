import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pickRoute, readConfigComputerUseMode, resolveComputerUseMode } from "./policy.js";

describe("resolveComputerUseMode", () => {
  it("cascades env → agent → config → auto", () => {
    expect(resolveComputerUseMode({ env: {}, agentMode: undefined })).toBe("auto");
    expect(resolveComputerUseMode({ env: { MAOU_COMPUTER_USE: "pixels" }, agentMode: "ax" })).toBe("pixels");
    expect(resolveComputerUseMode({ env: {}, agentMode: "ax" })).toBe("ax");
    expect(resolveComputerUseMode({ env: {}, configMode: "pixels" })).toBe("pixels");
  });

  it("reads config.json computerUse.mode", () => {
    const dir = mkdtempSync(join(tmpdir(), "cu-cfg-"));
    const path = join(dir, "config.json");
    writeFileSync(path, JSON.stringify({ computerUse: { mode: "ax" } }));
    expect(readConfigComputerUseMode(path)).toBe("ax");
    expect(resolveComputerUseMode({ env: {}, configPath: path })).toBe("ax");
  });
});

describe("pickRoute", () => {
  it("auto prefers a usable AX tree", () => {
    expect(
      pickRoute({ mode: "auto", axTrusted: true, axUsable: true, screenAllowed: true }),
    ).toEqual({ route: "ax" });
  });

  it("auto falls back to pixels when the tree is empty", () => {
    const d = pickRoute({ mode: "auto", axTrusted: true, axUsable: false, screenAllowed: true });
    expect(d.route).toBe("pixels");
    expect("reason" in d && d.reason).toMatch(/控件树/);
  });

  it("auto falls back when AX is not trusted", () => {
    const d = pickRoute({ mode: "auto", axTrusted: false, axUsable: false, screenAllowed: true });
    expect(d.route).toBe("pixels");
    expect("reason" in d && d.reason).toMatch(/辅助功能/);
  });

  it("ax fails closed without trust or elements", () => {
    expect(
      pickRoute({ mode: "ax", axTrusted: false, axUsable: true, screenAllowed: true }).route,
    ).toBeNull();
    expect(
      pickRoute({ mode: "ax", axTrusted: true, axUsable: false, screenAllowed: true }).route,
    ).toBeNull();
  });

  it("pixels requires screen recording", () => {
    expect(
      pickRoute({ mode: "pixels", axTrusted: true, axUsable: true, screenAllowed: false }).route,
    ).toBeNull();
    expect(
      pickRoute({ mode: "pixels", axTrusted: false, axUsable: false, screenAllowed: true }),
    ).toEqual({ route: "pixels" });
  });

  it("auto errors when both lanes are closed", () => {
    const d = pickRoute({ mode: "auto", axTrusted: false, axUsable: false, screenAllowed: false });
    expect(d.route).toBeNull();
    expect("error" in d && d.error).toMatch(/辅助功能与屏幕录制/);
  });
});
