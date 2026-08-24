/**
 * openai-codex 订阅登录：浏览器 PKCE（localhost:1455）或设备码。
 *
 * 令牌打 chatgpt.com 的 Responses 口（preset.protocol = "openai-codex"）。
 * 公开 client_id 来自官方 CLI，非机密。
 */

import { raceCodeFromCallback, startCallbackServer } from "./callback-server.js";
import { pollOAuthDeviceCodeFlow } from "./device-code.js";
import { decodeJwtPayload } from "./jwt.js";
import { maybeOpen } from "./open-url.js";
import { extractCode, parseAuthorizationInput } from "./parse-code.js";
import { generateCodeVerifier, codeChallengeS256, randomState } from "./pkce.js";
import { saveTokens } from "./store.js";
import type { AuthorizeRequest, OAuthLoginInteraction, OAuthTokens } from "./types.js";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_BASE = "https://auth.openai.com";
const AUTH_URL = `${AUTH_BASE}/oauth/authorize`;
const TOKEN_URL = `${AUTH_BASE}/oauth/token`;
const REDIRECT_URI = "http://localhost:1455/auth/callback";
const DEVICE_USER_CODE_URL = `${AUTH_BASE}/api/accounts/deviceauth/usercode`;
const DEVICE_TOKEN_URL = `${AUTH_BASE}/api/accounts/deviceauth/token`;
const DEVICE_VERIFICATION_URI = `${AUTH_BASE}/codex/device`;
const DEVICE_REDIRECT_URI = `${AUTH_BASE}/deviceauth/callback`;
const DEVICE_CODE_TIMEOUT_SECONDS = 15 * 60;
const SCOPES = "openid profile email offline_access";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";

export const OPENAI_CODEX_BROWSER_LOGIN_METHOD = "browser";
export const OPENAI_CODEX_DEVICE_CODE_LOGIN_METHOD = "device_code";

function accountIdFromAccess(accessToken: string): string | undefined {
  const payload = decodeJwtPayload(accessToken);
  const auth = payload?.[JWT_CLAIM_PATH];
  if (!auth || typeof auth !== "object") return undefined;
  const id = (auth as Record<string, unknown>).chatgpt_account_id;
  return typeof id === "string" && id ? id : undefined;
}

function tokensFromBody(data: Record<string, unknown>): OAuthTokens {
  const accessToken = String(data.access_token ?? "");
  const accountId = accountIdFromAccess(accessToken);
  return {
    provider: "openai-codex",
    accessToken,
    refreshToken: data.refresh_token ? String(data.refresh_token) : undefined,
    expiresAt: typeof data.expires_in === "number" ? Date.now() + data.expires_in * 1000 : undefined,
    tokenType: data.token_type ? String(data.token_type) : "Bearer",
    scope: SCOPES,
    extra: {
      ...(data.id_token ? { idToken: String(data.id_token) } : {}),
      ...(accountId ? { accountId } : {}),
    },
  };
}

async function exchangeCode(
  code: string,
  verifier: string,
  redirectUri: string,
  signal?: AbortSignal,
): Promise<OAuthTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    }).toString(),
    signal,
  });
  if (!res.ok) {
    throw new Error(`openai-codex OAuth 换票失败 (${res.status}): ${await res.text().catch(() => "")}`);
  }
  const tokens = tokensFromBody((await res.json()) as Record<string, unknown>);
  if (!tokens.accessToken) throw new Error("openai-codex OAuth 响应缺少 access_token");
  saveTokens(tokens);
  return tokens;
}

export function startOpenAICodexLogin(opts?: { redirectUri?: string; originator?: string }): AuthorizeRequest {
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
      originator: opts?.originator ?? "maou",
    }).toString();
  return { url, state, codeVerifier, redirectUri };
}

export async function completeOpenAICodexLogin(
  code: string,
  req: AuthorizeRequest,
  signal?: AbortSignal,
): Promise<OAuthTokens> {
  return exchangeCode(extractCode(code), req.codeVerifier, req.redirectUri, signal);
}

export async function refreshOpenAICodex(tokens: OAuthTokens, signal?: AbortSignal): Promise<OAuthTokens> {
  if (!tokens.refreshToken) throw new Error("openai-codex OAuth 缺少 refresh_token，无法刷新");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
      client_id: CLIENT_ID,
      scope: SCOPES,
    }).toString(),
    signal,
  });
  if (!res.ok) {
    throw new Error(`openai-codex OAuth 刷新失败 (${res.status}): ${await res.text().catch(() => "")}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  const next = tokensFromBody({
    ...data,
    refresh_token: data.refresh_token ?? tokens.refreshToken,
  });
  if (tokens.extra) {
    next.extra = { ...tokens.extra, ...next.extra };
  }
  saveTokens(next);
  return next;
}

export function loginOpenAICodex(opts?: { redirectUri?: string; originator?: string }): {
  url: string;
  complete: (code: string) => Promise<OAuthTokens>;
} {
  const req = startOpenAICodexLogin(opts);
  return { url: req.url, complete: (code: string) => completeOpenAICodexLogin(code, req) };
}

type DeviceAuth = { deviceAuthId: string; userCode: string; intervalSeconds: number };

async function startDeviceAuth(signal?: AbortSignal): Promise<DeviceAuth> {
  const res = await fetch(DEVICE_USER_CODE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID }),
    signal,
  });
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error("openai-codex 设备码登录当前不可用，请改用浏览器登录");
    }
    throw new Error(`openai-codex 设备码申请失败 (${res.status}): ${await res.text().catch(() => "")}`);
  }
  const json = (await res.json()) as Record<string, unknown>;
  const intervalSeconds =
    typeof json.interval === "string" ? Number(json.interval.trim()) : json.interval;
  if (
    typeof json.device_auth_id !== "string" ||
    typeof json.user_code !== "string" ||
    typeof intervalSeconds !== "number" ||
    !Number.isFinite(intervalSeconds)
  ) {
    throw new Error("openai-codex 设备码响应字段不完整");
  }
  return {
    deviceAuthId: json.device_auth_id,
    userCode: json.user_code,
    intervalSeconds,
  };
}

export async function loginOpenAICodexDeviceCode(opts: {
  signal?: AbortSignal;
  onAuth?: OAuthLoginInteraction["onAuth"];
  openBrowser?: boolean;
}): Promise<OAuthTokens> {
  const device = await startDeviceAuth(opts.signal);
  opts.onAuth?.({
    verificationUri: DEVICE_VERIFICATION_URI,
    userCode: device.userCode,
    expiresIn: DEVICE_CODE_TIMEOUT_SECONDS,
    instructions: `打开 ${DEVICE_VERIFICATION_URI} 并输入 ${device.userCode}`,
  });
  maybeOpen(DEVICE_VERIFICATION_URI, opts.openBrowser);

  const pair = await pollOAuthDeviceCodeFlow<{ authorizationCode: string; codeVerifier: string }>({
    intervalSeconds: device.intervalSeconds,
    expiresInSeconds: DEVICE_CODE_TIMEOUT_SECONDS,
    signal: opts.signal,
    poll: async () => {
      const res = await fetch(DEVICE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device_auth_id: device.deviceAuthId,
          user_code: device.userCode,
        }),
        signal: opts.signal,
      });
      if (res.ok) {
        const json = (await res.json()) as Record<string, unknown>;
        if (typeof json.authorization_code !== "string" || typeof json.code_verifier !== "string") {
          return { status: "failed", message: "openai-codex 设备码换票响应不完整" };
        }
        return {
          status: "complete",
          value: { authorizationCode: json.authorization_code, codeVerifier: json.code_verifier },
        };
      }
      if (res.status === 403 || res.status === 404) return { status: "pending" };
      const text = await res.text().catch(() => "");
      let errorCode: unknown;
      try {
        const parsed = JSON.parse(text) as { error?: { code?: string } | string };
        errorCode = typeof parsed.error === "object" ? parsed.error?.code : parsed.error;
      } catch {
        // ignore
      }
      if (errorCode === "deviceauth_authorization_pending") return { status: "pending" };
      if (errorCode === "slow_down") return { status: "slow_down" };
      return { status: "failed", message: `openai-codex 设备码失败 (${res.status})${text ? `: ${text}` : ""}` };
    },
  });

  return exchangeCode(pair.authorizationCode, pair.codeVerifier, DEVICE_REDIRECT_URI, opts.signal);
}

export async function runOpenAICodexBrowserLogin(
  interaction: OAuthLoginInteraction = {},
): Promise<OAuthTokens> {
  const req = startOpenAICodexLogin();
  const server = await startCallbackServer({
    port: 1455,
    path: "/auth/callback",
    expectedState: req.state,
    successMessage: "登录完成，可以关闭此窗口回到终端。",
  });
  interaction.onAuth?.({
    url: req.url,
    instructions: "在浏览器完成授权。若回调没弹回来，把授权码或完整 URL 粘贴到这里。",
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
    return completeOpenAICodexLogin(code, req, interaction.signal);
  } finally {
    server.close();
  }
}

export async function runOpenAICodexLogin(interaction: OAuthLoginInteraction = {}): Promise<OAuthTokens> {
  let method = interaction.method;
  if (!method && interaction.onSelect) {
    const picked = await interaction.onSelect({
      message: "选择 openai-codex 登录方式：",
      options: [
        { id: OPENAI_CODEX_BROWSER_LOGIN_METHOD, label: "浏览器登录（默认）" },
        { id: OPENAI_CODEX_DEVICE_CODE_LOGIN_METHOD, label: "设备码（无界面 / SSH）" },
      ],
    });
    method = picked === OPENAI_CODEX_DEVICE_CODE_LOGIN_METHOD ? "device" : "browser";
  }
  if (method === "device") {
    return loginOpenAICodexDeviceCode({
      signal: interaction.signal,
      onAuth: interaction.onAuth,
      openBrowser: interaction.openBrowser,
    });
  }
  return runOpenAICodexBrowserLogin(interaction);
}
