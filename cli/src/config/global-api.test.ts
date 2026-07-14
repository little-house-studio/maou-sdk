import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  isGlobalApiConfigured,
  saveGlobalApiConfig,
  loadPresetsFromMaouConfig,
  resolveMaouConfigPath,
} from "@little-house-studio/agent";

describe("global API config (series-wide)", () => {
  let dir: string;
  let prev: Record<string, string | undefined>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "maou-api-"));
    prev = {
      MAOU_HOME: process.env.MAOU_HOME,
      MAOU_LLM_CONFIG: process.env.MAOU_LLM_CONFIG,
      MAOU_API_KEY: process.env.MAOU_API_KEY,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      MAOU_SKIP_API_SETUP: process.env.MAOU_SKIP_API_SETUP,
    };
    process.env.MAOU_HOME = dir;
    delete process.env.MAOU_LLM_CONFIG;
    delete process.env.MAOU_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.MAOU_SKIP_API_SETUP;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("empty → not configured", () => {
    expect(isGlobalApiConfigured()).toBe(false);
  });

  it("save + load + configured", () => {
    const path = saveGlobalApiConfig({
      presets: [
        {
          name: "t",
          url: "https://example.com/v1/chat/completions",
          key: "sk-test",
          model: "m",
          protocol: "openai",
        },
      ],
      replace: true,
    });
    expect(path).toBe(resolveMaouConfigPath());
    expect(existsSync(path)).toBe(true);
    expect(loadPresetsFromMaouConfig()[0]!.key).toBe("sk-test");
    expect(isGlobalApiConfigured()).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf-8")).api.presets[0].model).toBe("m");
  });

  it("env key counts as configured", () => {
    process.env.OPENAI_API_KEY = "sk-env";
    expect(isGlobalApiConfigured()).toBe(true);
  });
});
