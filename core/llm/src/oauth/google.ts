/**
 * Google 账号登录（Gemini CLI 的 installed-app client）。
 *
 * 公开 client_id / client_secret 来自官方 CLI（secret 可嵌入）。
 */

import { raceCodeFromCallback, startCallbackServer } from "./callback-server.js";
import { maybeOpen } from "./open-url.js";
import { extractCode, parseAuthorizationInput } from "./parse-code.js";
import { generateCodeVerifier, codeChallengeS256, randomState } from "./pkce.js";
import { saveTokens } from "./store.js";
import type { AuthorizeRequest, OAuthLoginInteraction, OAuthTokens } from "./types.js";

const CLIENT_ID = "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com";
const CLIENT_SECRET = "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";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DEFAULT_PORT = 8085;
const DEFAULT_PATH = "/oauth2callback";
const DEFAULT_REDIRECT = `http://localhost:${DEFAULT_PORT}${DEFAULT_PATH}`;
const SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
].join(" ");

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

export async function completeGeminiCliLogin(
  code: string,
  req: AuthorizeRequest,
  signal?: AbortSignal,
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
    signal,
  });
  if (!res.ok) {
    throw new Error(`google OAuth 换票失败 (${res.status}): ${await res.text().catch(() => "")}`);
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

export async function refreshGeminiCli(tokens: OAuthTokens, signal?: AbortSignal): Promise<OAuthTokens> {
  if (!tokens.refreshToken) throw new Error("google OAuth 缺少 refresh_token，无法刷新");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }).toString(),
    signal,
  });
  if (!res.ok) {
    throw new Error(`google OAuth 刷新失败 (${res.status}): ${await res.text().catch(() => "")}`);
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

export function loginGeminiCli(opts?: { redirectUri?: string }): {
  url: string;
  complete: (code: string) => Promise<OAuthTokens>;
} {
  const req = startGeminiCliLogin(opts);
  return { url: req.url, complete: (code: string) => completeGeminiCliLogin(code, req) };
}

export async function runGeminiCliLogin(interaction: OAuthLoginInteraction = {}): Promise<OAuthTokens> {
  const req = startGeminiCliLogin();
  const server = await startCallbackServer({
    port: DEFAULT_PORT,
    path: DEFAULT_PATH,
    expectedState: req.state,
    successMessage: "登录完成，可以关闭此窗口回到终端。",
  });
  interaction.onAuth?.({
    url: req.url,
    instructions: "在浏览器完成 Google 授权。若回调没弹回来，把授权码或完整 URL 粘贴到这里。",
  });
  maybeOpen(req.url, interaction.openBrowser);
  try {
    const code = await raceCodeFromCallback({
      server,
      expectedState: req.state,
      signal: interaction.signal,
      onPrompt: interaction.onPrompt,
      parse: parseAuthorizationInput,
    });
    interaction.onProgress?.("正在换取令牌…");
    return completeGeminiCliLogin(code, req, interaction.signal);
  } finally {
    server.close();
  }
}
