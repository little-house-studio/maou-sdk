import { describe, expect, it } from "vitest";
import {
  registerToolCardPreset,
  resetToolCardPresetsForTest,
  resolveToolCardDress,
} from "./tool-card.js";

describe("tool card presets", () => {
  it("maps built-ins and extras", () => {
    resetToolCardPresetsForTest();
    expect(resolveToolCardDress("read_file")).toBe("read");
    expect(resolveToolCardDress("edit_file")).toBe("edit");
    expect(resolveToolCardDress("grep")).toBe("search");
    expect(resolveToolCardDress("custom_x")).toBe("generic");
    const off = registerToolCardPreset({
      id: "custom",
      match: { names: ["custom_x"] },
      dress: "web",
    });
    expect(resolveToolCardDress("custom_x")).toBe("web");
    off();
    expect(resolveToolCardDress("custom_x")).toBe("generic");
  });
});
