/**
 * 调用级 report_elapsed：默认开启，执行器在回包里写本次调用经过时间。
 */

import type { ToolResponse } from "@little-house-studio/types";

export const CALL_ELAPSED_PARAM_NAME = "report_elapsed";

export const CALL_ELAPSED_PARAM = {
  type: "boolean",
  default: true,
  description:
    "默认 true。为 true 时工具返回会附带本次调用经过时间（elapsed）。设为 false 关闭。",
} as const;

const ELAPSED_ALREADY = /elapsed(_ms)?\s*=/i;

export function formatElapsed(ms: number): string {
  const n = Number.isFinite(ms) && ms > 0 ? ms : 0;
  if (n < 1000) return `${Math.round(n)}ms`;
  const s = n / 1000;
  return s < 10 ? `${s.toFixed(2)}s` : `${s.toFixed(1)}s`;
}

export function elapsedFooter(ms: number): string {
  return `[elapsed=${formatElapsed(ms)}]`;
}

/** 缺省 / true 开启；工具定义或本次参数显式 false 则关。 */
export function wantsElapsedReport(
  params?: Record<string, unknown>,
  toolReportElapsed?: boolean,
): boolean {
  if (toolReportElapsed === false) return false;
  const raw = params?.[CALL_ELAPSED_PARAM_NAME];
  if (raw === false || raw === 0) return false;
  if (typeof raw === "string") {
    const s = raw.trim().toLowerCase();
    if (s === "false" || s === "0" || s === "no" || s === "off") return false;
  }
  return true;
}

export function applyElapsedReport(
  result: ToolResponse,
  durationMs: number,
): ToolResponse {
  const elapsedMs = Math.max(0, Math.round(durationMs));
  const payload = { ...(result.payload ?? {}), elapsed_ms: elapsedMs };
  const body = result.message ?? "";
  if (ELAPSED_ALREADY.test(body)) {
    return { ...result, payload };
  }
  const line = elapsedFooter(elapsedMs);
  const message = body.trim() ? `${body}\n${line}` : line;
  return { ...result, message, payload };
}

/**
 * 确保工具 schema 含可选调用级 `report_elapsed`（默认 true，不进 required）。
 */
export function ensureCallElapsedSchema<T extends Record<string, unknown>>(
  schema: T,
): T {
  const s = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
  const params =
    s.parameters && typeof s.parameters === "object" && !Array.isArray(s.parameters)
      ? (s.parameters as Record<string, unknown>)
      : s;
  const props =
    params.properties && typeof params.properties === "object" && !Array.isArray(params.properties)
      ? (params.properties as Record<string, unknown>)
      : ((params.properties = {}) as Record<string, unknown>);
  if (!props[CALL_ELAPSED_PARAM_NAME]) {
    props[CALL_ELAPSED_PARAM_NAME] = { ...CALL_ELAPSED_PARAM };
  }
  return s as T;
}
