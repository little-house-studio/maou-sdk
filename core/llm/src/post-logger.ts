/**
 * LLM POST 日志标准化层（纯 SDK，零上层依赖）
 *
 * 本模块只负责"产出标准化记录"，不负责"落地存储"。
 * 落地是上层（harness/runtime）的职责，通过订阅 LLMPostLogger 回调自行决定写哪里。
 *
 * 提供：
 * - 标准化 `LLMPostLogRecord`
 * - `normalizePostLogRecord()` 字段补齐（可配置 body 截断策略）
 * - `truncateBodyForSummary()` 摘要/截断策略
 * - `classifyError()` 错误分类
 *
 * 设计原则：
 * - 不侵入 LLM client 主调用返回结构
 * - 仅消费已有的 `LLMCallLogEntry` 与 `_logContext`
 * - 不 import 任何上层模块（context/harness/plugins），保持 core/llm 零内部依赖
 */

import type { LLMCallLogEntry } from "./client.js";
import { encodeRawBody, type CompressedBody } from "./raw-codec.js";
import { detectContextOverflow } from "./overflow.js";

// ─── 标准记录 ────────────────────────────────────────────────────────────────

export interface LLMPostLogContext {
  session_id?: string;
  agent_name?: string;
  source?: string;
  trace_id?: string;
  span_id?: string;
  request_id?: string;
  model?: string;
  protocol?: string;
  round?: number;
  retry?: number;
}

export interface LLMPostLogRecord {
  version: number;
  event: "llm.post";
  created_at: string;

  request_id?: string;
  trace_id?: string;
  span_id?: string;
  session_id?: string;
  agent_name?: string;
  source?: string;

  round?: number;
  retry?: number;
  model?: string;
  protocol?: string;

  request: {
    url: string;
    method: string;
    headers?: Record<string, string>;
    /** 截断后的请求 body 摘要（默认 2000 字符） */
    body_summary?: string;
    /**
     * 完整的原始请求 body（仅在 keepFullBody 启用时填充）。
     * - 原文较短时为字符串；
     * - 较长时为 gzip+base64 压缩载体（CompressedBody），读取端用 decodeRawBody 解码。
     * 每条独立压缩，无状态解码，不依赖会话上下文。
     */
    body_full?: string | CompressedBody;
  };

  response: {
    /** 流式响应：所有 SSE delta 拼接后的完整文本；非流式：响应 body 文本 */
    raw_text: string;
    /** 流式响应：原始 SSE 事件行数组（每行一个 data: {...} 字符串）；非流式：单元素数组或空 */
    events?: string[];
    /**
     * 完整响应载荷（raw_text + events 合并 JSON）的压缩载体。
     * 仅在 keepFullBody 启用时填充，避免长输出场景下 events 数组撑爆 JSONL。
     * 解码后为 { raw_text: string, events: string[] }。
     */
    payload_compressed?: CompressedBody;
    content_type?: string;
    http_status?: number | null;
    /** 若为 true，raw_text 为流式事件拼接后的完整文本 */
    is_stream_reassembled?: boolean;
  };

  usage?: Record<string, unknown> | null;
  duration_ms?: number;
  error?: string | null;
  error_type?: "network" | "timeout" | "rate_limit" | "auth" | "bad_request" | "server_error" | "context_overflow" | "unknown" | null;

  tool_calls_summary?: Array<{
    id?: string;
    name?: string;
  }>;

  [key: string]: unknown;
}

/**
 * normalize 时的可配置项。
 * 把"截断多长 / 是否存全量 body"这种业务决策还给调用方，SDK 默认值保持向后兼容。
 */
export interface NormalizePostLogOptions {
  /** body_summary 的最大字符数，默认 2000 */
  bodySummaryMaxLen?: number;
  /** 是否额外填充 request.body_full（完整原始 body），默认 false */
  keepFullBody?: boolean;
}

// ─── 工具函数 ────────────────────────────────────────────────────────────────

export function truncateBodyForSummary(
  payload: unknown,
  maxLen = 2000,
): string {
  try {
    const text = typeof payload === "string" ? payload : JSON.stringify(payload ?? {});
    if (text.length <= maxLen) return text;
    return `${text.slice(0, maxLen)}...[truncated:${text.length}]`;
  } catch {
    return "[unserializable]";
  }
}

export function classifyError(
  error: string | null,
  httpStatus: number | null,
): LLMPostLogRecord["error_type"] {
  if (!error && (!httpStatus || httpStatus < 400)) return null;
  // 上下文溢出优先判定（常以 400/413 返回，需先于 bad_request 识别）
  if (detectContextOverflow(error, httpStatus)) return "context_overflow";
  if (httpStatus === 429) return "rate_limit";
  if (httpStatus === 401 || httpStatus === 403) return "auth";
  if (httpStatus === 400 || httpStatus === 422) return "bad_request";
  if (httpStatus && httpStatus >= 500) return "server_error";
  if (error) {
    const lower = error.toLowerCase();
    if (lower.includes("timeout") || lower.includes("timed out")) return "timeout";
    if (lower.includes("econnrefused") || lower.includes("enotfound") || lower.includes("fetch failed")) return "network";
    if (lower.includes("429") || lower.includes("rate limit")) return "rate_limit";
    if (lower.includes("401") || lower.includes("403") || lower.includes("unauthorized")) return "auth";
    return "unknown";
  }
  return null;
}

export function normalizePostLogRecord(
  entry: LLMCallLogEntry,
  context?: Record<string, unknown>,
  options?: NormalizePostLogOptions,
): LLMPostLogRecord {
  const ctx = (context ?? {}) as LLMPostLogRecord & LLMPostLogContext;
  const requestPayload = entry.request?.body as Record<string, unknown> | undefined;
  const bodySummaryMaxLen = options?.bodySummaryMaxLen ?? 2000;
  const keepFullBody = options?.keepFullBody ?? false;

  const record: LLMPostLogRecord = {
    version: 1,
    event: "llm.post",
    created_at: entry.timestamp || new Date().toISOString(),

    request_id: typeof ctx.request_id === "string" ? ctx.request_id : undefined,
    trace_id: ctx.trace_id,
    span_id: ctx.span_id,
    session_id: ctx.session_id,
    agent_name: ctx.agent_name,
    source: ctx.source,

    round: ctx.round,
    retry: ctx.retry,
    model: ctx.model ?? (requestPayload?.model as string | undefined),
    protocol: ctx.protocol,

    request: {
      url: entry.request?.url ?? "",
      method: entry.request?.method ?? "POST",
      headers: entry.request?.headers,
      body_summary: truncateBodyForSummary(requestPayload, bodySummaryMaxLen),
    },

    response: {
      raw_text: entry.response?.raw_text ?? "",
      events: entry.response?.events,
      content_type: entry.response?.content_type,
      http_status: entry.response?.http_status ?? null,
      is_stream_reassembled: entry.response?.is_stream_reassembled ?? false,
    },

    usage: entry.usage ?? null,
    duration_ms: entry.duration_ms,
    error: entry.error ?? null,
    error_type: classifyError(entry.error ?? null, entry.response?.http_status ?? null),

    tool_calls_summary: entry.assembled_tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.name,
    })) ?? undefined,
  };

  // 仅在调用方显式启用时填充完整 body（压缩形式）。
  // request body：直接对 requestPayload 压缩
  if (keepFullBody && requestPayload !== undefined) {
    const compressed = encodeRawBody(requestPayload);
    // encodeRawBody 返回 null 表示 body 太小（< 512B）不值得压缩——此时存原文
    record.request.body_full = compressed ?? (() => {
      try { return JSON.stringify(requestPayload); } catch { return undefined; }
    })();
  }

  // response payload：对 { raw_text, events } 合并压缩（仅在有 events 且较长时）。
  // 这样长输出场景下 events 数组不会撑爆 JSONL，且仍能完整还原每个 SSE 事件。
  if (keepFullBody) {
    const events = entry.response?.events;
    const rawText = entry.response?.raw_text ?? "";
    if (events && events.length > 0) {
      const payload = { raw_text: rawText, events };
      const compressed = encodeRawBody(payload);
      if (compressed) {
        record.response.payload_compressed = compressed;
      }
    }
  }

  return record;
}
