/**
 * Pure API settings helpers — real shipped functions from api-settings.ts.
 * Covers LLM-aligned window + capability fields.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addApiPreset,
  apiConfigsEqual,
  capabilitySummary,
  cloneApiConfig,
  DEFAULT_MAX_CONTEXT,
  DEFAULT_MAX_TOKENS,
  defaultApiConfig,
  defaultCapabilityFields,
  emptyApiPreset,
  formatTokenCount,
  getDefaultPreset,
  isApiPresetValid,
  maskApiKey,
  normalizeApiPreset,
  removeApiPreset,
  setDefaultApiPreset,
  updateApiPreset,
  validateApiPreset,
} from "./api-settings";

describe("api-settings helpers", () => {
  it("defaultApiConfig seeds connection + window + capability fields", () => {
    const cfg = defaultApiConfig();
    assert.ok(cfg.presets.length >= 1);
    assert.equal(typeof cfg.defaultPreset, "number");
    const p = cfg.presets[0]!;
    assert.ok(p.name);
    assert.ok(p.url);
    assert.ok(p.key);
    assert.ok(p.model);
    assert.ok(["openai", "anthropic", "openai-responses"].includes(p.protocol));
    assert.equal(p.maxContext, DEFAULT_MAX_CONTEXT);
    assert.equal(p.maxTokens, DEFAULT_MAX_TOKENS);
    assert.equal(p.supportsVision, true);
    assert.equal(p.supportsReasoning, true);
    assert.equal(p.nativeToolCalling, true);
    assert.equal(getDefaultPreset(cfg)?.name, p.name);
  });

  it("emptyApiPreset / defaultCapabilityFields match maou-setup-like defaults", () => {
    const caps = defaultCapabilityFields();
    assert.equal(caps.maxContext, 128_000);
    assert.equal(caps.maxTokens, 32_768);
    assert.equal(caps.supportsVision, true);
    assert.equal(caps.supportsReasoning, true);
    assert.equal(caps.nativeToolCalling, true);
    const e = emptyApiPreset(3);
    assert.equal(e.name, "preset-3");
    assert.equal(e.maxContext, DEFAULT_MAX_CONTEXT);
    assert.equal(e.supportsVision, true);
  });

  it("normalizeApiPreset fills missing capability fields", () => {
    const n = normalizeApiPreset({
      name: "x",
      url: "https://api.example.com/v1",
      key: "k",
      model: "m",
      protocol: "openai",
    } as Parameters<typeof normalizeApiPreset>[0]);
    assert.equal(n.maxContext, DEFAULT_MAX_CONTEXT);
    assert.equal(n.maxTokens, DEFAULT_MAX_TOKENS);
    assert.equal(n.nativeToolCalling, true);
  });

  it("maskApiKey never returns full long secrets", () => {
    const full = "sk-draft-openai-example-key-0001";
    const masked = maskApiKey(full);
    assert.notEqual(masked, full);
    assert.ok(!masked.includes("example-key"));
    assert.match(masked, /•/);
    assert.equal(maskApiKey(""), "（未设置）");
    assert.equal(maskApiKey("short"), "•••••");
  });

  it("validateApiPreset flags empty identity and invalid windows", () => {
    const bad = emptyApiPreset();
    bad.name = "";
    bad.url = "not-a-url";
    bad.model = "  ";
    bad.maxContext = 100;
    bad.maxTokens = 0;
    const err = validateApiPreset(bad);
    assert.ok(err.name);
    assert.ok(err.url);
    assert.ok(err.model);
    assert.ok(err.maxContext);
    assert.ok(err.maxTokens);
    assert.equal(isApiPresetValid(bad), false);
    assert.equal(isApiPresetValid(defaultApiConfig().presets[0]!), true);
  });

  it("add / update / remove preserve capability fields immutably", () => {
    const base = defaultApiConfig();
    const added = addApiPreset(base);
    assert.equal(added.presets.length, base.presets.length + 1);
    const idx = added.presets.length - 1;
    assert.equal(added.presets[idx]!.supportsVision, true);
    assert.equal(added.presets[idx]!.maxContext, DEFAULT_MAX_CONTEXT);

    const updated = updateApiPreset(added, idx, {
      name: "local-llm",
      model: "qwen3",
      url: "http://127.0.0.1:8080/v1",
      maxContext: 64_000,
      maxTokens: 8192,
      supportsVision: false,
      supportsReasoning: false,
      nativeToolCalling: true,
    });
    const u = updated.presets[idx]!;
    assert.equal(u.name, "local-llm");
    assert.equal(u.maxContext, 64_000);
    assert.equal(u.maxTokens, 8192);
    assert.equal(u.supportsVision, false);
    assert.equal(u.supportsReasoning, false);
    assert.equal(u.nativeToolCalling, true);
    // original unchanged
    assert.notEqual(added.presets[idx]!.name, "local-llm");
    assert.equal(added.presets[idx]!.supportsVision, true);

    const asDefault = setDefaultApiPreset(updated, idx);
    assert.equal(getDefaultPreset(asDefault)?.maxContext, 64_000);

    const removed = removeApiPreset(asDefault, idx);
    assert.ok(!removed.presets.some((p) => p.name === "local-llm"));
  });

  it("cloneApiConfig deep-copies presets including capabilities", () => {
    const a = defaultApiConfig();
    const b = cloneApiConfig(a);
    assert.ok(apiConfigsEqual(a, b));
    b.presets[0]!.supportsVision = false;
    b.presets[0]!.maxContext = 1;
    assert.equal(a.presets[0]!.supportsVision, true);
    assert.equal(a.presets[0]!.maxContext, DEFAULT_MAX_CONTEXT);
  });

  it("remove last remaining preset resets to empty editable slot with caps", () => {
    let cfg = {
      defaultPreset: 0,
      presets: [emptyApiPreset(1)],
    };
    cfg = removeApiPreset(cfg, 0);
    assert.equal(cfg.presets.length, 1);
    assert.equal(cfg.presets[0]!.maxTokens, DEFAULT_MAX_TOKENS);
    assert.equal(cfg.presets[0]!.nativeToolCalling, true);
  });

  it("capabilitySummary and formatTokenCount describe the preset", () => {
    const p = defaultApiConfig().presets[0]!;
    const s = capabilitySummary(p);
    assert.match(s, /视觉/);
    assert.match(s, /推理/);
    assert.match(s, /工具/);
    assert.match(s, /128k|上下文/);
    assert.equal(formatTokenCount(128_000), "128k");
    assert.equal(formatTokenCount(32_768), "33k");
  });
});
