/**
 * Auth / Header 工具 —— OAuth 认证头覆盖 + 敏感 header 脱敏
 *
 * - applyAuthOverrides：preset.oauth=true 时按厂商调整认证头
 * - sanitizeHeaders / isSensitiveHeader：日志脱敏
 */

import type { APIPreset, APIProtocol } from "./adapters/types.js";

const SENSITIVE_HEADERS = new Set([
  "authorization",
  "x-api-key",
  "api-key",
  "x-goog-api-key",
  "proxy-authorization",
  "x-xai-token-auth",
]);

export function isSensitiveHeader(name: string): boolean {
  return SENSITIVE_HEADERS.has(name.toLowerCase());
}

export function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    safe[k] = isSensitiveHeader(k) ? "***" : v;
  }
  return safe;
}

function hostOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isXaiSubscription(preset: APIPreset): boolean {
  if (preset.oauthProvider === "xai") return true;
  return hostOf(preset.url).includes("grok.com");
}

/**
 * 应用 OAuth / 自定义请求头覆盖。
 *
 * - anthropic：去掉 x-api-key，改 Bearer + anthropic-beta: oauth-2025-04-20
 * - google：去掉 x-goog-api-key，改 Bearer
 * - xai 订阅口：补 CLI 身份头（代理会校验）
 * - extraHeaders 最后合并
 */
export function applyAuthOverrides(
  headers: Record<string, string>,
  preset: APIPreset,
  protocol: APIProtocol,
): Record<string, string> {
  const out: Record<string, string> = { ...headers };

  if (preset.oauth) {
    if (protocol === "anthropic" || preset.oauthProvider === "anthropic") {
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
    if (protocol === "google" || protocol === "google-vertex" || preset.oauthProvider === "google") {
      delete out["x-goog-api-key"];
      out["Authorization"] = `Bearer ${preset.key ?? ""}`;
    }
    if (isXaiSubscription(preset)) {
      if (!out["x-xai-token-auth"]) out["x-xai-token-auth"] = "xai-grok-cli";
      if (!out["x-grok-client-identifier"]) out["x-grok-client-identifier"] = "grok-shell";
      if (!out["x-grok-client-version"]) out["x-grok-client-version"] = "0.2.93";
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
