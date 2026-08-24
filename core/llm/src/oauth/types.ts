/**
 * 订阅 OAuth 通用类型
 *
 * 登录换票后由本模块落盘；调用方用 getOAuthApiKey / applyOAuthToPreset 取有效令牌。
 */

import type { APIProtocol } from "../adapters/types.js";

export const OAUTH_PROVIDERS = [
  "anthropic",
  "openai-codex",
  "github-copilot",
  "google",
  "xai",
] as const;

export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export type OAuthFlow = "browser" | "device" | "mixed";

export type OAuthLoginMethod = "browser" | "device";

/** 存储的 OAuth 令牌 */
export interface OAuthTokens {
  provider: OAuthProvider;
  /** 调用 LLM 时作为 Bearer 的 access token */
  accessToken: string;
  /** 刷新令牌（用于过期后续期；部分厂商每次刷新会轮换） */
  refreshToken?: string;
  /** access token 过期的 epoch 毫秒时间戳 */
  expiresAt?: number;
  /** 令牌类型（通常 "Bearer"） */
  tokenType?: string;
  /** 授权 scope */
  scope?: string;
  /** 厂商专属附加字段（长效 github token、id_token、accountId 等） */
  extra?: Record<string, unknown>;
}

/** 一次授权请求的上下文（start 阶段产出，complete 阶段需要） */
export interface AuthorizeRequest {
  /** 让用户在浏览器打开的授权 URL */
  url: string;
  /** CSRF state */
  state: string;
  /** PKCE code_verifier */
  codeVerifier: string;
  /** 回调地址 */
  redirectUri: string;
}

/** 设备码流程的启动结果 */
export interface DeviceCodeStart {
  /** 让用户访问的验证地址 */
  verificationUri: string;
  /** 预填 user_code 的完整地址（若厂商返回） */
  verificationUriComplete?: string;
  /** 让用户输入的验证码 */
  userCode: string;
  /** 设备码（轮询用，内部使用） */
  deviceCode: string;
  /** 轮询间隔（秒） */
  interval: number;
  /** 过期时间（秒） */
  expiresIn: number;
}

export interface OAuthPrompt {
  message: string;
  placeholder?: string;
}

export interface OAuthSelectOption {
  id: string;
  label: string;
}

/**
 * 交互式登录回调。LLM 层不弹 UI：由 CLI / setup 注入。
 * 不提供 onPrompt 时只等本机回调或设备码轮询。
 */
export interface OAuthLoginInteraction {
  signal?: AbortSignal;
  /** 指定 mixed 厂商走浏览器或设备码；缺省时 browser */
  method?: OAuthLoginMethod;
  /** 拿到授权 URL 或设备码时调用（用于打印 / 打开浏览器） */
  onAuth?: (info: {
    url?: string;
    instructions?: string;
    verificationUri?: string;
    userCode?: string;
    expiresIn?: number;
  }) => void;
  /** 粘贴授权码或完整回调 URL */
  onPrompt?: (prompt: OAuthPrompt) => Promise<string>;
  /** mixed 厂商选登录方式 */
  onSelect?: (prompt: { message: string; options: OAuthSelectOption[] }) => Promise<string>;
  onProgress?: (message: string) => void;
  /** 是否尝试用系统浏览器打开 URL（默认 false） */
  openBrowser?: boolean;
}

export interface OAuthProviderInfo {
  id: OAuthProvider;
  /** 登录流程类型 */
  flow: OAuthFlow;
  protocol: APIProtocol;
  url: string;
  model: string;
  extraHeaders?: Record<string, string>;
}

export interface OAuthStatus {
  provider: OAuthProvider;
  loggedIn: boolean;
  expired: boolean;
  expiresAt?: number;
}

export function isOAuthProvider(value: unknown): value is OAuthProvider {
  return typeof value === "string" && (OAUTH_PROVIDERS as readonly string[]).includes(value);
}
