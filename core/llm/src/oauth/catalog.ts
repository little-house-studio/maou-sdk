/**
 * 内置订阅登录厂商：默认协议 / 推理入口 / 模型。
 * applyOAuthToPreset 在调用方没写 url/protocol 时补这些默认值。
 */

import { normalizeApiProtocol } from "../adapters/protocol-utils.js";
import type { APIPreset } from "../adapters/types.js";
import type { OAuthProvider, OAuthProviderInfo } from "./types.js";
import { isOAuthProvider, OAUTH_PROVIDERS } from "./types.js";

export const OAUTH_CATALOG: Record<OAuthProvider, OAuthProviderInfo> = {
  anthropic: {
    id: "anthropic",
    flow: "browser",
    protocol: "anthropic",
    url: "https://api.anthropic.com/v1/messages",
    model: "claude-sonnet-4-5",
  },
  "openai-codex": {
    id: "openai-codex",
    flow: "mixed",
    protocol: "openai-codex",
    url: "https://chatgpt.com/backend-api/codex/responses",
    model: "gpt-5.1",
  },
  "github-copilot": {
    id: "github-copilot",
    flow: "device",
    protocol: "github-copilot",
    url: "https://api.githubcopilot.com/chat/completions",
    model: "gpt-4.1",
  },
  google: {
    id: "google",
    flow: "browser",
    protocol: "google",
    url: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-2.5-pro",
  },
  xai: {
    id: "xai",
    flow: "device",
    protocol: "responses",
    url: "https://cli-chat-proxy.grok.com/v1/responses",
    model: "grok-4",
    extraHeaders: {
      "x-xai-token-auth": "xai-grok-cli",
      "x-grok-client-identifier": "grok-shell",
      "x-grok-client-version": "0.2.93",
    },
  },
};

export function getOAuthProviderInfo(id: OAuthProvider): OAuthProviderInfo {
  return OAUTH_CATALOG[id];
}

export function listOAuthProviderInfo(): OAuthProviderInfo[] {
  return OAUTH_PROVIDERS.map((id) => OAUTH_CATALOG[id]);
}

function hostOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/** 从 preset.oauthProvider / protocol / url 推断登录厂商 */
export function inferOAuthProvider(
  preset: Pick<APIPreset, "protocol" | "url"> & { oauthProvider?: unknown },
): OAuthProvider | null {
  if (isOAuthProvider(preset.oauthProvider)) return preset.oauthProvider;
  const proto = normalizeApiProtocol(preset.protocol);
  if (proto === "anthropic") return "anthropic";
  if (proto === "openai-codex") return "openai-codex";
  if (proto === "github-copilot") return "github-copilot";
  if (proto === "google" || proto === "google-vertex") return "google";

  const host = hostOf(preset.url);
  if (host.includes("chatgpt.com") || host.includes("auth.openai.com")) return "openai-codex";
  if (host.includes("grok.com") || host.endsWith(".x.ai")) return "xai";
  if (host.includes("githubcopilot.com")) return "github-copilot";
  if (host.includes("generativelanguage.googleapis.com") || host.includes("cloudcode-pa.googleapis.com")) {
    return "google";
  }
  if (host.includes("api.anthropic.com") || host.includes("anthropic.com") || host.includes("claude.ai")) {
    return "anthropic";
  }
  if (proto === "responses" && host.includes("openai.com")) return "openai-codex";
  return null;
}
