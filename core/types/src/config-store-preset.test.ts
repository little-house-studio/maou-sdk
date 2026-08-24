import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigStore, normalizeLoadedPreset } from "./config-store.js";

describe("normalizeLoadedPreset", () => {
  it("keeps extraBody, pricing nest, and dual-writes reasoning_params", () => {
    const n = normalizeLoadedPreset({
      name: "t",
      url: "https://x",
      model: "m",
      // normalize 作用于 expand 后的扁平项
      temperature: 0.5,
      inputPrice: 1,
      outputPrice: 2,
      reasoningParams: { effort: "high" },
      maxConcurrent: 2,
      supportsAudio: true,
      supportsVideo: false,
      fooCustom: "kept",
    });
    expect(n.extraBody).toMatchObject({ temperature: 0.5 });
    expect(n.pricing).toMatchObject({ inputPrice: 1, outputPrice: 2 });
    expect(n.reasoning_params).toEqual({ effort: "high" });
    expect(n.reasoningParams).toEqual({ effort: "high" });
    expect(n.max_concurrent).toBe(2);
    expect(n.supportsAudio).toBe(true);
    expect(n.fooCustom).toBe("kept");
  });
});

describe("ConfigStore preserves extended preset fields", () => {
  it("does not strip extraBody / pricing / temperature after load", () => {
    const dir = mkdtempSync(join(tmpdir(), "maou-cfg-preset-"));
    const userDir = dir;
    const configPath = join(userDir, "config.json");
    try {
      writeFileSync(
        configPath,
        JSON.stringify({
          api: {
            defaultPreset: 0,
            roles: { main: "p1" },
            presets: [
              {
                name: "p1",
                url: "https://api.example.com/v1",
                key: "sk-test",
                protocol: "openai",
                defaultModel: "gpt-x",
                maxConcurrent: 2,
                reasoning_params: { thinking: { type: "enabled" } },
                models: [
                  {
                    id: "gpt-x",
                    maxTokens: 4096,
                    maxContext: 128000,
                    temperature: 0.4,
                    input_price: 3,
                    output_price: 9,
                    extraBody: { thinking: { type: "disabled" } },
                    supportsAudio: true,
                    supportsVideo: true,
                  },
                ],
              },
            ],
          },
        }),
        "utf-8",
      );

      // ConfigStore uses resolveUserConfigPath — override via MAOU_LLM_CONFIG
      const prev = process.env.MAOU_LLM_CONFIG;
      process.env.MAOU_LLM_CONFIG = configPath;
      try {
        const store = new ConfigStore(dir, userDir);
        const preset = store.getPreset() as Record<string, unknown>;
        expect(preset.name).toBe("p1");
        expect(preset.temperature).toBe(0.4);
        expect(preset.extraBody).toMatchObject({
          thinking: { type: "disabled" },
          temperature: 0.4,
        });
        expect(preset.pricing).toMatchObject({
          inputPrice: 3,
          outputPrice: 9,
        });
        expect(preset.reasoning_params).toEqual({
          thinking: { type: "enabled" },
        });
        expect(preset.supportsAudio).toBe(true);
        expect(preset.maxConcurrent).toBe(2);
      } finally {
        if (prev === undefined) delete process.env.MAOU_LLM_CONFIG;
        else process.env.MAOU_LLM_CONFIG = prev;
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps oauth / oauthProvider on a preset", () => {
    const dir = mkdtempSync(join(tmpdir(), "maou-cfg-oauth-"));
    const configPath = join(dir, "config.json");
    const prev = process.env.MAOU_LLM_CONFIG;
    try {
      writeFileSync(
        configPath,
        JSON.stringify({
          api: {
            defaultPreset: 0,
            presets: [
              {
                name: "sub",
                url: "https://api.anthropic.com",
                key: "",
                protocol: "anthropic",
                oauth: true,
                oauthProvider: "anthropic",
                models: [{ id: "claude-sonnet-4-5" }],
              },
            ],
          },
        }),
        "utf-8",
      );
      process.env.MAOU_LLM_CONFIG = configPath;
      const store = new ConfigStore(dir, dir);
      const preset = store.getPreset() as Record<string, unknown>;
      expect(preset.oauth).toBe(true);
      expect(preset.oauthProvider).toBe("anthropic");
      expect(preset.key).toBe("");
    } finally {
      if (prev === undefined) delete process.env.MAOU_LLM_CONFIG;
      else process.env.MAOU_LLM_CONFIG = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
