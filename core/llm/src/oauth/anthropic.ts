/**
 * Anthropic 订阅登录：Authorization Code + PKCE。
 *
 * 调用时：Authorization: Bearer + anthropic-beta: oauth-2025-04-20（preset.oauth=true）。
 * 公开 client_id 来自官方 CLI（installed app，非机密）。
 */

import { raceCodeFromCallback, startCallbackServer } from "./callback-server.js";
import { maybeOpen } from "./open-url.js";
import { parseAuthorizationInput } from "./parse-code.js";
import { generateCodeVerifier, codeChallengeS256, randomState } from "./pkce.js";
import { saveTokens } from "./store.js";
import type { AuthorizeRequest, OAuthLoginInteraction, OAuthTokens } from "./types.js";

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const CONSOLE_REDIRECT = "https://console.anthropic.com/oauth/code/callback";
const LOOPBACK_PORT = 53692;
const LOOPBACK_PATH = "/callback";
const LOOPBACK_REDIRECT = `http://localhost:${LOOPBACK_PORT}${LOOPBACK_PATH}`;
const SCOPES =
  "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";

export type AnthropicLoginOpts = {
  /** 走控制台回调页（粘贴 code#state）；默认本机 loopback URL，仍可粘贴 */
  useConsole?: boolean;
  redirectUri?: string;
};

function authorizeUrl(redirectUri: string, challenge: string, state: string, useConsole?: boolean): string {
  const authBase = useConsole
    ? "https://console.anthropic.com/oauth/authorize"
    : "https://claude.ai/oauth/authorize";
  return (
    `${authBase}?` +
    new URLSearchParams({
      code: "true",
      client_id: CLIENT_ID,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: SCOPES,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
    }).toString()
  );
}

function tokensFromBody(data: Record<string, unknown>): OAuthTokens {
  return {
    provider: "anthropic",
    accessToken: String(data.access_token ?? ""),
    refreshToken: data.refresh_token ? String(data.refresh_token) : undefined,
    expiresAt: typeof data.expires_in === "number" ? Date.now() + data.expires_in * 1000 : undefined,
    tokenType: data.token_type ? String(data.token_type) : "Bearer",
    scope: data.scope ? String(data.scope) : SCOPES,
  };
}

async function postToken(body: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    throw new Error(`anthropic OAuth 换票失败 (${res.status}): ${await res.text().catch(() => "")}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

/** 启动登录：生成授权 URL + PKCE 上下文 */
export function startAnthropicLogin(opts?: AnthropicLoginOpts): AuthorizeRequest {
  const codeVerifier = generateCodeVerifier();
  const challenge = codeChallengeS256(codeVerifier);
  const state = randomState();
  const redirectUri =
    opts?.redirectUri ?? (opts?.useConsole === false ? LOOPBACK_REDIRECT : CONSOLE_REDIRECT);
  return {
    url: authorizeUrl(redirectUri, challenge, state, opts?.useConsole),
    state,
    codeVerifier,
    redirectUri,
  };
}

/** 用授权码换取令牌（code 可能形如 "code#state" 或完整 URL） */
export async function completeAnthropicLogin(
  code: string,
  req: AuthorizeRequest,
  signal?: AbortSignal,
): Promise<OAuthTokens> {
  const parsed = parseAuthorizationInput(code);
  const rawCode = parsed.code ?? code.trim().split("#")[0];
  const state = parsed.state ?? req.state;
  const data = await postToken(
    {
      grant_type: "authorization_code",
      code: rawCode,
      state,
      client_id: CLIENT_ID,
      redirect_uri: req.redirectUri,
      code_verifier: req.codeVerifier,
    },
    signal,
  );
  const tokens = tokensFromBody(data);
  saveTokens(tokens);
  return tokens;
}

export async function refreshAnthropic(tokens: OAuthTokens, signal?: AbortSignal): Promise<OAuthTokens> {
  if (!tokens.refreshToken) throw new Error("anthropic OAuth 缺少 refresh_token，无法刷新");
  const data = await postToken(
    {
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
      client_id: CLIENT_ID,
    },
    signal,
  );
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
 * 用法：打开 url，授权后把 code 传给 complete()。
 */
export function loginAnthropic(opts?: AnthropicLoginOpts): {
  url: string;
  complete: (code: string) => Promise<OAuthTokens>;
} {
  const req = startAnthropicLogin(opts);
  return { url: req.url, complete: (code: string) => completeAnthropicLogin(code, req) };
}

/** 本机回调 + 粘贴兜底的完整登录 */
export async function runAnthropicLogin(interaction: OAuthLoginInteraction = {}): Promise<OAuthTokens> {
  const req = startAnthropicLogin({ useConsole: false });
  const server = await startCallbackServer({
    port: LOOPBACK_PORT,
    path: LOOPBACK_PATH,
    expectedState: req.state,
    successMessage: "登录完成，可以关闭此窗口回到终端。",
  });
  interaction.onAuth?.({
    url: req.url,
    instructions: "在浏览器完成授权。若浏览器不在本机，把最终回调 URL 粘贴回来。",
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
    return completeAnthropicLogin(code, { ...req, redirectUri: LOOPBACK_REDIRECT }, interaction.signal);
  } finally {
    server.close();
  }
}
