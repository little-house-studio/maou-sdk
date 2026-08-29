import { describe, expect, it } from "vitest";
import { pluginColorsOk } from "./plugin-contract.js";

describe("pluginColorsOk", () => {
  it("requires both palettes", () => {
    expect(pluginColorsOk({ light: { "--x": "#fff" } })).toBe(false);
    expect(pluginColorsOk({ light: { "--x": "#fff" }, dark: { "--x": "#000" } })).toBe(true);
  });
});
