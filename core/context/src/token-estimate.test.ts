import { describe, it, expect } from "vitest";
import {
  estimateTokens,
  parsePromptTokensFromUsage,
  parseUsageTokens,
  occupancyFromUsage,
} from "./token-estimate.js";
import type { MaouMessage } from "./types/message.js";

describe("parsePromptTokensFromUsage", () => {
  it("reads prompt_tokens", () => {
    expect(parsePromptTokensFromUsage({ prompt_tokens: 196700 })).toBe(196700);
  });
  it("reads input_tokens / input aliases", () => {
    expect(parsePromptTokensFromUsage({ input_tokens: 100 })).toBe(100);
    expect(parsePromptTokensFromUsage({ input: 50 })).toBe(50);
  });
  it("derives from total - completion when needed", () => {
    expect(
      parsePromptTokensFromUsage({ total_tokens: 210, completion_tokens: 10 }),
    ).toBe(200);
  });
  it("returns 0 for empty", () => {
    expect(parsePromptTokensFromUsage(null)).toBe(0);
    expect(parsePromptTokensFromUsage({})).toBe(0);
  });
});

describe("occupancyFromUsage", () => {
  it("adds last input + output", () => {
    expect(occupancyFromUsage({ prompt_tokens: 100, completion_tokens: 20 })).toBe(120);
    expect(parseUsageTokens({ input_tokens: 80, output_tokens: 5 })).toEqual({
      input: 80,
      output: 5,
    });
  });
});

describe("estimateTokens", () => {
  function msg(text: string, summary?: string): MaouMessage {
    return {
      seqId: 1,
      role: "user",
      contents: [
        summary
          ? { text, microCompact: { enabled: true, summary } }
          : { text },
      ],
    } as unknown as MaouMessage;
  }

  it("counts the micro-compact summary instead of the original text", () => {
    const long = "x".repeat(4000);
    const raw = estimateTokens([msg(long)]);
    const compacted = estimateTokens([msg(long, "short summary")]);
    expect(compacted).toBeLessThan(raw / 4);
  });

  it("charges tool calls their name and arguments", () => {
    const bare = { seqId: 1, role: "assistant", contents: [{ text: "" }] } as unknown as MaouMessage;
    const withCall = {
      ...bare,
      toolCalls: [{ name: "use_terminal", arguments: { command: "ls -la /tmp" } }],
    } as unknown as MaouMessage;
    expect(estimateTokens([withCall])).toBeGreaterThan(estimateTokens([bare]));
  });
});
