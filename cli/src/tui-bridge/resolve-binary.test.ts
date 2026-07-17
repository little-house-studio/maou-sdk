import { describe, it, expect } from "vitest";
import { ratatuiBinaryName, resolveRatatuiBinary } from "./resolve-binary.js";

describe("resolve-binary", () => {
  it("binary name is platform-aware", () => {
    const n = ratatuiBinaryName();
    if (process.platform === "win32") {
      expect(n.endsWith(".exe")).toBe(true);
    } else {
      expect(n).toBe("maou-tui-ratatui");
    }
  });

  it("resolve returns string or null (no throw)", () => {
    const r = resolveRatatuiBinary();
    expect(r === null || typeof r === "string").toBe(true);
  });

  it("explicit missing path → null", () => {
    expect(resolveRatatuiBinary("/no/such/maou-tui-ratatui-xyz")).toBeNull();
  });
});
