/**
 * Unified LLM error classification — single source of truth for:
 * - post-logger `error_type`
 * - LLMClient retry decisions
 * - ModelCaller / Agent structured failure surface
 *
 * Pure functions only (table-testable, no I/O).
 */

import { detectContextOverflow } from "./overflow.js";

/** Stable error categories shared by logs, client, agent, UI. */
export type LlmErrorCategory =
  | "network"
  | "timeout"
  | "rate_limit"
  | "quota_exhausted"
  | "auth"
  | "bad_request"
  | "server_error"
  | "context_overflow"
  | "content_policy"
  | "unknown";

/** Categories that are safe to retry at HTTP / model-call layer by default. */
const RETRYABLE_BY_DEFAULT: ReadonlySet<LlmErrorCategory> = new Set([
  "network",
  "timeout",
  "rate_limit",
  "server_error",
]);

export type ClassifyLlmErrorInput = {
  /** HTTP status when available */
  status?: number | null;
  /** Response body text (may be JSON) */
  body?: string | null;
  /** Error message / thrown string */
  message?: string | null;
};

export type ClassifiedLlmError = {
  category: LlmErrorCategory;
  /** Whether a blind same-payload retry is appropriate */
  retryable: boolean;
  /** Optional provider/machine code (e.g. FreeUsageLimitError) */
  code?: string;
  /** Compact technical message for logs / stream */
  message: string;
  httpStatus: number | null;
};

/** Prefix used when serializing structured errors into strings for streams. */
export const LLM_ERROR_PREFIX = "[llm_error]";

/**
 * Detect quota / billing exhaustion (non-retryable) from body or message.
 * Distinct from transient RPM/TPM rate limits.
 */
export function isQuotaExhaustedText(text: string): boolean {
  if (!text) return false;
  return /FreeUsageLimitError|insufficient[_\s-]?quota|quota[_\s-]?exceeded|usage[_\s-]?limit|billing[_\s-]?hard[_\s-]?limit|exceeded.*free|免费额度|额度已用尽|out of credits|credit balance/i.test(
    text,
  );
}

/**
 * Detect content policy / safety blocks.
 */
export function isContentPolicyText(text: string): boolean {
  if (!text) return false;
  return /content[_\s-]?policy|content[_\s-]?filter|safety|moderation|451|responsibleai|blocked by/i.test(
    text,
  );
}

/**
 * Try to extract a provider error type/code from JSON body.
 */
export function extractProviderErrorCode(body: string): string | undefined {
  if (!body || body.length > 50_000) return undefined;
  try {
    const j = JSON.parse(body) as Record<string, unknown>;
    // OpenCode: { type:"error", error:{ type:"FreeUsageLimitError", message } }
    const nested = j.error;
    if (nested && typeof nested === "object") {
      const e = nested as Record<string, unknown>;
      if (typeof e.type === "string" && e.type) return e.type;
      if (typeof e.code === "string" && e.code) return e.code;
    }
    if (typeof j.type === "string" && j.type !== "error") return j.type;
    if (typeof j.code === "string") return j.code;
    // OpenAI style: error.type / error.code
    if (typeof j.message === "string" && !nested) {
      /* fall through */
    }
  } catch {
    /* not JSON */
  }
  // bare FreeUsageLimitError in text
  const m = body.match(/\b(FreeUsageLimitError|insufficient_quota|rate_limit_exceeded)\b/i);
  return m?.[1];
}

/**
 * Single classification path: status + body + message → category + retryable.
 */
export function classifyLlmError(input: ClassifyLlmErrorInput): ClassifiedLlmError {
  const status =
    input.status != null && Number.isFinite(Number(input.status))
      ? Number(input.status)
      : null;
  const body = (input.body ?? "").trim();
  const message = (input.message ?? "").trim();
  const combined = [body, message].filter(Boolean).join("\n");
  const code = extractProviderErrorCode(body) ?? extractProviderErrorCode(message);

  // Context overflow first (often 400/413)
  if (detectContextOverflow(combined || null, status)) {
    return {
      category: "context_overflow",
      retryable: false,
      code,
      message: combined || `HTTP ${status ?? "?"} context overflow`,
      httpStatus: status,
    };
  }

  // Quota before generic 429 rate_limit
  if (isQuotaExhaustedText(combined) || isQuotaExhaustedText(code ?? "")) {
    return {
      category: "quota_exhausted",
      retryable: false,
      code: code ?? "quota_exhausted",
      message: combined || "quota exhausted",
      httpStatus: status ?? 429,
    };
  }

  if (status === 451 || isContentPolicyText(combined)) {
    return {
      category: "content_policy",
      retryable: false,
      code: code ?? "content_policy",
      message: combined || `HTTP ${status ?? 451} content policy`,
      httpStatus: status ?? 451,
    };
  }

  if (status === 401 || status === 403) {
    return {
      category: "auth",
      retryable: false,
      code: code ?? `http_${status}`,
      message: combined || `HTTP ${status} auth`,
      httpStatus: status,
    };
  }

  if (status === 429) {
    return {
      category: "rate_limit",
      retryable: true,
      code: code ?? "rate_limit",
      message: combined || "HTTP 429 rate limit",
      httpStatus: 429,
    };
  }

  if (status === 400 || status === 422 || status === 404) {
    return {
      category: "bad_request",
      retryable: false,
      code: code ?? `http_${status}`,
      message: combined || `HTTP ${status}`,
      httpStatus: status,
    };
  }

  // 529 Anthropic overload + standard 5xx
  if (status != null && (status === 529 || status >= 500)) {
    return {
      category: "server_error",
      retryable: true,
      code: code ?? `http_${status}`,
      message: combined || `HTTP ${status}`,
      httpStatus: status,
    };
  }

  // Message-only classification
  if (combined) {
    const lower = combined.toLowerCase();
    if (
      lower.includes("timeout") ||
      lower.includes("timed out") ||
      lower.includes("连接/响应超时") ||
      lower.includes("流式响应停滞")
    ) {
      return {
        category: "timeout",
        retryable: true,
        code,
        message: combined,
        httpStatus: status,
      };
    }
    if (
      lower.includes("econnrefused") ||
      lower.includes("enotfound") ||
      lower.includes("fetch failed") ||
      lower.includes("network") ||
      lower.includes("socket hang up") ||
      lower.includes("econnreset") ||
      lower.includes("网络持续不可达")
    ) {
      return {
        category: "network",
        retryable: true,
        code,
        message: combined,
        httpStatus: status,
      };
    }
    if (lower.includes("unauthorized") || lower.includes("invalid api key")) {
      return {
        category: "auth",
        retryable: false,
        code: code ?? "auth",
        message: combined,
        httpStatus: status ?? 401,
      };
    }
    if (lower.includes("429") || lower.includes("rate limit")) {
      // already handled quota above
      return {
        category: "rate_limit",
        retryable: true,
        code: code ?? "rate_limit",
        message: combined,
        httpStatus: status ?? 429,
      };
    }
  }

  if (status != null && status >= 400) {
    return {
      category: "unknown",
      retryable: false,
      code: code ?? `http_${status}`,
      message: combined || `HTTP ${status}`,
      httpStatus: status,
    };
  }

  return {
    category: combined ? "unknown" : "unknown",
    retryable: false,
    code,
    message: combined || "unknown error",
    httpStatus: status,
  };
}

/** Default retryability from category (before caller overrides). */
export function isRetryableCategory(category: LlmErrorCategory): boolean {
  return RETRYABLE_BY_DEFAULT.has(category);
}

/**
 * Decision for LLMClient retry loop.
 * - fail: stop immediately
 * - retry: use backoff / Retry-After
 */
export function decideLlmRetry(classified: ClassifiedLlmError): "retry" | "fail" {
  if (!classified.retryable) return "fail";
  return "retry";
}

/**
 * Serialize structured error into a stream/string-safe form so Agent/UI can
 * recover category without regex on FreeUsageLimit body alone.
 *
 * Format: `[llm_error] category=<c> retryable=<0|1> code=<code> | <message>`
 */
export function formatLlmErrorForStream(classified: ClassifiedLlmError): string {
  const code = classified.code ? classified.code.replace(/\s+/g, "_") : "-";
  const retry = classified.retryable ? "1" : "0";
  const msg = classified.message.replace(/\r?\n/g, " ").slice(0, 500);
  return `${LLM_ERROR_PREFIX} category=${classified.category} retryable=${retry} code=${code} | ${msg}`;
}

/**
 * Parse formatLlmErrorForStream / messages that embed the prefix.
 * Returns null if no structured prefix found.
 */
export function parseLlmErrorFromMessage(
  text: string,
): ClassifiedLlmError | null {
  if (!text) return null;
  const idx = text.indexOf(LLM_ERROR_PREFIX);
  if (idx < 0) return null;
  const rest = text.slice(idx + LLM_ERROR_PREFIX.length).trim();
  const m = rest.match(
    /^category=(\w+)\s+retryable=([01])\s+code=(\S+)\s*\|\s*([\s\S]*)$/,
  );
  if (!m) {
    // fallback: re-classify the raw message
    return classifyLlmError({ message: text, body: text });
  }
  const category = m[1] as LlmErrorCategory;
  const retryable = m[2] === "1";
  const code = m[3] === "-" ? undefined : m[3];
  const message = (m[4] ?? "").trim() || text;
  return {
    category,
    retryable,
    code,
    message,
    httpStatus: null,
  };
}

/**
 * Classify from a thrown Error or API Error string (e.g. "API Error 429: …").
 */
export function classifyFromThrown(error: unknown): ClassifiedLlmError {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  const statusMatch = msg.match(/API Error\s*(\d{3})/i);
  const status = statusMatch ? Number(statusMatch[1]) : null;
  // Body often after first colon following status
  let body = msg;
  if (statusMatch) {
    const after = msg.slice(msg.indexOf(statusMatch[0]) + statusMatch[0].length);
    body = after.replace(/^:\s*/, "");
  }
  const parsed = parseLlmErrorFromMessage(msg);
  if (parsed) return parsed;
  return classifyLlmError({ status, body, message: msg });
}

/**
 * Build a user-oriented technical message for throwing from LLMClient.
 * Keeps category machine-readable via formatLlmErrorForStream prefix when useful.
 */
export function buildApiErrorThrowMessage(
  status: number,
  body: string,
): string {
  const classified = classifyLlmError({ status, body, message: body });
  const structured = formatLlmErrorForStream(classified);
  if (classified.category === "quota_exhausted") {
    return `API Error ${status}: ${structured}`;
  }
  return `API Error ${status}: ${body || structured}`;
}

/**
 * Map classified category to post-logger legacy error_type union
 * (quota_exhausted → rate_limit for log schema compatibility, with code in message).
 */
export function categoryToPostLogErrorType(
  category: LlmErrorCategory,
):
  | "network"
  | "timeout"
  | "rate_limit"
  | "auth"
  | "bad_request"
  | "server_error"
  | "context_overflow"
  | "unknown"
  | null {
  switch (category) {
    case "network":
    case "timeout":
    case "auth":
    case "bad_request":
    case "server_error":
    case "context_overflow":
    case "unknown":
      return category;
    case "rate_limit":
    case "quota_exhausted":
      return "rate_limit";
    case "content_policy":
      return "bad_request";
    default:
      return "unknown";
  }
}
