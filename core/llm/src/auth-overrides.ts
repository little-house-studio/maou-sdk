/**
 * Auth / Header 工具 —— OAuth 认证头覆盖 + 敏感 header 脱敏
 *
 * 从 client.ts 拆出。两者都跟"请求头"相关：
 * - applyAuthOverrides：preset.oauth=true 时按厂商调整认证头（Anthropic 改 Bearer + anthropic-beta）
 * - sanitizeHeaders / isSensitiveHeader：日志安全（Authorization / x-api-key 等脱敏成 ***）
 *
 * 都是纯函数（接 headers + preset/protocol 参数，无 this 依赖）。
 */

import type { APIPreset, APIProtocol } from "./adapters/types.js";

/**
 * 敏感 header 脱敏白名单（小写匹配）。
 * 覆盖各厂商传 key 的 header：
 * - Authorization：OpenAI 系 / 通用 Bearer
 * - x-api-key：Anthropic
 * - api-key：Azure OpenAI
 * - x-goog-api-key：Gemini
 * - proxy-authorization：代理层
 */
const SENSITIVE_HEADERS = new Set([
  "authorization",
  "x-api-key",
  "api-key",
  "x-goog-api-key",
  "proxy-authorization",
]);

/** 判断 header 名是否敏感（需要脱敏） */
export function isSensitiveHeader(name: string): boolean {
  return SENSITIVE_HEADERS.has(name.toLowerCase());
}

/** 返回脱敏后的 headers 副本（原对象不变） */
export function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    safe[k] = isSensitiveHeader(k) ? "***" : v;
  }
  return safe;
}

/**
 * 应用 OAuth / 自定义请求头覆盖。
 *
 * - preset.oauth=true 时按厂商调整认证方式：
 *   - anthropic：去掉 x-api-key，改用 Authorization: Bearer + anthropic-beta: oauth-2025-04-20
 *     （OpenAI 系 / Codex / Copilot 本就用 Bearer，无需特殊处理）
 * - preset.extraHeaders：在最后合并（可覆盖任意头）
 */
export function applyAuthOverrides(
  headers: Record<string, string>,
  preset: APIPreset,
  protocol: APIProtocol,
): Record<string, string> {
  const out: Record<string, string> = { ...headers };

  if (preset.oauth) {
    if (protocol === "anthropic") {
      delete out["x-api-key"];
      out["Authorization"] = `Bearer ${preset.key ?? ""}`;
      const OAUTH_BETA = "oauth-2025-04-20";
      const existing = out["anthropic-beta"];
      out["anthropic-beta"] = existing
        ? existing.includes(OAUTH_BETA)
          ? existing
          : `${existing},${OAUTH_BETA}`
        : OAUTH_BETA;
    }
  }

  const extra = preset.extraHeaders;
  if (extra && typeof extra === "object") {
    for (const [k, v] of Object.entries(extra)) {
      if (typeof v === "string") out[k] = v;
    }
  }

  return out;
}
