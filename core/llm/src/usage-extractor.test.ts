import { describe, it, expect } from "vitest";
import { extractUsageFromEvent } from "./usage-extractor.js";

describe("extractUsageFromEvent", () => {
  it("OpenAI prompt_tokens_details.cached_tokens 提升到顶层", () => {
    const u = extractUsageFromEvent(
      {
        usage: {
          prompt_tokens: 6135,
          completion_tokens: 20,
          prompt_tokens_details: { cached_tokens: 5504 },
        },
      },
      "openai",
    );
    expect(u?.prompt_tokens).toBe(6135);
    expect(u?.cached_tokens).toBe(5504);
  });

  it("Responses input_tokens_details.cached_tokens 提升到顶层", () => {
    const u = extractUsageFromEvent(
      {
        usage: {
          input_tokens: 15000,
          output_tokens: 10,
          input_tokens_details: { cached_tokens: 12000, cache_write_tokens: 3000 },
        },
      },
      "openai-responses",
    );
    expect(u?.cached_tokens).toBe(12000);
    expect(u?.cache_write_tokens).toBe(3000);
  });

  it("Gemini usageMetadata", () => {
    const u = extractUsageFromEvent(
      {
        usageMetadata: {
          promptTokenCount: 1000,
          candidatesTokenCount: 40,
          cachedContentTokenCount: 800,
          totalTokenCount: 1040,
        },
      },
      "google",
    );
    expect(u?.prompt_tokens).toBe(1000);
    expect(u?.completion_tokens).toBe(40);
    expect(u?.cached_tokens).toBe(800);
    expect(u?.total_tokens).toBe(1040);
  });

  it("Anthropic message_start.usage", () => {
    const u = extractUsageFromEvent(
      {
        type: "message_start",
        message: {
          usage: {
            input_tokens: 100,
            cache_read_input_tokens: 9000,
            cache_creation_input_tokens: 0,
            output_tokens: 0,
          },
        },
      },
      "anthropic",
    );
    expect(u?.input_tokens).toBe(100);
    expect(u?.cache_read_input_tokens).toBe(9000);
  });
});
