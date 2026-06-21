/**
 * OAuth 通用类型
 *
 * 对标 pi-ai：支持用订阅账号（Claude Pro/Max、ChatGPT Plus/Pro、GitHub Copilot、
 * Gemini CLI）登录换取 token，免按量付费 API key。
 */

/** 支持 OAuth 的 provider */
export type OAuthProvider = "anthropic" | "openai-codex" | "github-copilot" | "google";

/** 存储的 OAuth 令牌 */
export interface OAuthTokens {
  provider: OAuthProvider;
  /** 调用 LLM 时作为 Bearer 的 access token */
  accessToken: string;
  /** 刷新令牌（用于过期后续期） */
  refreshToken?: string;
  /** access token 过期的 epoch 毫秒时间戳 */
  expiresAt?: number;
  /** 令牌类型（通常 "Bearer"） */
  tokenType?: string;
  /** 授权 scope */
  scope?: string;
  /** provider 专属附加字段（如 copilot 的长效 github token、id_token 等） */
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

/** 设备码流程（GitHub Copilot）的启动结果 */
export interface DeviceCodeStart {
  /** 让用户访问的验证地址 */
  verificationUri: string;
  /** 让用户输入的验证码 */
  userCode: string;
  /** 设备码（轮询用，内部使用） */
  deviceCode: string;
  /** 轮询间隔（秒） */
  interval: number;
  /** 过期时间（秒） */
  expiresIn: number;
}
