import { describe, it, expect } from "vitest";
import { buildSearchArgs, normalizeLang } from "./index.js";

describe("normalizeLang", () => {
  it("maps common aliases", () => {
    expect(normalizeLang("ts")).toBe("typescript");
    expect(normalizeLang("tsx")).toBe("typescript");
    expect(normalizeLang("js")).toBe("javascript");
    expect(normalizeLang("py")).toBe("python");
    expect(normalizeLang("rs")).toBe("rust");
    expect(normalizeLang("TypeScript")).toBe("typescript");
  });

  it("keeps unknown ids as lowercase", () => {
    expect(normalizeLang("typescript")).toBe("typescript");
    expect(normalizeLang("zig")).toBe("zig");
  });
});

describe("buildSearchArgs (sqry 19 global flags)", () => {
  it("puts kind/lang/exact/fuzzy BEFORE search subcommand", () => {
    const args = buildSearchArgs("CodeSearchTool", {
      kind: "class",
      lang: "ts",
      exact: true,
    });
    // 全局选项必须在 search 之前
    const searchIdx = args.indexOf("search");
    expect(searchIdx).toBeGreaterThan(0);
    expect(args.indexOf("--kind")).toBeLessThan(searchIdx);
    expect(args.indexOf("--lang")).toBeLessThan(searchIdx);
    expect(args.indexOf("--exact")).toBeLessThan(searchIdx);
    expect(args).toContain("typescript"); // ts → typescript
    expect(args.slice(searchIdx)).toEqual(["search", "--json", "CodeSearchTool", "."]);
  });

  it("works without filters", () => {
    expect(buildSearchArgs("foo")).toEqual(["search", "--json", "foo", "."]);
  });
});
