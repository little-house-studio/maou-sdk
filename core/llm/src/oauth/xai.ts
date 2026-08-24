/**
 * xAI 订阅登录（RFC 8628 设备码）。
 *
 * 换到的令牌打订阅推理口（cli-chat-proxy），不是开发者 Key 口。
 */

import { pollOAuthDeviceCodeFlow } from "./device-code.js";
import { maybeOpen } from "./open-url.js";
import { assertHttpsUrl } from "./parse-code.js";
import { saveTokens } from "./store.js";
import type { DeviceCodeStart, OAuthLoginInteraction, OAuthTokens } from "./types.js";

const CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const SCOPE = "openid profile email offline_access grok-cli:access api:access conversations:read conversations:write";
const DEVICE_CODE_URL = "https://auth.x.ai/oauth2/device/code";
const TOKEN_URL = "https://auth.x.ai/oauth2/token";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const DEFAULT_TOKEN_LIFETIME_SECONDS = 3600;

function requiredString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || !value) {
    throw new Error(`xai OAuth 响应缺少字段: ${field}`);
  }
  return value;
}

function positiveNumber(body: Record<string, unknown>, field: string): number {
  const value = body[field];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`xai OAuth 响应字段非法: ${field}`);
  }
  return value;
}

async function postForm(
  url: string,
  fields: Record<string, string>,
  signal?: AbortSignal,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(fields),
    signal,
  });
  let body: Record<string, unknown> = {};
  try {
    const parsed = (await res.json()) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    throw new Error(`xai OAuth 返回了非 JSON（HTTP ${res.status}）`);
  }
  return { ok: res.ok, status: res.status, body };
}

function requestFailure(action: string, response: { status: number; body: Record<string, unknown> }): Error {
  const error = typeof response.body.error === "string" ? response.body.error : undefined;
  const description =
    typeof response.body.error_description === "string" ? response.body.error_description : undefined;
  const detail = [error, description].filter(Boolean).join(": ");
  return new Error(`xai OAuth ${action} 失败（HTTP ${response.status}）${detail ? `: ${detail}` : ""}`);
}

function tokensFromBody(body: Record<string, unknown>, previousRefresh?: string): OAuthTokens {
  const accessToken = requiredString(body, "access_token");
  const refresh =
    body.refresh_token === undefined && previousRefresh
      ? previousRefresh
      : requiredString(body, "refresh_token");
  const expiresIn =
    body.expires_in === undefined ? DEFAULT_TOKEN_LIFETIME_SECONDS : positiveNumber(body, "expires_in");
  return {
    provider: "xai",
    accessToken,
    refreshToken: refresh,
    expiresAt: Date.now() + expiresIn * 1000,
    tokenType: body.token_type ? String(body.token_type) : "Bearer",
    extra: body.id_token ? { idToken: String(body.id_token) } : undefined,
  };
}

export async function startXaiLogin(signal?: AbortSignal): Promise<DeviceCodeStart> {
  const response = await postForm(
    DEVICE_CODE_URL,
    { client_id: CLIENT_ID, scope: SCOPE, referrer: "maou" },
    signal,
  );
  if (!response.ok) throw requestFailure("申请设备码", response);
  const interval = response.body.interval;
  const complete =
    typeof response.body.verification_uri_complete === "string" && response.body.verification_uri_complete
      ? assertHttpsUrl(response.body.verification_uri_complete, "verification_uri_complete")
      : undefined;
  return {
    deviceCode: requiredString(response.body, "device_code"),
    userCode: requiredString(response.body, "user_code"),
    verificationUri: assertHttpsUrl(requiredString(response.body, "verification_uri")),
    verificationUriComplete: complete,
    interval: typeof interval === "number" && interval > 0 ? interval : 5,
    expiresIn: positiveNumber(response.body, "expires_in"),
  };
}

export async function pollXaiToken(start: DeviceCodeStart, signal?: AbortSignal): Promise<OAuthTokens> {
  const tokens = await pollOAuthDeviceCodeFlow<OAuthTokens>({
    intervalSeconds: start.interval,
    expiresInSeconds: start.expiresIn,
    waitBeforeFirstPoll: true,
    signal,
    poll: async () => {
      const response = await postForm(
        TOKEN_URL,
        {
          grant_type: DEVICE_GRANT,
          client_id: CLIENT_ID,
          device_code: start.deviceCode,
        },
        signal,
      );
      if (response.ok) return { status: "complete", value: tokensFromBody(response.body) };
      const error = response.body.error;
      if (error === "authorization_pending") return { status: "pending" };
      if (error === "slow_down") {
        const interval = response.body.interval;
        return { status: "slow_down", intervalSeconds: typeof interval === "number" ? interval : undefined };
      }
      if (error === "access_denied" || error === "authorization_denied") {
        return { status: "failed", message: "xai 设备授权被拒绝" };
      }
      if (error === "expired_token") {
        return { status: "failed", message: "xai 设备码已过期" };
      }
      return { status: "failed", message: requestFailure("轮询换票", response).message };
    },
  });
  saveTokens(tokens);
  return tokens;
}

export async function refreshXai(tokens: OAuthTokens, signal?: AbortSignal): Promise<OAuthTokens> {
  if (!tokens.refreshToken) throw new Error("xai OAuth 缺少 refresh_token，无法刷新");
  const response = await postForm(
    TOKEN_URL,
    {
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: tokens.refreshToken,
    },
    signal,
  );
  if (!response.ok) {
    if (response.status === 403) {
      throw new Error("xai 账号已登录但未被授权走订阅推理口（可改用开发者 API Key）");
    }
    throw requestFailure("刷新", response);
  }
  const next = tokensFromBody(response.body, tokens.refreshToken);
  saveTokens(next);
  return next;
}

export async function loginXai(interaction: OAuthLoginInteraction = {}): Promise<{
  verificationUri: string;
  userCode: string;
  expiresIn: number;
  complete: () => Promise<OAuthTokens>;
}> {
  const start = await startXaiLogin(interaction.signal);
  const openUrl = start.verificationUriComplete ?? start.verificationUri;
  interaction.onAuth?.({
    verificationUri: openUrl,
    userCode: start.userCode,
    expiresIn: start.expiresIn,
    instructions: `打开 ${openUrl} 并确认设备码 ${start.userCode}`,
  });
  maybeOpen(openUrl, interaction.openBrowser);
  return {
    verificationUri: openUrl,
    userCode: start.userCode,
    expiresIn: start.expiresIn,
    complete: () => pollXaiToken(start, interaction.signal),
  };
}

export async function runXaiLogin(interaction: OAuthLoginInteraction = {}): Promise<OAuthTokens> {
  const session = await loginXai(interaction);
  interaction.onProgress?.("等待浏览器确认设备码…");
  return session.complete();
}
