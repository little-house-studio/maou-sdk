/**
 * OpenAI Codex（ChatGPT Plus/Pro）OAuth 登录
 *
 * 流程：Authorization Code + PKCE，回调到本地 http://localhost:1455/auth/callback。
 * 换取的 access token 用于 Codex 的 Responses 端点
 * （preset.protocol = "openai-codex"，url 形如 https://chatgpt.com/backend-api/codex/responses）。
 *
 * 公开 client_id 来自 OpenAI Codex CLI，非机密。
 */

import { generateCodeVerifier, codeChallengeS256, randomState } from "./pkce.js";
import { saveTokens } from "./store.js";
import type { AuthorizeRequest, OAuthTokens } from "./types.js";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_URL = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const REDIRECT_URI = "http://localhost:1455/auth/callback";
const SCOPES = "openid profile email offline_access";

/** 启动登录 */
export function startOpenAICodexLogin(opts?: { redirectUri?: string }): AuthorizeRequest {
  const codeVerifier = generateCodeVerifier();
  const challenge = codeChallengeS256(codeVerifier);
  const state = randomState();
  const redirectUri = opts?.redirectUri ?? REDIRECT_URI;
  const url =
    `${AUTH_URL}?` +
    new URLSearchParams({
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: redirectUri,
      scope: SCOPES,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
      id_token_add_organizations: "true",
      codex_cli_simplified_flow: "true",
    }).toString();
  return { url, state, codeVerifier, redirectUri };
}

/** 用授权码换取令牌（code 可来自回调 URL 的 ?code= 或直接粘贴） */
export async function completeOpenAICodexLogin(
  code: string,
  req: AuthorizeRequest,
): Promise<OAuthTokens> {
  const rawCode = extractCode(code);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: rawCode,
      redirect_uri: req.redirectUri,
      client_id: CLIENT_ID,
      code_verifier: req.codeVerifier,
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(`Codex OAuth 换取令牌失败 (${res.status}): ${await res.text().catch(() => "")}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  const tokens: OAuthTokens = {
    provider: "openai-codex",
    accessToken: String(data.access_token ?? ""),
    refreshToken: data.refresh_token ? String(data.refresh_token) : undefined,
    expiresAt: typeof data.expires_in === "number" ? Date.now() + data.expires_in * 1000 : undefined,
    tokenType: data.token_type ? String(data.token_type) : "Bearer",
    scope: SCOPES,
    extra: data.id_token ? { idToken: String(data.id_token) } : undefined,
  };
  saveTokens(tokens);
  return tokens;
}

/** 刷新令牌 */
export async function refreshOpenAICodex(tokens: OAuthTokens): Promise<OAuthTokens> {
  if (!tokens.refreshToken) throw new Error("Codex OAuth 缺少 refresh_token，无法刷新");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
      client_id: CLIENT_ID,
      scope: SCOPES,
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(`Codex OAuth 刷新失败 (${res.status}): ${await res.text().catch(() => "")}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  const next: OAuthTokens = {
    provider: "openai-codex",
    accessToken: String(data.access_token ?? tokens.accessToken),
    refreshToken: data.refresh_token ? String(data.refresh_token) : tokens.refreshToken,
    expiresAt: typeof data.expires_in === "number" ? Date.now() + data.expires_in * 1000 : tokens.expiresAt,
    tokenType: "Bearer",
    scope: SCOPES,
    extra: tokens.extra,
  };
  saveTokens(next);
  return next;
}

/** 便捷登录 */
export function loginOpenAICodex(opts?: { redirectUri?: string }): {
  url: string;
  complete: (code: string) => Promise<OAuthTokens>;
} {
  const req = startOpenAICodexLogin(opts);
  return { url: req.url, complete: (code: string) => completeOpenAICodexLogin(code, req) };
}

/** 从回调 URL 或裸串中提取 code */
function extractCode(input: string): string {
  const s = input.trim();
  if (s.includes("code=")) {
    try {
      const u = new URL(s);
      const c = u.searchParams.get("code");
      if (c) return c;
    } catch {
      const m = s.match(/code=([^&\s]+)/);
      if (m) return decodeURIComponent(m[1]);
    }
  }
  return s.split("#")[0];
}
