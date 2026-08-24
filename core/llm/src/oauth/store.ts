/**
 * OAuth 令牌存储
 *
 * 按 provider 分文件持久化到 ~/.maou/oauth/<provider>.json，写入用 temp+rename 原子替换。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, rmSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { jwtExpiryMs } from "./jwt.js";
import type { OAuthProvider, OAuthStatus, OAuthTokens } from "./types.js";
import { isOAuthProvider, OAUTH_PROVIDERS } from "./types.js";

/** 令牌存储目录（可用 MAOU_OAUTH_DIR 覆盖） */
export function oauthDir(): string {
  return process.env.MAOU_OAUTH_DIR ?? join(homedir(), ".maou", "oauth");
}

function fileFor(provider: OAuthProvider): string {
  return join(oauthDir(), `${provider}.json`);
}

/** 保存令牌（原子写，0600） */
export function saveTokens(tokens: OAuthTokens): void {
  const dir = oauthDir();
  mkdirSync(dir, { recursive: true });
  const target = fileFor(tokens.provider);
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(tokens, null, 2), { encoding: "utf-8", mode: 0o600 });
  renameSync(tmp, target);
}

/** 读取令牌（不存在或损坏返回 null） */
export function loadTokens(provider: OAuthProvider): OAuthTokens | null {
  const target = fileFor(provider);
  if (!existsSync(target)) return null;
  try {
    const parsed = JSON.parse(readFileSync(target, "utf-8")) as OAuthTokens;
    if (!parsed || typeof parsed.accessToken !== "string" || !parsed.accessToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 删除令牌（登出） */
export function clearTokens(provider: OAuthProvider): void {
  const target = fileFor(provider);
  try {
    rmSync(target, { force: true });
  } catch {
    // 忽略
  }
}

export function expiryMs(tokens: OAuthTokens): number | undefined {
  return tokens.expiresAt ?? jwtExpiryMs(tokens.accessToken);
}

function skewMsFor(tokens: OAuthTokens): number {
  // xai 设备码 JWT 较短，提前 5 分钟续，避免请求中途失效
  return tokens.provider === "xai" ? 300_000 : 60_000;
}

/** access token 是否已过期（含厂商提前量） */
export function isExpired(tokens: OAuthTokens, skewMs?: number): boolean {
  const exp = expiryMs(tokens);
  if (!exp) return tokens.provider === "github-copilot";
  return Date.now() > exp - (skewMs ?? skewMsFor(tokens));
}

export function listSavedProviders(): OAuthProvider[] {
  const dir = oauthDir();
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -".json".length))
      .filter(isOAuthProvider);
  } catch {
    return [];
  }
}

export function listOAuthStatus(): OAuthStatus[] {
  return OAUTH_PROVIDERS.map((provider) => {
    const tokens = loadTokens(provider);
    if (!tokens) return { provider, loggedIn: false, expired: false };
    return {
      provider,
      loggedIn: true,
      expired: isExpired(tokens),
      expiresAt: expiryMs(tokens),
    };
  });
}
