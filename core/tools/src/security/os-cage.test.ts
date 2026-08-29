import { afterEach, describe, expect, it } from "vitest";
import {
  detectCageBackend,
  isolationFromSandboxMode,
  isWiderIsolation,
  resetCageForTest,
  setCageBackendForTest,
  setCageOverride,
  shQuote,
  wrapCommandInCage,
} from "./os-cage.js";

afterEach(() => {
  resetCageForTest();
});

describe("os-cage", () => {
  it("quotes shell metacharacters", () => {
    expect(shQuote("a b")).toBe("'a b'");
    expect(shQuote("it's")).toBe("'it'\\''s'");
  });

  it("ranks isolation", () => {
    expect(isWiderIsolation("workspace", "readonly")).toBe(true);
    expect(isWiderIsolation("open", "workspace")).toBe(true);
    expect(isWiderIsolation("workspace", "open")).toBe(false);
  });

  it("maps legacy sandboxMode", () => {
    expect(isolationFromSandboxMode("yolo")).toBe("open");
    expect(isolationFromSandboxMode("normal")).toBe("workspace");
  });

  it("refuses when cage is unavailable", () => {
    setCageOverride("unavailable");
    const r = wrapCommandInCage("echo hi", { isolation: "workspace", workspace: "/tmp/proj" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("cage_unavailable");
  });

  it("passthrough leaves the command alone", () => {
    setCageOverride("passthrough");
    const r = wrapCommandInCage("echo hi", { isolation: "workspace", workspace: "/tmp/proj" });
    expect(r).toMatchObject({ ok: true, command: "echo hi", backend: "none" });
  });

  it("wraps with sandbox-exec profile", () => {
    setCageBackendForTest("sandbox-exec");
    const r = wrapCommandInCage("echo hi", { isolation: "workspace", workspace: "/tmp/proj" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.backend).toBe("sandbox-exec");
      expect(r.command).toContain("sandbox-exec");
      expect(r.command).toContain("echo hi");
      expect(r.command).toContain("/tmp/proj");
    }
  });

  it("windows detect is closed unless injected", () => {
    if (process.platform === "win32") {
      expect(detectCageBackend()).toBeNull();
    }
  });
});
