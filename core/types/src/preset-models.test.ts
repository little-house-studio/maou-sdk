import { describe, it, expect } from "vitest";
import {
  expandPresetModels,
  expandAllPresets,
  collapsePresetsToNested,
  migratePresetToNested,
  migratePresetsToNested,
} from "./preset-models.js";

describe("preset multi-model expand/collapse", () => {
  it("expands nested models[] to flat runtime presets", () => {
    const flat = expandPresetModels({
      name: "ds-flash",
      url: "https://example.com/v1",
      key: "sk-x",
      protocol: "openai",
      models: [
        { id: "deepseek-v4-flash-free", maxContext: 500_000, maxTokens: 8_000 },
        { id: "other", name: "lite", maxContext: 32_000 },
      ],
    });
    expect(flat).toHaveLength(2);
    expect(flat[0]!.name).toBe("ds-flash/deepseek-v4-flash-free");
    expect(flat[0]!.model).toBe("deepseek-v4-flash-free");
    expect(flat[0]!.maxContext).toBe(500_000);
    expect(flat[0]!.url).toBe("https://example.com/v1");
    expect(flat[0]!.key).toBe("sk-x");
    expect(flat[1]!.name).toBe("ds-flash/lite");
    expect(flat[1]!.model).toBe("other");
    expect(flat[1]!.maxContext).toBe(32_000);
  });

  it("single model keeps provider name", () => {
    const flat = expandPresetModels({
      name: "ds-flash",
      url: "https://example.com/v1",
      key: "sk-x",
      models: [{ id: "only-one", maxContext: 1 }],
    });
    expect(flat).toHaveLength(1);
    expect(flat[0]!.name).toBe("ds-flash");
    expect(flat[0]!.model).toBe("only-one");
  });

  it("expandPresetModels rejects disk-flat without models[]", () => {
    const flat = expandPresetModels({
      name: "legacy",
      url: "https://a",
      key: "k",
      model: "m1",
      maxTokens: 100,
    });
    expect(flat).toHaveLength(0);
  });

  it("expandAllPresets still accepts runtime-flat (save path)", () => {
    const flat = expandAllPresets([
      {
        name: "runtime",
        url: "https://a",
        key: "k",
        model: "m1",
        maxTokens: 100,
      },
    ]);
    expect(flat).toHaveLength(1);
    expect(flat[0]!.name).toBe("runtime");
    expect(flat[0]!.model).toBe("m1");
  });

  it("collapse groups by connection", () => {
    const nested = collapsePresetsToNested([
      {
        name: "ds-flash/a",
        url: "https://example.com/v1",
        key: "sk",
        protocol: "openai",
        vendor: "openai",
        model: "model-a",
        maxContext: 100,
        _providerName: "ds-flash",
      },
      {
        name: "ds-flash/b",
        url: "https://example.com/v1",
        key: "sk",
        protocol: "openai",
        vendor: "openai",
        model: "model-b",
        maxContext: 200,
        _providerName: "ds-flash",
      },
    ]);
    expect(nested).toHaveLength(1);
    expect(nested[0]!.name).toBe("ds-flash");
    expect(Array.isArray(nested[0]!.models)).toBe(true);
    expect((nested[0]!.models as unknown[]).length).toBe(2);
    // 磁盘不再写旧式顶层 model
    expect(nested[0]!.model).toBeUndefined();
    expect(nested[0]!.defaultModel).toBe("model-a");
  });

  it("expandAll roundtrip multi", () => {
    const disk = [
      {
        name: "p",
        url: "https://u",
        key: "k",
        protocol: "openai",
        models: [{ id: "m1" }, { id: "m2" }],
      },
    ];
    const flat = expandAllPresets(disk);
    expect(flat).toHaveLength(2);
    const again = collapsePresetsToNested(flat);
    expect(again).toHaveLength(1);
    expect((again[0]!.models as unknown[]).length).toBe(2);
  });

  it("preserves runtime names via presetName on collapse/expand", () => {
    const flat = [
      {
        name: "my-main",
        url: "https://u",
        key: "k",
        protocol: "openai",
        vendor: "openai",
        model: "m1",
      },
      {
        name: "my-fast",
        url: "https://u",
        key: "k",
        protocol: "openai",
        vendor: "openai",
        model: "m2",
      },
    ];
    const nested = collapsePresetsToNested(flat);
    const again = expandAllPresets(nested);
    expect(again.map((p) => p.name).sort()).toEqual(["my-fast", "my-main"]);
  });

  it("migratePresetToNested converts flat to models[]", () => {
    const nested = migratePresetToNested({
      name: "ds-flash",
      url: "https://example.com/v1",
      key: "sk-x",
      model: "deepseek-v4-flash-free",
      maxContext: 500_000,
      maxTokens: 8_000,
      supportsReasoning: true,
      protocol: "openai",
    });
    expect(nested).not.toBeNull();
    expect(nested!.model).toBeUndefined();
    expect(nested!.defaultModel).toBe("deepseek-v4-flash-free");
    expect(Array.isArray(nested!.models)).toBe(true);
    const m = (nested!.models as Array<Record<string, unknown>>)[0]!;
    expect(m.id).toBe("deepseek-v4-flash-free");
    expect(m.maxContext).toBe(500_000);
    expect(m.presetName).toBe("ds-flash");
    // expand 后 roles 仍可用 name
    const flat = expandPresetModels(nested);
    expect(flat).toHaveLength(1);
    expect(flat[0]!.name).toBe("ds-flash");
    expect(flat[0]!.model).toBe("deepseek-v4-flash-free");
  });

  it("migratePresetsToNested batch", () => {
    const out = migratePresetsToNested([
      { name: "a", url: "u", key: "k", model: "m1" },
      { name: "b", url: "u2", key: "k2", models: [{ id: "m2" }] },
    ]);
    expect(out).toHaveLength(2);
    expect((out[0]!.models as unknown[]).length).toBe(1);
    expect((out[1]!.models as unknown[]).length).toBe(1);
  });
});
