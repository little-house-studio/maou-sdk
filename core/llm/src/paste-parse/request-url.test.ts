import { describe, expect, it } from "vitest";
import { LLM_PRESET_SCHEMA } from "./builtins.js";
import { parseClipboard } from "./parse.js";
import { inferProtocolFromUrl, normalizePastedProtocol } from "./request-url.js";

describe("inferProtocolFromUrl", () => {
  it("reads path / host, otherwise cc → openai", () => {
    expect(inferProtocolFromUrl("https://api.anthropic.com/v1/messages")).toBe("anthropic");
    expect(inferProtocolFromUrl("https://api.openai.com/v1/responses")).toBe("responses");
    expect(inferProtocolFromUrl("https://generativelanguage.googleapis.com/v1beta")).toBe("google");
    expect(inferProtocolFromUrl("https://api.deepseek.com/v1")).toBe("openai");
    expect(inferProtocolFromUrl("https://example.com")).toBe("openai");
    expect(normalizePastedProtocol("cc")).toBe("openai");
    expect(normalizePastedProtocol("anthropic")).toBe("anthropic");
  });
});

describe("parseClipboard request url + protocol", () => {
  it("fills https api url and infers cc", async () => {
    const r = await parseClipboard(
      "https://api.deepseek.com/v1 sk-abcDEF1234567890xyz",
      LLM_PRESET_SCHEMA,
      { probeModels: false },
    );
    expect(r.fields.base_url?.value).toBe("https://api.deepseek.com/v1");
    expect(r.fields.protocol?.value).toBe("openai");
  });

  it("fills labeled host without scheme", async () => {
    const r = await parseClipboard("接口：api.moonshot.cn/v1", LLM_PRESET_SCHEMA, {
      probeModels: false,
    });
    expect(r.fields.base_url?.value).toBe("https://api.moonshot.cn/v1");
    expect(r.fields.protocol?.value).toBe("openai");
  });

  it("detects anthropic from messages url", async () => {
    const r = await parseClipboard(
      "https://api.anthropic.com/v1/messages",
      LLM_PRESET_SCHEMA,
      { probeModels: false },
    );
    expect(r.fields.base_url?.value).toBe("https://api.anthropic.com/v1/messages");
    expect(r.fields.protocol?.value).toBe("anthropic");
  });

  it("honors explicit 协议：cc", async () => {
    const r = await parseClipboard(
      "协议：cc\nhttps://api.anthropic.com/v1/messages",
      LLM_PRESET_SCHEMA,
      { probeModels: false },
    );
    expect(r.fields.protocol?.value).toBe("openai");
  });

  it("defaults protocol to cc when only a key is pasted", async () => {
    const r = await parseClipboard("sk-abcDEF1234567890xyz", LLM_PRESET_SCHEMA, {
      probeModels: false,
    });
    expect(r.fields.protocol?.value).toBe("openai");
  });

  it("reads api_backend=responses when the url is generic /v1", async () => {
    const r = await parseClipboard(
      'models_base_url = "https://codex666ai.com/v1"\napi_backend = "responses"',
      LLM_PRESET_SCHEMA,
      { probeModels: false },
    );
    expect(r.fields.protocol?.value).toBe("responses");
    expect(r.fields.base_url?.value).toBe("https://codex666ai.com/v1");
  });
});
