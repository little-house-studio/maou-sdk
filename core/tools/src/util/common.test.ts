/**
 * util/common 结构与行为：权威路径在 util，browser/_util 仅 re-export。
 */
import { describe, it, expect } from "vitest";
import { errToString, truncateMiddle, formatMetadata } from "./common.js";
import * as browserUtil from "../browser/god_tool/use_browser/_util.js";

describe("tools util/common", () => {
  it("errToString includes Error.cause", () => {
    const err = new Error("outer");
    (err as { cause?: unknown }).cause = new Error("root");
    expect(errToString(err)).toContain("outer");
    expect(errToString(err)).toContain("root");
  });

  it("truncateMiddle keeps short text", () => {
    expect(truncateMiddle("hi", 100)).toBe("hi");
  });

  it("formatMetadata skips empty fields", () => {
    expect(formatMetadata({ a: 1, b: "", c: null })).toBe("[a=1]");
  });

  it("browser _util re-exports same helpers (compat path)", () => {
    expect(browserUtil.errToString).toBe(errToString);
    expect(browserUtil.truncateMiddle).toBe(truncateMiddle);
    expect(browserUtil.formatMetadata).toBe(formatMetadata);
  });
});
