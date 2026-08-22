import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getApiPreset, loadPresetsFromMaouConfig } from "../api-presets.js";
import { applyLlmPresetToConfig, llmPresetFromFields } from "./apply-preset.js";
import { LLM_PRESET_SCHEMA } from "./builtins.js";
import { parseClipboard } from "./parse.js";

const dirs: string[] = [];

function tmpJson(): string {
  const dir = mkdtempSync(join(tmpdir(), "maou-paste-apply-"));
  dirs.push(dir);
  return join(dir, "config.json");
}

afterEach(() => {
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

describe("llmPresetFromFields", () => {
  it("builds from confirmed form values", () => {
    const r = llmPresetFromFields({
      api_key: "sk-abcDEF1234567890xyz",
      base_url: "https://api.deepseek.com/v1",
      protocol: "openai",
      model: "deepseek-chat",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.preset.key).toBe("sk-abcDEF1234567890xyz");
    expect(r.preset.url).toBe("https://api.deepseek.com/v1");
    expect(r.preset.model).toBe("deepseek-chat");
    expect(r.preset.name).toBe("deepseek.com/deepseek-chat");
  });

  it("refuses when url or model is missing", () => {
    expect(llmPresetFromFields({ api_key: "sk-abcDEF1234567890xyz" }).ok).toBe(false);
    expect(
      llmPresetFromFields({
        base_url: "https://api.example.com/v1",
        api_key: "sk-abcDEF1234567890xyz",
      }).ok,
    ).toBe(false);
  });
});

describe("applyLlmPresetToConfig", () => {
  it("writes a confirmed form to config.json", () => {
    const path = tmpJson();
    const r = applyLlmPresetToConfig(
      {
        api_key: "sk-test",
        base_url: "https://api.openai.com/v1",
        protocol: "openai",
        model: "gpt-4o",
        name: "openai/gpt-4o",
      },
      { configPath: path },
    );
    expect(r.ok).toBe(true);
    expect(getApiPreset("openai/gpt-4o", path)?.key).toBe("sk-test");
  });

  it("can skip review and write a parse result", async () => {
    const path = tmpJson();
    const parsed = await parseClipboard(
      [
        "api_key: sk-abcDEF1234567890",
        "base_url: https://api.openai.com/v1",
        "model: gpt-4o",
      ].join("\n"),
      LLM_PRESET_SCHEMA,
      { probeModels: false },
    );
    const r = applyLlmPresetToConfig(parsed, { configPath: path });
    expect(r.ok).toBe(true);
    expect(loadPresetsFromMaouConfig(path)).toHaveLength(1);
    expect(getApiPreset("openai.com/gpt-4o", path)?.model).toBe("gpt-4o");
  });

  it("does not write when the form is incomplete", () => {
    const path = tmpJson();
    const r = applyLlmPresetToConfig(
      { api_key: "sk-only" },
      { configPath: path },
    );
    expect(r.ok).toBe(false);
    expect(loadPresetsFromMaouConfig(path)).toHaveLength(0);
  });
});
