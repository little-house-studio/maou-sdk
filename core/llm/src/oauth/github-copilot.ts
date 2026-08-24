/**
 * GitHub Copilot 登录（设备码）。
 *
 * 两段式：GitHub Device Flow 拿长效 gho_ 令牌，再换短效推理令牌（约 30 分钟）。
 * 公开 client_id 来自编辑器插件，非机密。
 */

import { pollOAuthDeviceCodeFlow } from "./device-code.js";
import { maybeOpen } from "./open-url.js";
import { assertHttpUrl } from "./parse-code.js";
import { saveTokens } from "./store.js";
import type { DeviceCodeStart, OAuthLoginInteraction, OAuthTokens } from "./types.js";

const CLIENT_ID = "Iv1.b507a08c87ecfe98";
const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const COPILOT_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token";

/** 从短效令牌的 proxy-ep 推出推理 base URL */
export function getGitHubCopilotBaseUrl(copilotToken: string): string | null {
  const match = copilotToken.match(/proxy-ep=([^;]+)/);
  if (!match) return null;
  const apiHost = match[1].replace(/^proxy\./, "api.");
  return `https://${apiHost}`;
}

export async function startGitHubCopilotLogin(signal?: AbortSignal): Promise<DeviceCodeStart> {
  const res = await fetch(DEVICE_CODE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID, scope: "read:user" }),
    signal,
  });
  if (!res.ok) {
    throw new Error(`github-copilot 设备码申请失败 (${res.status}): ${await res.text().catch(() => "")}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  return {
    verificationUri: assertHttpUrl(String(data.verification_uri ?? "https://github.com/login/device")),
    userCode: String(data.user_code ?? ""),
    deviceCode: String(data.device_code ?? ""),
    interval: typeof data.interval === "number" ? data.interval : 5,
    expiresIn: typeof data.expires_in === "number" ? data.expires_in : 900,
  };
}

export async function pollGitHubToken(start: DeviceCodeStart, signal?: AbortSignal): Promise<string> {
  return pollOAuthDeviceCodeFlow<string>({
    intervalSeconds: start.interval,
    expiresInSeconds: start.expiresIn,
    waitBeforeFirstPoll: true,
    signal,
    poll: async () => {
      const res = await fetch(ACCESS_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          client_id: CLIENT_ID,
          device_code: start.deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
        signal,
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (data.access_token) return { status: "complete", value: String(data.access_token) };
      const err = String(data.error ?? "");
      if (err === "authorization_pending") return { status: "pending" };
      if (err === "slow_down") {
        return {
          status: "slow_down",
          intervalSeconds: typeof data.interval === "number" ? data.interval : undefined,
        };
      }
      if (err === "expired_token" || err === "access_denied") {
        return { status: "failed", message: `github-copilot 授权失败: ${err}` };
      }
      if (err) return { status: "failed", message: `github-copilot 授权出错: ${err}` };
      if (!res.ok) return { status: "failed", message: `github-copilot 轮询失败 (${res.status})` };
      return { status: "pending" };
    },
  });
}

export async function exchangeCopilotToken(githubToken: string, signal?: AbortSignal): Promise<OAuthTokens> {
  const res = await fetch(COPILOT_TOKEN_URL, {
    method: "GET",
    headers: {
      Authorization: `token ${githubToken}`,
      Accept: "application/json",
      "User-Agent": "GithubCopilot/1.155.0",
    },
    signal,
  });
  if (!res.ok) {
    throw new Error(`github-copilot token 换取失败 (${res.status}): ${await res.text().catch(() => "")}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  const accessToken = String(data.token ?? "");
  const tokens: OAuthTokens = {
    provider: "github-copilot",
    accessToken,
    expiresAt: typeof data.expires_at === "number" ? data.expires_at * 1000 : undefined,
    tokenType: "Bearer",
    extra: {
      githubToken,
      ...(getGitHubCopilotBaseUrl(accessToken)
        ? { baseUrl: getGitHubCopilotBaseUrl(accessToken) }
        : {}),
    },
  };
  saveTokens(tokens);
  return tokens;
}

export async function refreshGitHubCopilot(tokens: OAuthTokens, signal?: AbortSignal): Promise<OAuthTokens> {
  const githubToken = tokens.extra?.githubToken;
  if (typeof githubToken !== "string" || !githubToken) {
    throw new Error("github-copilot 缺少长效 github token，无法刷新（请重新登录）");
  }
  return exchangeCopilotToken(githubToken, signal);
}

export async function loginGitHubCopilot(interaction: OAuthLoginInteraction = {}): Promise<{
  verificationUri: string;
  userCode: string;
  expiresIn: number;
  complete: () => Promise<OAuthTokens>;
}> {
  const start = await startGitHubCopilotLogin(interaction.signal);
  interaction.onAuth?.({
    verificationUri: start.verificationUri,
    userCode: start.userCode,
    expiresIn: start.expiresIn,
    instructions: `打开 ${start.verificationUri} 并输入 ${start.userCode}`,
  });
  maybeOpen(start.verificationUri, interaction.openBrowser);
  return {
    verificationUri: start.verificationUri,
    userCode: start.userCode,
    expiresIn: start.expiresIn,
    complete: async () => {
      const githubToken = await pollGitHubToken(start, interaction.signal);
      return exchangeCopilotToken(githubToken, interaction.signal);
    },
  };
}

export async function runGitHubCopilotLogin(interaction: OAuthLoginInteraction = {}): Promise<OAuthTokens> {
  const session = await loginGitHubCopilot(interaction);
  interaction.onProgress?.("等待浏览器确认设备码…");
  return session.complete();
}
