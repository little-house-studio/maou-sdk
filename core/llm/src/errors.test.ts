/**
 * Table-driven tests for shipped classifyLlmError / decideLlmRetry / parse helpers.
 */
import { describe, expect, it } from "vitest";
import {
  classifyLlmError,
  classifyFromThrown,
  decideLlmRetry,
  formatLlmErrorForStream,
  parseLlmErrorFromMessage,
  isQuotaExhaustedText,
  buildApiErrorThrowMessage,
  type ClassifiedLlmError,
} from "./errors.js";

type Case = {
  name: string;
  status?: number | null;
  body?: string;
  message?: string;
  expectCategory: ClassifiedLlmError["category"];
  expectRetryable: boolean;
};

const TABLE: Case[] = [
  {
    name: "FreeUsageLimit 429 → quota_exhausted non-retryable",
    status: 429,
    body: JSON.stringify({
      type: "error",
      error: {
        type: "FreeUsageLimitError",
        message: "Rate limit exceeded. Please try again later.",
      },
      metadata: {},
    }),
    expectCategory: "quota_exhausted",
    expectRetryable: false,
  },
  {
    name: "insufficient_quota 429 → quota_exhausted",
    status: 429,
    body: JSON.stringify({
      error: {
        type: "insufficient_quota",
        message: "You exceeded your current quota",
      },
    }),
    expectCategory: "quota_exhausted",
    expectRetryable: false,
  },
  {
    name: "plain 429 rate limit → retryable rate_limit",
    status: 429,
    body: JSON.stringify({
      error: { type: "rate_limit_exceeded", message: "Too many requests" },
    }),
    expectCategory: "rate_limit",
    expectRetryable: true,
  },
  {
    name: "401 auth non-retryable",
    status: 401,
    body: '{"error":{"message":"Invalid API key"}}',
    expectCategory: "auth",
    expectRetryable: false,
  },
  {
    name: "403 auth non-retryable",
    status: 403,
    body: "authorization failed",
    expectCategory: "auth",
    expectRetryable: false,
  },
  {
    name: "500 server_error retryable",
    status: 500,
    body: "internal error",
    expectCategory: "server_error",
    expectRetryable: true,
  },
  {
    name: "502 server_error retryable",
    status: 502,
    body: "bad gateway",
    expectCategory: "server_error",
    expectRetryable: true,
  },
  {
    name: "413 context_overflow non-retryable",
    status: 413,
    body: "request too large",
    expectCategory: "context_overflow",
    expectRetryable: false,
  },
  {
    name: "overflow body with 400",
    status: 400,
    body: "This model's maximum context length is exceeded",
    expectCategory: "context_overflow",
    expectRetryable: false,
  },
  {
    name: "network message → network retryable",
    message: "fetch failed: ECONNREFUSED",
    expectCategory: "network",
    expectRetryable: true,
  },
  {
    name: "timeout message → timeout retryable",
    message: "连接/响应超时 60000ms（未收到响应头）",
    expectCategory: "timeout",
    expectRetryable: true,
  },
  {
    name: "stall message → timeout retryable",
    message: "流式响应停滞超过 30000ms 无新数据，已中止",
    expectCategory: "timeout",
    expectRetryable: true,
  },
];

describe("classifyLlmError table", () => {
  for (const c of TABLE) {
    it(c.name, () => {
      const got = classifyLlmError({
        status: c.status,
        body: c.body,
        message: c.message,
      });
      expect(got.category).toBe(c.expectCategory);
      expect(got.retryable).toBe(c.expectRetryable);
      expect(decideLlmRetry(got)).toBe(c.expectRetryable ? "retry" : "fail");
    });
  }
});

describe("format/parse llm error stream", () => {
  it("round-trips category and retryable", () => {
    const c = classifyLlmError({
      status: 429,
      body: JSON.stringify({
        error: { type: "FreeUsageLimitError", message: "Rate limit exceeded" },
      }),
    });
    const s = formatLlmErrorForStream(c);
    expect(s.includes("[llm_error]")).toBe(true);
    expect(s.includes("category=quota_exhausted")).toBe(true);
    const back = parseLlmErrorFromMessage(s);
    expect(back).not.toBeNull();
    expect(back!.category).toBe("quota_exhausted");
    expect(back!.retryable).toBe(false);
  });

  it("classifyFromThrown API Error 429 FreeUsage", () => {
    const msg = buildApiErrorThrowMessage(
      429,
      JSON.stringify({
        type: "error",
        error: {
          type: "FreeUsageLimitError",
          message: "Rate limit exceeded. Please try again later.",
        },
      }),
    );
    const c = classifyFromThrown(new Error(msg));
    expect(c.category).toBe("quota_exhausted");
    expect(c.retryable).toBe(false);
  });
});

describe("isQuotaExhaustedText", () => {
  it("matches FreeUsageLimitError", () => {
    expect(isQuotaExhaustedText("FreeUsageLimitError")).toBe(true);
  });
  it("does not match plain RPM phrase without quota markers", () => {
    expect(isQuotaExhaustedText("Too many requests RPM")).toBe(false);
  });
});
