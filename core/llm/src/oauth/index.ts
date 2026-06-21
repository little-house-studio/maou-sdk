/**
 * OAuth 订阅登录 SDK（barrel）
 *
 * 对标 pi-ai：loginAnthropic / loginOpenAICodex / loginGitHubCopilot / loginGeminiCli /
 * refreshOAuthToken / getOAuthApiKey —— 用订阅账号登录换取 token，免按量付费 API key。
 *
 * 子路径：core/llm/oauth
 *
 * @example
 * import { loginAnthropic, applyOAuthToPreset } from "core/llm/oauth"
 * const { url, complete } = loginAnthropic()
 * console.log("请打开并授权：", url)
 * await complete(codeFromUser)              // 保存令牌
 * const preset = await applyOAuthToPreset(basePreset, "anthropic")  // 自动注入 token + oauth 标记
 */

import type { APIPreset } from "../adapters/types.js";
import type { OAuthProvider, OAuthTokens } from "./types.js";
import { loadTokens, saveTokens, clearTokens, isExpired } from "./store.js";
import { refreshAnthropic } from "./anthropic.js";
import { refreshOpenAICodex } from "./openai-codex.js";
import { refreshGeminiCli } from "./google.js";
import { refreshGitHubCopilot } from "./github-copilot.js";

// ── 重新导出各 provider 的登录入口 ──
export * from "./types.js";
export { loginAnthropic, startAnthropicLogin, completeAnthropicLogin, refreshAnthropic } from "./anthropic.js";
export { loginOpenAICodex, startOpenAICodexLogin, completeOpenAICodexLogin, refreshOpenAICodex } from "./openai-codex.js";
export { loginGeminiCli, startGeminiCliLogin, completeGeminiCliLogin, refreshGeminiCli } from "./google.js";
export {
  loginGitHubCopilot,
  startGitHubCopilotLogin,
  pollGitHubToken,
  exchangeCopilotToken,
  refreshGitHubCopilot,
} from "./github-copilot.js";
export { loadTokens, saveTokens, clearTokens, isExpired } from "./store.js";

/** 按 provider 分发刷新 */
export async function refreshOAuthToken(provider: OAuthProvider): Promise<OAuthTokens> {
  const tokens = loadTokens(provider);
  if (!tokens) throw new Error(`${provider} 尚未登录（无已保存令牌）`);
  switch (provider) {
    case "anthropic":
      return refreshAnthropic(tokens);
    case "openai-codex":
      return refreshOpenAICodex(tokens);
    case "google":
      return refreshGeminiCli(tokens);
    case "github-copilot":
      return refreshGitHubCopilot(tokens);
    default:
      throw new Error(`未知 OAuth provider: ${provider}`);
  }
}

/**
 * 取一个有效的 access token：已登录则返回；过期则自动刷新。
 * @throws 未登录时抛错
 */
export async function getOAuthApiKey(provider: OAuthProvider): Promise<string> {
  let tokens = loadTokens(provider);
  if (!tokens) throw new Error(`${provider} 尚未登录，请先调用对应 login*`);
  if (isExpired(tokens)) {
    try {
      tokens = await refreshOAuthToken(provider);
    } catch (err) {
      // copilot 即便没有 expiresAt 也可能需要续期；刷新失败则沿用旧 token 让上层报真实错误
      if (provider === "github-copilot") tokens = await refreshOAuthToken(provider);
      else throw err;
    }
  }
  return tokens.accessToken;
}

/** 是否已登录某 provider */
export function isLoggedIn(provider: OAuthProvider): boolean {
  return loadTokens(provider) != null;
}

/**
 * 把 OAuth 令牌注入一个 preset：填好 key + 打上 oauth 标记。
 * LLMClient 见到 preset.oauth=true 时会自动处理各厂商的认证头差异
 * （如 Anthropic：改用 Bearer + anthropic-beta，去掉 x-api-key）。
 */
export async function applyOAuthToPreset(
  preset: APIPreset,
  provider: OAuthProvider,
): Promise<APIPreset> {
  const key = await getOAuthApiKey(provider);
  return { ...preset, key, oauth: true };
}
