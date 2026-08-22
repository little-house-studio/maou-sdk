import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LLMConfig } from "./llm-config.js";

const dirs: string[] = [];

function tmpConfig(): string {
  const dir = mkdtempSync(join(tmpdir(), "maou-llm-cfg-"));
  dirs.push(dir);
  return join(dir, "llm-config.json");
}

afterEach(() => {
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

describe("LLMConfig", () => {
  it("merges builtin catalog when builtin=true", () => {
    const cfg = new LLMConfig({ configPath: tmpConfig(), autoload: false });
    expect(cfg.listProviders()).toEqual(
      expect.arrayContaining(["openai", "anthropic", "google", "deepseek"]),
    );
    expect(cfg.getModel("anthropic", "claude-sonnet-4-5")?.pricing?.input).toBe(3);
    const preset = cfg.toAPIPreset("anthropic", "claude-sonnet-4-5");
    expect(preset.protocol).toBe("anthropic");
    expect(preset.model).toBe("claude-sonnet-4-5");
  });

  it("can hide builtin catalog", () => {
    const cfg = new LLMConfig({
      configPath: tmpConfig(),
      autoload: false,
      builtin: false,
    });
    expect(cfg.listProviders()).toEqual([]);
  });

  it("persists custom provider and reads envKey", async () => {
    const path = tmpConfig();
    const cfg = new LLMConfig({ configPath: path, autoload: false, builtin: false });
    cfg.addCustomProvider({
      id: "my-api",
      name: "My API",
      protocol: "openai",
      baseUrl: "https://example.test/v1/chat/completions",
      envKey: "MAOU_TEST_MY_API_KEY",
      models: [{ id: "v1", name: "V1" }],
    });
    await cfg.save();

    process.env.MAOU_TEST_MY_API_KEY = "sk-from-env";
    try {
      const loaded = new LLMConfig({ configPath: path, builtin: false });
      expect(loaded.getCustomProvider("my-api")?.envKey).toBe("MAOU_TEST_MY_API_KEY");
      expect(loaded.toAPIPreset("my-api", "v1").key).toBe("sk-from-env");
    } finally {
      delete process.env.MAOU_TEST_MY_API_KEY;
    }
  });

  it("loadSeed + importFromCatalog", () => {
    const cfg = new LLMConfig({ configPath: tmpConfig(), autoload: false, builtin: true });
    cfg.loadSeed([
      {
        id: "seeded",
        name: "Seeded",
        protocol: "openai",
        baseUrl: "https://seed.test/v1",
        models: [
          {
            id: "s1",
            provider: "seeded",
            name: "S1",
            protocol: "openai",
            input: ["text"],
            output: ["text"],
            reasoning: false,
            toolCall: true,
          },
        ],
      },
    ]);
    expect(cfg.listProviders()).toContain("seeded");
    expect(cfg.getModel("seeded", "s1")?.name).toBe("S1");

    const imported = cfg.importFromCatalog("anthropic", "claude-sonnet-4-5", "sonnet");
    expect(imported.name).toBe("sonnet");
    expect(cfg.getCustom("sonnet")?.model).toBe("claude-sonnet-4-5");
  });

  it("fetchRemoteModels parses OpenAI-style payload", async () => {
    const cfg = new LLMConfig({ configPath: tmpConfig(), autoload: false, builtin: false });
    cfg.addCustom({
      name: "remote",
      model: "x",
      url: "https://remote.test/v1/chat/completions",
      key: "sk-x",
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: [{ id: "a" }, { id: "b" }] }), {
        status: 200,
      })) as typeof fetch;
    try {
      await expect(cfg.fetchRemoteModels("remote")).resolves.toEqual(["a", "b"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
