import { describe, expect, it } from "vitest";
import { builtinCatalog } from "./seed.js";

describe("builtinCatalog merge", () => {
  it("keeps generated ids and handwritten domestic/local extras", () => {
    const ids = builtinCatalog().map((p) => p.id);
    expect(ids).toContain("openai");
    expect(ids).toContain("anthropic");
    expect(ids).toContain("deepseek");
    for (const extra of [
      "qwen",
      "ollama",
      "ernie",
      "spark",
      "doubao",
      "hunyuan",
      "qihoo-360",
    ]) {
      expect(ids).toContain(extra);
    }
  });
});
