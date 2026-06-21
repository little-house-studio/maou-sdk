/**
 * GitHub Copilot OAuth 登录（设备码流程 Device Flow）
 *
 * 两段式：
 *   1. GitHub Device Flow 拿到长效 github token（gho_...）。
 *   2. 用 github token 调 copilot_internal/v2/token 换取短效 Copilot token（约 30 分钟过期）。
 *
 * 调用 LLM 时用短效 Copilot token 作为 Bearer 打 https://api.githubcopilot.com/chat/completions
 * （preset.protocol = "github-copilot"）。过期后用长效 github token 自动续期。
 *
 * 公开 client_id 来自编辑器 Copilot 插件，非机密。
 */

import { saveTokens } from "./store.js";
import type { DeviceCodeStart, OAuthTokens } from "./types.js";

const CLIENT_ID = "Iv1.b507a08c87ecfe98";
const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const COPILOT_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token";

/** 第一步：申请设备码 */
export async function startGitHubCopilotLogin(): Promise<DeviceCodeStart> {
  const res = await fetch(DEVICE_CODE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID, scope: "read:user" }),
  });
  if (!res.ok) {
    throw new Error(`Copilot 设备码申请失败 (${res.status}): ${await res.text().catch(() => "")}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  return {
    verificationUri: String(data.verification_uri ?? "https://github.com/login/device"),
    userCode: String(data.user_code ?? ""),
    deviceCode: String(data.device_code ?? ""),
    interval: typeof data.interval === "number" ? data.interval : 5,
    expiresIn: typeof data.expires_in === "number" ? data.expires_in : 900,
  };
}

/** 轮询直到用户在浏览器完成授权，返回长效 github token */
export async function pollGitHubToken(start: DeviceCodeStart): Promise<string> {
  const deadline = Date.now() + start.expiresIn * 1000;
  let interval = start.interval;
  while (Date.now() < deadline) {
    await sleep(interval * 1000);
    const res = await fetch(ACCESS_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        device_code: start.deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (data.access_token) return String(data.access_token);
    const err = String(data.error ?? "");
    if (err === "authorization_pending") continue;
    if (err === "slow_down") {
      interval += 5;
      continue;
    }
    if (err === "expired_token" || err === "access_denied") {
      throw new Error(`Copilot 授权失败: ${err}`);
    }
    if (err) throw new Error(`Copilot 授权出错: ${err}`);
  }
  throw new Error("Copilot 授权超时");
}

/** 用长效 github token 换取短效 Copilot token，并保存 */
export async function exchangeCopilotToken(githubToken: string): Promise<OAuthTokens> {
  const res = await fetch(COPILOT_TOKEN_URL, {
    method: "GET",
    headers: {
      Authorization: `token ${githubToken}`,
      Accept: "application/json",
      "User-Agent": "GithubCopilot/1.155.0",
    },
  });
  if (!res.ok) {
    throw new Error(`Copilot token 换取失败 (${res.status}): ${await res.text().catch(() => "")}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  const tokens: OAuthTokens = {
    provider: "github-copilot",
    accessToken: String(data.token ?? ""),
    expiresAt: typeof data.expires_at === "number" ? data.expires_at * 1000 : undefined,
    tokenType: "Bearer",
    extra: { githubToken },
  };
  saveTokens(tokens);
  return tokens;
}

/** 用已保存的长效 github token 刷新短效 Copilot token */
export async function refreshGitHubCopilot(tokens: OAuthTokens): Promise<OAuthTokens> {
  const githubToken = tokens.extra?.githubToken;
  if (typeof githubToken !== "string" || !githubToken) {
    throw new Error("Copilot 缺少长效 github token，无法刷新（请重新登录）");
  }
  return exchangeCopilotToken(githubToken);
}

/**
 * 便捷登录：返回设备码信息与 complete 回调。
 * 用法：提示用户访问 verificationUri 并输入 userCode，然后 await complete()。
 */
export async function loginGitHubCopilot(): Promise<{
  verificationUri: string;
  userCode: string;
  expiresIn: number;
  complete: () => Promise<OAuthTokens>;
}> {
  const start = await startGitHubCopilotLogin();
  return {
    verificationUri: start.verificationUri,
    userCode: start.userCode,
    expiresIn: start.expiresIn,
    complete: async () => {
      const githubToken = await pollGitHubToken(start);
      return exchangeCopilotToken(githubToken);
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
