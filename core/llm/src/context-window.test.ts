import { afterEach, describe, expect, it } from "vitest";
import {
  FALLBACK_CONTEXT_WINDOW,
  backfillContextWindow,
  contextWindowOf,
  resolveContextWindow,
} from "./context-window.js";
import { registerProvider, unregisterProvider } from "./registry/index.js";

const PROVIDER = "ctxwin-test";

function seedCatalog(contextWindow: number): void {
  registerProvider({
    id: PROVIDER,
    name: "ctxwin",
    protocol: "openai",
    models: [
      {
        id: "wide-model",
        name: "wide",
        provider: PROVIDER,
        protocol: "openai",
        contextWindow,
      },
    ],
  } as never);
}

describe("resolveContextWindow", () => {
  afterEach(() => {
    unregisterProvider(PROVIDER);
  });

  it("prefers an explicit maxContext", () => {
    seedCatalog(1_000_000);
    const r = resolveContextWindow({ model: "wide-model", maxContext: 32_000 });
    expect(r).toMatchObject({ window: 32_000, source: "preset" });
  });

  it("reads the model catalog before falling back to maxTokens", () => {
    seedCatalog(1_000_000);
    // maxTokens 是输出上限，ConfigStore 给它的默认值是 65536——不能当窗口用
    const r = resolveContextWindow({ model: "wide-model", maxTokens: 65_536 });
    expect(r).toMatchObject({ window: 1_000_000, source: "catalog" });
  });

  it("keeps maxTokens as a labelled guess when the catalog misses", () => {
    const r = resolveContextWindow({ model: "unknown-model-xyz", maxTokens: 8_192 });
    expect(r).toMatchObject({ window: 8_192, source: "max_tokens" });
  });

  it("falls back to a conservatively large window, never 65536", () => {
    const r = resolveContextWindow({ model: "unknown-model-xyz" });
    expect(r).toMatchObject({ window: FALLBACK_CONTEXT_WINDOW, source: "fallback" });
    expect(r.window).toBeGreaterThan(65_536);
    expect(resolveContextWindow(null).window).toBe(FALLBACK_CONTEXT_WINDOW);
    expect(contextWindowOf(undefined)).toBe(FALLBACK_CONTEXT_WINDOW);
  });

  it("ignores zero and negative values", () => {
    expect(resolveContextWindow({ maxContext: 0, maxTokens: -1 }).source).toBe("fallback");
  });

  it("scopes the lookup to the preset provider when given", () => {
    seedCatalog(1_000_000);
    expect(
      resolveContextWindow({ provider: PROVIDER, model: "wide-model" }).window,
    ).toBe(1_000_000);
  });
});

describe("backfillContextWindow", () => {
  afterEach(() => {
    unregisterProvider(PROVIDER);
  });

  it("writes maxContext from the catalog without touching a user value", () => {
    seedCatalog(400_000);
    expect(backfillContextWindow({ model: "wide-model" }).maxContext).toBe(400_000);
    expect(backfillContextWindow({ model: "wide-model", maxContext: 1 }).maxContext).toBe(1);
  });

  it("leaves the preset alone when the catalog misses", () => {
    const preset = { model: "unknown-model-xyz" };
    expect(backfillContextWindow(preset)).toBe(preset);
  });
});
