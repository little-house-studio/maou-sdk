import { describe, expect, it } from "vitest";
import { extractApiKeys, looksLikeApiKey } from "./api-key.js";
import { LLM_PRESET_SCHEMA } from "./builtins.js";
import { parseClipboard } from "./parse.js";

describe("looksLikeApiKey", () => {
  it("keeps letters, digits, - and _ as one run", () => {
    expect(looksLikeApiKey("sk-abcDEF1234567890")).toBe(true);
    expect(looksLikeApiKey("gsk_abcdefghijklmnopqrstuvwxyz012345")).toBe(true);
    expect(looksLikeApiKey("aB3dE5fG7hI9jK1lM2nO3pQ4rS5tU6vW")).toBe(true);
    expect(looksLikeApiKey("only-letters-and_underscores_xxx")).toBe(true);
  });

  it("rejects runs that are not longer than 16", () => {
    expect(looksLikeApiKey("aB3dE5fG7hI9jK1")).toBe(false);
    expect(looksLikeApiKey("aB3dE5fG7hI9jK1l")).toBe(false);
    expect(looksLikeApiKey("gpt-4o")).toBe(false);
  });
});

describe("extractApiKeys", () => {
  it("cuts on any char outside letter/digit/-/_", () => {
    const hits = extractApiKeys(
      'key="sk-abcDEF1234567890xyz"; next',
    );
    expect(hits.map((h) => h.value)).toEqual(["sk-abcDEF1234567890xyz"]);
  });

  it("dot slash colon whitespace all cut the run", () => {
    const hits = extractApiKeys("aaa-bbb_ccc-ddd.eee/fff:ggg-hhh_iii-jjj-kkk");
    expect(hits.map((h) => h.value)).toEqual(["ggg-hhh_iii-jjj-kkk"]);
    expect(hits.some((h) => h.value.includes("."))).toBe(false);
  });

  it("does not eat the run after https://", () => {
    expect(
      extractApiKeys("https://api.openai.com/v1/sk-abcdefghijklmnopqrstuvwxyz0123"),
    ).toEqual([]);
  });
});

describe("parseClipboard api_key", () => {
  it("fills from a generic long token", async () => {
    const key = "aB3dE5fG7hI9jK1lM2nO3pQ4rS5tU6vW";
    const r = await parseClipboard(`${key}\nhttps://api.example.com/v1`, LLM_PRESET_SCHEMA, {
      probeModels: false,
    });
    expect(r.fields.api_key?.value).toBe(key);
  });

  it("prefers sk- over longer env-style tokens", () => {
    const hits = extractApiKeys(
      'GROK_MODELS_BASE_URL supports_backend_search api_key = "sk-abcDEF1234567890xyz"',
    );
    expect(hits[0]?.value).toBe("sk-abcDEF1234567890xyz");
  });

  it("uses a quoted token when there is no sk-", () => {
    const hits = extractApiKeys(
      'supports_backend_search_flag token = "aB3dE5fG7hI9jK1lM2nO3pQ4rS5tU6vW"',
    );
    expect(hits[0]?.value).toBe("aB3dE5fG7hI9jK1lM2nO3pQ4rS5tU6vW");
  });

  it("falls back to the longest run", () => {
    const hits = extractApiKeys("shortish_token_xx MUCH_LONGER_CONTINUOUS_TOKEN_VALUE_HERE");
    expect(hits[0]?.value).toBe("MUCH_LONGER_CONTINUOUS_TOKEN_VALUE_HERE");
  });
});
