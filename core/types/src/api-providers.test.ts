import { describe, expect, it } from "vitest";
import {
  coerceApiDocument,
  migratePresetsToProviders,
  providersToRuntimePresets,
  resolveProviderModel,
} from "./api-providers.js";

describe("migratePresetsToProviders", () => {
  it("migrates old flat presets (no models[])", () => {
    const providers = migratePresetsToProviders([
      {
        name: "ds",
        url: "https://api.deepseek.com/v1",
        protocol: "openai",
        key: "sk-x",
        model: "deepseek-chat",
      },
    ]);
    expect(Object.keys(providers)).toEqual(["deepseek"]);
    expect(providers.deepseek?.models[0]?.id).toBe("deepseek-chat");
  });

  it("migrates nested presets[] + models[]", () => {
    const providers = migratePresetsToProviders([
      {
        name: "primary",
        url: "https://api.example.com/v1",
        protocol: "openai",
        models: [{ id: "big" }, { id: "small" }],
      },
    ]);
    expect(Object.keys(providers)).toEqual(["primary"]);
    expect(providers.primary?.models.map((m) => m.id)).toEqual(["big", "small"]);
  });
});

describe("coerceApiDocument roles", () => {
  it("rewrites roles by name / index onto { provider, model }", () => {
    const doc = coerceApiDocument({
      presets: [
        {
          name: "keep",
          url: "https://x.example/v1",
          protocol: "openai",
          models: [{ id: "k" }],
        },
        {
          name: "gone",
          url: "https://y.example/v1",
          protocol: "openai",
          models: [{ id: "g" }],
        },
      ],
      roles: { main: "keep", fast: 1 },
    });
    expect(doc.roles.main).toEqual({ provider: "keep", model: "k" });
    expect(doc.roles.fast).toEqual({ provider: "gone", model: "g" });
    expect(doc.dirty).toBe(true);
  });

  it("resolves 1-vendor 3-model defaultPreset to that model", () => {
    const doc = coerceApiDocument({
      defaultPreset: 2,
      presets: [
        {
          name: "ds",
          url: "https://api.deepseek.com/v1",
          protocol: "openai",
          models: [{ id: "a" }, { id: "b" }, { id: "c" }],
        },
      ],
    });
    expect(doc.roles.main).toEqual({ provider: "deepseek", model: "c" });
  });

  it("keeps existing api.providers", () => {
    const doc = coerceApiDocument({
      providers: {
        qwen: {
          protocol: "openai",
          url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
          models: [{ id: "qwen-max" }],
        },
      },
      roles: { main: { provider: "qwen", model: "qwen-max" } },
    });
    expect(doc.dirty).toBe(false);
    expect(doc.providers.qwen?.models[0]?.id).toBe("qwen-max");
  });
});

describe("providersToRuntimePresets", () => {
  it("does not invent a fake provider per model", () => {
    const flat = providersToRuntimePresets({
      deepseek: {
        protocol: "openai",
        url: "https://api.deepseek.com/v1",
        models: [{ id: "chat" }, { id: "reasoner" }],
      },
    });
    expect(flat.map((p) => p._providerName)).toEqual(["deepseek", "deepseek"]);
    expect(flat.map((p) => p.model)).toEqual(["chat", "reasoner"]);
    expect(resolveProviderModel(
      {
        deepseek: {
          protocol: "openai",
          url: "https://api.deepseek.com/v1",
          models: [{ id: "chat" }, { id: "reasoner" }],
        },
      },
      "deepseek",
      "reasoner",
    )?.model).toBe("reasoner");
  });
});
