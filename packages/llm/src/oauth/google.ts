/**
 * Gemini CLI（Google 账号）OAuth 登录
 *
 * 流程：Authorization Code + PKCE，回调到本地 loopback。换取的 access token 可用于
 * Google / Vertex 系端点（preset.protocol = "google" 或 "google-vertex"，Bearer 认证）。
 *
 * 公开 client_id / client_secret 来自 Gemini CLI（"installed app"，secret 非机密，可公开嵌入）。
 */

import { generateCodeVerifier, codeChallengeS256, randomState } from "./pkce.js";
import { saveTokens } from "./store.js";
import type { AuthorizeRequest, OAuthTokens } from "./types.js";

const CLIENT_ID = "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com";
const CLIENT_SECRET = "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";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DEFAULT_REDIRECT = "http://localhost:8085/oauth2callback";
const SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
].join(" ");

/** 启动登录 */
export function startGeminiCliLogin(opts?: { redirectUri?: string }): AuthorizeRequest {
  const codeVerifier = generateCodeVerifier();
  const challenge = codeChallengeS256(codeVerifier);
  const state = randomState();
  const redirectUri = opts?.redirectUri ?? DEFAULT_REDIRECT;
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
      access_type: "offline",
      prompt: "consent",
    }).toString();
  return { url, state, codeVerifier, redirectUri };
}

/** 用授权码换取令牌 */
export async function completeGeminiCliLogin(
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
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: req.redirectUri,
      code_verifier: req.codeVerifier,
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(`Gemini OAuth 换取令牌失败 (${res.status}): ${await res.text().catch(() => "")}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  const tokens: OAuthTokens = {
    provider: "google",
    accessToken: String(data.access_token ?? ""),
    refreshToken: data.refresh_token ? String(data.refresh_token) : undefined,
    expiresAt: typeof data.expires_in === "number" ? Date.now() + data.expires_in * 1000 : undefined,
    tokenType: data.token_type ? String(data.token_type) : "Bearer",
    scope: SCOPES,
  };
  saveTokens(tokens);
  return tokens;
}

/** 刷新令牌 */
export async function refreshGeminiCli(tokens: OAuthTokens): Promise<OAuthTokens> {
  if (!tokens.refreshToken) throw new Error("Gemini OAuth 缺少 refresh_token，无法刷新");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(`Gemini OAuth 刷新失败 (${res.status}): ${await res.text().catch(() => "")}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  const next: OAuthTokens = {
    provider: "google",
    accessToken: String(data.access_token ?? tokens.accessToken),
    refreshToken: tokens.refreshToken,
    expiresAt: typeof data.expires_in === "number" ? Date.now() + data.expires_in * 1000 : tokens.expiresAt,
    tokenType: "Bearer",
    scope: SCOPES,
  };
  saveTokens(next);
  return next;
}

/** 便捷登录 */
export function loginGeminiCli(opts?: { redirectUri?: string }): {
  url: string;
  complete: (code: string) => Promise<OAuthTokens>;
} {
  const req = startGeminiCliLogin(opts);
  return { url: req.url, complete: (code: string) => completeGeminiCliLogin(code, req) };
}

function extractCode(input: string): string {
  const s = input.trim();
  if (s.includes("code=")) {
    try {
      return new URL(s).searchParams.get("code") ?? s;
    } catch {
      const m = s.match(/code=([^&\s]+)/);
      if (m) return decodeURIComponent(m[1]);
    }
  }
  return s;
}
