/**
 * 订阅 OAuth SDK
 *
 * loginOAuth / login* / refreshOAuthToken / getOAuthApiKey / applyOAuthToPreset
 * 令牌落在 ~/.maou/oauth/<provider>.json（MAOU_OAUTH_DIR 可覆盖）。
 */

import type { APIPreset } from "../adapters/types.js";
import { refreshAnthropic, runAnthropicLogin } from "./anthropic.js";
import { OAUTH_CATALOG, inferOAuthProvider } from "./catalog.js";
import { refreshGeminiCli, runGeminiCliLogin } from "./google.js";
import { getGitHubCopilotBaseUrl, refreshGitHubCopilot, runGitHubCopilotLogin } from "./github-copilot.js";
import { refreshOpenAICodex, runOpenAICodexLogin } from "./openai-codex.js";
import { clearTokens, isExpired, loadTokens } from "./store.js";
import type { OAuthLoginInteraction, OAuthProvider, OAuthTokens } from "./types.js";
import { refreshXai, runXaiLogin } from "./xai.js";

export * from "./types.js";
export { parseAuthorizationInput, extractCode } from "./parse-code.js";
export { generateCodeVerifier, codeChallengeS256, randomState } from "./pkce.js";
export {
  loadTokens,
  saveTokens,
  clearTokens,
  isExpired,
  expiryMs,
  oauthDir,
  listSavedProviders,
  listOAuthStatus,
} from "./store.js";
export { inferOAuthProvider, getOAuthProviderInfo, listOAuthProviderInfo, OAUTH_CATALOG } from "./catalog.js";
export { pollOAuthDeviceCodeFlow } from "./device-code.js";
export { loginAnthropic, startAnthropicLogin, completeAnthropicLogin, refreshAnthropic, runAnthropicLogin } from "./anthropic.js";
export {
  loginOpenAICodex,
  startOpenAICodexLogin,
  completeOpenAICodexLogin,
  refreshOpenAICodex,
  loginOpenAICodexDeviceCode,
  runOpenAICodexLogin,
  runOpenAICodexBrowserLogin,
  OPENAI_CODEX_BROWSER_LOGIN_METHOD,
  OPENAI_CODEX_DEVICE_CODE_LOGIN_METHOD,
} from "./openai-codex.js";
export { loginGeminiCli, startGeminiCliLogin, completeGeminiCliLogin, refreshGeminiCli, runGeminiCliLogin } from "./google.js";
export {
  loginGitHubCopilot,
  startGitHubCopilotLogin,
  pollGitHubToken,
  exchangeCopilotToken,
  refreshGitHubCopilot,
  runGitHubCopilotLogin,
  getGitHubCopilotBaseUrl,
} from "./github-copilot.js";
export { loginXai, startXaiLogin, pollXaiToken, refreshXai, runXaiLogin } from "./xai.js";

const refreshLocks = new Map<OAuthProvider, Promise<OAuthTokens>>();

async function dispatchRefresh(tokens: OAuthTokens): Promise<OAuthTokens> {
  switch (tokens.provider) {
    case "anthropic":
      return refreshAnthropic(tokens);
    case "openai-codex":
      return refreshOpenAICodex(tokens);
    case "google":
      return refreshGeminiCli(tokens);
    case "github-copilot":
      return refreshGitHubCopilot(tokens);
    case "xai":
      return refreshXai(tokens);
    default:
      throw new Error(`未知 OAuth provider: ${String((tokens as OAuthTokens).provider)}`);
  }
}

/** 按 provider 刷新；同厂商并发刷新合并为一次（避免 refresh_token 轮换互相踩） */
export async function refreshOAuthToken(provider: OAuthProvider): Promise<OAuthTokens> {
  const inflight = refreshLocks.get(provider);
  if (inflight) return inflight;
  const task = (async () => {
    const latest = loadTokens(provider);
    if (!latest) throw new Error(`${provider} 尚未登录（无已保存令牌）`);
    if (!isExpired(latest) && latest.accessToken) return latest;
    return dispatchRefresh(latest);
  })().finally(() => {
    if (refreshLocks.get(provider) === task) refreshLocks.delete(provider);
  });
  refreshLocks.set(provider, task);
  return task;
}

/**
 * 取有效 access token：已登录则返回；过期则自动刷新。
 * @throws 未登录时抛错
 */
export async function getOAuthApiKey(provider: OAuthProvider): Promise<string> {
  let tokens = loadTokens(provider);
  if (!tokens) throw new Error(`${provider} 尚未登录，请先调用 loginOAuth("${provider}")`);
  if (isExpired(tokens)) {
    tokens = await refreshOAuthToken(provider);
  }
  return tokens.accessToken;
}

export function isLoggedIn(provider: OAuthProvider): boolean {
  return loadTokens(provider) != null;
}

export function logoutOAuth(provider: OAuthProvider): void {
  clearTokens(provider);
}

/** 统一登录入口：浏览器回调 / 设备码，由厂商 catalog.flow 决定 */
export async function loginOAuth(
  provider: OAuthProvider,
  interaction: OAuthLoginInteraction = {},
): Promise<OAuthTokens> {
  switch (provider) {
    case "anthropic":
      return runAnthropicLogin(interaction);
    case "openai-codex":
      return runOpenAICodexLogin(interaction);
    case "github-copilot":
      return runGitHubCopilotLogin(interaction);
    case "google":
      return runGeminiCliLogin(interaction);
    case "xai":
      return runXaiLogin(interaction);
    default:
      throw new Error(`未知 OAuth provider: ${String(provider)}`);
  }
}

function extraFromTokens(provider: OAuthProvider, tokens: OAuthTokens | null): Record<string, string> {
  if (!tokens?.extra) return {};
  if (provider === "openai-codex" && typeof tokens.extra.accountId === "string") {
    return { "ChatGPT-Account-ID": tokens.extra.accountId };
  }
  return {};
}

/**
 * 把 OAuth 令牌注入 preset：key + oauth 标记 + 缺省协议/入口/专有头。
 * 调用方已写的 url / protocol / extraHeaders 优先。
 */
export async function applyOAuthToPreset(
  preset: APIPreset,
  provider?: OAuthProvider,
): Promise<APIPreset> {
  const id = provider ?? inferOAuthProvider(preset);
  if (!id) throw new Error("无法判断 OAuth provider，请传入第二参数或设置 preset.oauthProvider");
  const key = await getOAuthApiKey(id);
  const defaults = OAUTH_CATALOG[id];
  const tokens = loadTokens(id);
  const url = (preset.url ?? "").trim()
    ? preset.url
    : id === "github-copilot" && tokens
      ? (getGitHubCopilotBaseUrl(tokens.accessToken) ?? defaults.url)
      : defaults.url;
  return {
    ...preset,
    key,
    oauth: true,
    oauthProvider: id,
    protocol: preset.protocol || defaults.protocol,
    url,
    model: preset.model || defaults.model,
    extraHeaders: {
      ...defaults.extraHeaders,
      ...extraFromTokens(id, tokens),
      ...preset.extraHeaders,
    },
  };
}

/**
 * LLMClient 在 preset.oauth=true 时调用：已登录则续票注入；仅有手工 key 则原样返回。
 */
export async function resolveOAuthPreset(preset: APIPreset): Promise<APIPreset> {
  if (!preset.oauth) return preset;
  const id = inferOAuthProvider(preset);
  if (!id) return preset;
  if (!loadTokens(id)) {
    return { ...preset, oauthProvider: id };
  }
  return applyOAuthToPreset(preset, id);
}
