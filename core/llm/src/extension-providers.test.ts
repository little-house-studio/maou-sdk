import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getProvider } from "./registry/index.js";
import {
  mapPiApiToProtocol,
  registerExtensionProviderRuntime,
  unregisterExtensionProviderRuntime,
  upsertPersistedExtensionProvider,
  loadPersistedExtensionPresets,
  loginExtensionProvider,
} from "./extension-providers.js";

describe("extension providers", () => {
  afterEach(() => {
    unregisterExtensionProviderRuntime("local-openai");
  });

  it("maps Pi api names to Maou protocols", () => {
    expect(mapPiApiToProtocol("openai-completions")).toBe("openai");
    expect(mapPiApiToProtocol("anthropic-messages")).toBe("anthropic");
    expect(mapPiApiToProtocol("openai-responses")).toBe("responses");
    expect(mapPiApiToProtocol("openai-codex-responses")).toBe("openai-codex");
  });

  it("registers into the model catalog", () => {
    const presets = registerExtensionProviderRuntime({
      name: "local-openai",
      baseUrl: "http://localhost:1234/v1",
      api: "openai-completions",
      apiKey: "sk-test",
      models: [{ id: "llama", contextWindow: 32000, maxTokens: 4096 }],
    });
    expect(presets[0]?.protocol).toBe("openai");
    expect(presets[0]?.model).toBe("llama");
    expect(getProvider("local-openai")?.models[0]?.id).toBe("llama");
  });

  it("persists and reloads presets", () => {
    const dir = mkdtempSync(join(tmpdir(), "maou-ext-prov-"));
    const file = join(dir, "extension-providers.json");
    try {
      upsertPersistedExtensionProvider(
        {
          name: "local-openai",
          baseUrl: "http://127.0.0.1:8080/v1",
          api: "anthropic-messages",
          models: [{ id: "claude" }],
        },
        file,
      );
      const loaded = loadPersistedExtensionPresets(file);
      expect(loaded.some((p) => p.name === "local-openai" && p.protocol === "anthropic")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runs extension oauth login and returns a key", async () => {
    const dir = mkdtempSync(join(tmpdir(), "maou-oauth-"));
    const prev = process.env.MAOU_OAUTH_DIR;
    process.env.MAOU_OAUTH_DIR = dir;
    registerExtensionProviderRuntime({
      name: "local-openai",
      baseUrl: "http://localhost",
      models: [{ id: "x" }],
      oauth: {
        name: "Local",
        async login(interaction) {
          interaction.onAuth({ url: "https://example.test/auth" });
          const code = await interaction.onPrompt({ message: "code" });
          return { access: `tok-${code}` };
        },
        getApiKey: (c) => c.access,
      },
    });
    const result = await loginExtensionProvider("local-openai", {
      onAuth() {},
      async onPrompt() {
        return "abc";
      },
    });
    expect(result.key).toBe("tok-abc");
    if (prev === undefined) delete process.env.MAOU_OAUTH_DIR;
    else process.env.MAOU_OAUTH_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  });
});
