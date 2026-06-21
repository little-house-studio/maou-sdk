/**
 * Anthropic（Claude Pro/Max）OAuth 登录
 *
 * 流程：Authorization Code + PKCE。用户在浏览器授权后，把页面给出的 code 粘贴回来
 * （格式可能为 "code#state"），换取 access/refresh token。
 *
 * 调用 LLM 时：Authorization: Bearer <accessToken> + header `anthropic-beta: oauth-2025-04-20`，
 * 且不再发送 x-api-key（由 LLMClient 在 preset.oauth=true 时自动处理）。
 *
 * 公开 client_id 来自 Claude Code / 开源实现，非机密。
 */

import { generateCodeVerifier, codeChallengeS256, randomState } from "./pkce.js";
import { saveTokens } from "./store.js";
import type { AuthorizeRequest, OAuthTokens } from "./types.js";

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback";
const SCOPES = "org:create_api_key user:profile user:inference";
const TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";

/** 启动登录：生成授权 URL + PKCE 上下文 */
export function startAnthropicLogin(opts?: { useConsole?: boolean }): AuthorizeRequest {
  const codeVerifier = generateCodeVerifier();
  const challenge = codeChallengeS256(codeVerifier);
  const state = randomState();
  const authBase = opts?.useConsole
    ? "https://console.anthropic.com/oauth/authorize"
    : "https://claude.ai/oauth/authorize";
  const url =
    `${authBase}?` +
    new URLSearchParams({
      code: "true",
      client_id: CLIENT_ID,
      response_type: "code",
      redirect_uri: REDIRECT_URI,
      scope: SCOPES,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
    }).toString();
  return { url, state, codeVerifier, redirectUri: REDIRECT_URI };
}

/** 用授权码换取令牌（code 可能形如 "code#state"） */
export async function completeAnthropicLogin(
  code: string,
  req: AuthorizeRequest,
): Promise<OAuthTokens> {
  const [rawCode, stateFromCode] = code.trim().split("#");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code: rawCode,
      state: stateFromCode ?? req.state,
      client_id: CLIENT_ID,
      redirect_uri: req.redirectUri,
      code_verifier: req.codeVerifier,
    }),
  });
  if (!res.ok) {
    throw new Error(`Anthropic OAuth 换取令牌失败 (${res.status}): ${await res.text().catch(() => "")}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  const tokens: OAuthTokens = {
    provider: "anthropic",
    accessToken: String(data.access_token ?? ""),
    refreshToken: data.refresh_token ? String(data.refresh_token) : undefined,
    expiresAt: typeof data.expires_in === "number" ? Date.now() + data.expires_in * 1000 : undefined,
    tokenType: data.token_type ? String(data.token_type) : "Bearer",
    scope: data.scope ? String(data.scope) : SCOPES,
  };
  saveTokens(tokens);
  return tokens;
}

/** 刷新令牌 */
export async function refreshAnthropic(tokens: OAuthTokens): Promise<OAuthTokens> {
  if (!tokens.refreshToken) throw new Error("Anthropic OAuth 缺少 refresh_token，无法刷新");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
      client_id: CLIENT_ID,
    }),
  });
  if (!res.ok) {
    throw new Error(`Anthropic OAuth 刷新失败 (${res.status}): ${await res.text().catch(() => "")}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  const next: OAuthTokens = {
    provider: "anthropic",
    accessToken: String(data.access_token ?? tokens.accessToken),
    refreshToken: data.refresh_token ? String(data.refresh_token) : tokens.refreshToken,
    expiresAt: typeof data.expires_in === "number" ? Date.now() + data.expires_in * 1000 : tokens.expiresAt,
    tokenType: data.token_type ? String(data.token_type) : "Bearer",
    scope: tokens.scope,
  };
  saveTokens(next);
  return next;
}

/**
 * 便捷登录：返回授权 URL 与 complete 回调。
 * 用法：打开 url，让用户授权后把 code 传给 complete()。
 */
export function loginAnthropic(opts?: { useConsole?: boolean }): {
  url: string;
  complete: (code: string) => Promise<OAuthTokens>;
} {
  const req = startAnthropicLogin(opts);
  return { url: req.url, complete: (code: string) => completeAnthropicLogin(code, req) };
}
