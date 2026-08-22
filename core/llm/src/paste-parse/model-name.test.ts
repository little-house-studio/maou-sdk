import { describe, expect, it, vi } from "vitest";
import { LLM_PRESET_SCHEMA } from "./builtins.js";
import {
  extractDeclaredModelIds,
  looksLikeModelName,
  matchAllModelsInText,
  matchModelsInText,
} from "./model-name.js";
import { parseClipboard } from "./parse.js";

describe("looksLikeModelName", () => {
  it("wants 5–18 chars, letters and digits, more letters", () => {
    expect(looksLikeModelName("gpt-4o")).toBe(true);
    expect(looksLikeModelName("gpt-4o-mini")).toBe(true);
    expect(looksLikeModelName("claude-sonnet-4")).toBe(true);
    expect(looksLikeModelName("qwen-max")).toBe(false);
    expect(looksLikeModelName("a1b2c3d4e5")).toBe(false);
    expect(looksLikeModelName("gpt4")).toBe(false);
  });
});

describe("matchModelsInText", () => {
  it("picks the longest catalog id present", () => {
    const hit = matchModelsInText("use gpt-4o-mini not gpt-4o", ["gpt-4o", "gpt-4o-mini"]);
    expect(hit?.value).toBe("gpt-4o-mini");
  });

  it("returns every catalog id in the text", () => {
    const hits = matchAllModelsInText("gpt-4o and gpt-4o-mini", ["gpt-4o", "gpt-4o-mini"]);
    expect(hits.map((h) => h.value)).toEqual(["gpt-4o-mini", "gpt-4o"]);
  });
});

describe("extractDeclaredModelIds", () => {
  it("reads JSON models object keys and skips meta", () => {
    const ids = extractDeclaredModelIds(`
      {
        "baseURL": "https://api.example.com/v1",
        "apiKey": "sk-abcdefghijklmnopqrstuvwxyz",
        "models": {
          "gpt-5.2": { "name": "GPT 5.2" },
          "gpt-5.6": { "name": "GPT 5.6", "options": {}, "limit": {} },
          "gpt-5.6-sol": { "variants": { "xhigh": {} } },
          "codex-mini-latest": { "name": "Codex Mini" }
        }
      }
    `);
    expect(ids).toEqual(["gpt-5.2", "gpt-5.6", "gpt-5.6-sol", "codex-mini-latest"]);
  });

  it("reads TOML [model.id] tables", () => {
    const ids = extractDeclaredModelIds(`
      default = "grok-4.5"
      [model."grok-4.5"]
      [model."grok-build-0.1"]
    `);
    expect(ids).toEqual(["grok-4.5", "grok-build-0.1"]);
  });
});

describe("parseClipboard model", () => {
  it("matches against /v1/models within 2s", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: "deepseek-chat" }, { id: "deepseek-reasoner" }] }), {
        status: 200,
      }),
    );
    const r = await parseClipboard(
      "https://api.deepseek.com/v1 sk-abcDEF1234567890xyz deepseek-chat",
      LLM_PRESET_SCHEMA,
      { fetchImpl },
    );
    expect(r.fields.model?.value).toBe("deepseek-chat");
    expect(r.fields.model?.source).toBe("list");
    expect(fetchImpl).toHaveBeenCalled();
    const calledUrl = String(fetchImpl.mock.calls[0]?.[0] ?? "");
    expect(calledUrl).toMatch(/\/v1\/models$/);
  });

  it("falls back to the public catalog when the vendor list is empty", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    const r = await parseClipboard(
      "https://api.example.com/v1 gpt-4o-mini",
      LLM_PRESET_SCHEMA,
      { fetchImpl },
    );
    expect(r.fields.model?.value).toBe("gpt-4o-mini");
    expect(r.fields.model?.source).toBe("list");
  });

  it("prefers default= among catalog ids", async () => {
    const r = await parseClipboard(
      'model = "grok-build-0.1"\ndefault = "grok-4.5"\nmodel = "grok-4.3"',
      LLM_PRESET_SCHEMA,
      { probeModels: false, catalogModelIds: ["grok-4.5", "grok-4.3", "grok-build-0.1"] },
    );
    expect(r.fields.model?.value).toBe("grok-4.5");
    expect(r.fields.model?.source).toBe("list");
    expect(r.fields.model?.candidates).toEqual(
      expect.arrayContaining(["grok-4.5", "grok-build-0.1", "grok-4.3"]),
    );
  });

  it("collects every JSON models id without extra urls or keys", async () => {
    const r = await parseClipboard(
      [
        "{",
        '  "baseURL": "https://api.example.com/v1",',
        '  "apiKey": "sk-abcdefghijklmnopqrstuvwxyz",',
        '  "models": {',
        '    "gpt-5.2": { "name": "GPT 5.2" },',
        '    "gpt-5.6": { "name": "GPT 5.6" },',
        '    "gpt-5.6-sol": { "options": {} },',
        '    "gpt-5.3-codex-spark": { "name": "Spark" }',
        "  }",
        "}",
      ].join("\n"),
      LLM_PRESET_SCHEMA,
      { probeModels: false, catalogModelIds: [] },
    );
    expect(r.fields.model?.candidates).toEqual([
      "gpt-5.2",
      "gpt-5.6",
      "gpt-5.6-sol",
      "gpt-5.3-codex-spark",
    ]);
    expect(r.fields.model?.value).toBe("gpt-5.2");
    expect(r.fields.base_url?.value).toBe("https://api.example.com/v1");
    expect(r.fields.api_key?.value).toBe("sk-abcdefghijklmnopqrstuvwxyz");
  });

  it("falls back when the request times out", async () => {
    const fetchImpl = vi.fn(
      (_url, init) =>
        new Promise<Response>((_, reject) => {
          const fail = () => reject(new DOMException("aborted", "AbortError"));
          if (init?.signal?.aborted) fail();
          else init?.signal?.addEventListener("abort", fail);
        }),
    );
    const r = await parseClipboard("https://api.example.com/v1 claude-4-sonnet", LLM_PRESET_SCHEMA, {
      fetchImpl,
      modelListTimeoutMs: 30,
      catalogModelIds: [],
    });
    expect(r.fields.model?.value).toBe("claude-4-sonnet");
    expect(r.fields.model?.source).toBe("regex");
  });

  it("does not treat the api key as a model", async () => {
    const r = await parseClipboard(
      "https://api.example.com/v1 sk-abcDEF1234567890xyz",
      LLM_PRESET_SCHEMA,
      { probeModels: false },
    );
    expect(r.fields.model?.value).toBeUndefined();
    expect(r.fields.api_key?.value).toBe("sk-abcDEF1234567890xyz");
  });

  it("accepts a labeled letter-only model", async () => {
    const r = await parseClipboard("模型：qwen-max", LLM_PRESET_SCHEMA, { probeModels: false });
    expect(r.fields.model?.value).toBe("qwen-max");
  });
});
