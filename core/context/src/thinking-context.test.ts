import { describe, it, expect } from "vitest";
import {
  parseThinkingContextMode,
  shouldStoreThinkingInContext,
  wrapThinking,
  contentWithThinkingForLlm,
  DEFAULT_THINKING_CONTEXT_MODE,
} from "./thinking-context.js";
import { buildMessages } from "./message-builder.js";
import { sessionToMaouMessage, maouToLLMMessage } from "./types/message.js";
import type { SessionMessage } from "./session-store.js";

describe("thinking-context mode", () => {
  it("defaults to first_round", () => {
    expect(parseThinkingContextMode(undefined)).toBe("first_round");
    expect(parseThinkingContextMode("bogus")).toBe(DEFAULT_THINKING_CONTEXT_MODE);
    expect(parseThinkingContextMode("always")).toBe("always");
    expect(parseThinkingContextMode("never")).toBe("never");
  });

  it("never / first_round / always 与 roundCount", () => {
    expect(shouldStoreThinkingInContext("never", 0)).toBe(false);
    expect(shouldStoreThinkingInContext("never", 3)).toBe(false);

    expect(shouldStoreThinkingInContext("first_round", 0)).toBe(true);
    expect(shouldStoreThinkingInContext("first_round", 1)).toBe(false);
    expect(shouldStoreThinkingInContext("first_round", 5)).toBe(false);

    expect(shouldStoreThinkingInContext("always", 0)).toBe(true);
    expect(shouldStoreThinkingInContext("always", 9)).toBe(true);
  });

  it("wrapThinking + contentWithThinkingForLlm", () => {
    expect(wrapThinking("  a  ")).toBe("<thinking>\na\n</thinking>");
    expect(contentWithThinkingForLlm("answer", "think")).toBe(
      "<thinking>\nthink\n</thinking>\n\nanswer",
    );
    expect(contentWithThinkingForLlm("answer", "")).toBe("answer");
    expect(contentWithThinkingForLlm("", "only")).toBe("<thinking>\nonly\n</thinking>");
  });
});

describe("thinking inject into LLM history", () => {
  it("buildMessages 注入 assistant.reasoningContent", () => {
    const messages = buildMessages({
      systemPrompt: "sys",
      sessionMessages: [
        {
          role: "user",
          content: "hi",
          createdAt: "2020-01-01T00:00:00.000Z",
        },
        {
          role: "assistant",
          content: "hello",
          createdAt: "2020-01-01T00:00:01.000Z",
          reasoningContent: "I reason",
        },
      ] as SessionMessage[],
      roundCount: 1,
    });

    const assistant = messages.find((m) => m.role === "assistant");
    expect(String(assistant?.content)).toContain("<thinking>");
    expect(String(assistant?.content)).toContain("I reason");
    expect(String(assistant?.content)).toContain("hello");
  });

  it("sessionToMaouMessage 将 reasoning 并入文本", () => {
    const mmsg = sessionToMaouMessage(
      {
        role: "assistant",
        content: "out",
        createdAt: "2020-01-01T00:00:00.000Z",
        reasoningContent: "inner",
      },
      0,
    );
    const llm = maouToLLMMessage(mmsg);
    expect(llm.content).toContain("<thinking>");
    expect(llm.content).toContain("inner");
    expect(llm.content).toContain("out");
  });

  it("无 reasoningContent 时不注入标签", () => {
    const messages = buildMessages({
      systemPrompt: "sys",
      sessionMessages: [
        {
          role: "assistant",
          content: "plain",
          createdAt: "2020-01-01T00:00:00.000Z",
        },
      ] as SessionMessage[],
      roundCount: 0,
    });
    const assistant = messages.find((m) => m.role === "assistant");
    expect(String(assistant?.content)).toBe("plain");
  });
});
