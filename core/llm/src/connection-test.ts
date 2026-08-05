/**
 * LLM 连接测试 —— 用最短 chat 请求验证 preset（url/key/model/协议）是否可用，
 * 并返回端到端延迟。
 *
 * 与 scanModels（只测 /v1/models）不同：这里打真正的 chat/completions（或等价协议），
 * 与线上对话路径一致。
 */

import type { APIPreset } from "./adapters/types.js";
import { LLMClient } from "./client.js";
import { normalizeApiPreset } from "./preset-normalize.js";

/** 连接测试结果（与 ChatSession.ConnectionTestResult 对齐并扩展） */
export interface ConnectionTestResult {
  /** 是否成功（HTTP 成功且拿到可解析响应） */
  ok: boolean;
  /** 实际请求的 model */
  model: string;
  /**
   * 端到端延迟（ms）：发出请求 → 完整响应结束
   * （优先用底层 timing.totalMs，否则用 wall clock）
   */
  latencyMs: number;
  /** 首 token / 首字节延迟（ms）；非流式时可能 ≈ total 或略小 */
  firstByteMs?: number;
  /** HTTP 状态码（若已发出请求） */
  httpStatus?: number | null;
  /** 协议 */
  protocol?: string;
  /** 模型回声片段（成功时，截断） */
  replyPreview?: string;
  /** 失败原因 */
  error?: string;
}

export interface TestConnectionOptions {
  /** 探测用用户消息，默认极短 */
  probeMessage?: string;
  /** 超时 ms，默认 30s */
  timeoutMs?: number;
  /** 注入 client（测试用） */
  client?: LLMClient;
  /** 外部 abort */
  signal?: AbortSignal;
}

/**
 * 对给定 preset 发一条最小 chat 请求，验证 API 可调用并测延迟。
 *
 * - maxTokens 压到很小，降低费用与耗时
 * - 不重试到极致：用独立 LLMClient，失败即返回
 */
export async function testConnection(
  preset: APIPreset,
  options: TestConnectionOptions = {},
): Promise<ConnectionTestResult> {
  const model = String(preset.model ?? "").trim();
  const url = String(preset.url ?? "").trim();
  if (!url) {
    return { ok: false, model, latencyMs: 0, error: "preset.url 为空" };
  }
  if (!model) {
    return { ok: false, model, latencyMs: 0, error: "preset.model 为空" };
  }

  const normalized = normalizeApiPreset({
    ...preset,
    // 压低输出，控制探测成本
    maxTokens: Math.min(
      Number(preset.maxTokens) > 0 ? Number(preset.maxTokens) : 16,
      32,
    ),
  } as APIPreset);

  const timeoutMs = options.timeoutMs ?? 30_000;
  const probe =
    (options.probeMessage ?? "ping").trim().slice(0, 200) || "ping";

  const client = options.client ?? new LLMClient();
  const wall0 = Date.now();

  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => timeoutCtrl.abort(), timeoutMs);
  const onExternalAbort = () => timeoutCtrl.abort();
  options.signal?.addEventListener("abort", onExternalAbort, { once: true });

  try {
    const res = await client.chat({
      preset: normalized,
      messages: [{ role: "user", content: probe }],
      jsonSettings: null,
      toolSchemas: null,
      nativeToolCalling: false,
      abortSignal: timeoutCtrl.signal,
      _logContext: { source: "connection_test" },
    });

    const wallMs = Date.now() - wall0;
    const totalMs =
      res.timing?.totalMs != null && Number.isFinite(res.timing.totalMs)
        ? Math.round(res.timing.totalMs)
        : wallMs;
    const firstByteMs =
      res.firstOutputMs != null && Number.isFinite(res.firstOutputMs)
        ? Math.round(res.firstOutputMs)
        : res.timing?.firstByteMs != null &&
            Number.isFinite(res.timing.firstByteMs)
          ? Math.round(res.timing.firstByteMs)
          : undefined;

    const httpStatus = res.httpStatus;
    const content = String(res.content ?? "").trim();
    const aborted = Boolean(res.aborted);

    // 有些厂商 200 但空 body；只要 HTTP 成功且无 throw 即视为连通
    const ok =
      !aborted &&
      (httpStatus == null || (httpStatus >= 200 && httpStatus < 300));

    if (!ok) {
      return {
        ok: false,
        model,
        latencyMs: totalMs,
        firstByteMs,
        httpStatus,
        protocol: res.protocol || String(normalized.protocol ?? ""),
        error: aborted
          ? "请求已中断或超时"
          : `HTTP ${httpStatus ?? "?"} 失败`,
      };
    }

    return {
      ok: true,
      model,
      latencyMs: totalMs,
      firstByteMs,
      httpStatus: httpStatus ?? 200,
      protocol: res.protocol || String(normalized.protocol ?? ""),
      replyPreview: content.slice(0, 120) || undefined,
    };
  } catch (err) {
    const wallMs = Date.now() - wall0;
    const msg = err instanceof Error ? err.message : String(err);
    const timedOut =
      timeoutCtrl.signal.aborted ||
      /abort|timeout|超时/i.test(msg);
    return {
      ok: false,
      model,
      latencyMs: wallMs,
      error: timedOut ? `超时（${timeoutMs}ms）：${msg}` : msg,
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onExternalAbort);
  }
}
