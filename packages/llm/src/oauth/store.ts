/**
 * OAuth 令牌存储
 *
 * 按 provider 分文件持久化到 ~/.maou/oauth/<provider>.json，写入用 temp+rename 原子替换
 * （对齐项目 SessionStore/AgentRegistry 约定）。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { OAuthProvider, OAuthTokens } from "./types.js";

/** 令牌存储目录（可用 MAOU_OAUTH_DIR 覆盖） */
function oauthDir(): string {
  return process.env.MAOU_OAUTH_DIR ?? join(homedir(), ".maou", "oauth");
}

function fileFor(provider: OAuthProvider): string {
  return join(oauthDir(), `${provider}.json`);
}

/** 保存令牌（原子写） */
export function saveTokens(tokens: OAuthTokens): void {
  const dir = oauthDir();
  mkdirSync(dir, { recursive: true });
  const target = fileFor(tokens.provider);
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(tokens, null, 2), { encoding: "utf-8", mode: 0o600 });
  renameSync(tmp, target);
}

/** 读取令牌（不存在返回 null） */
export function loadTokens(provider: OAuthProvider): OAuthTokens | null {
  const target = fileFor(provider);
  if (!existsSync(target)) return null;
  try {
    return JSON.parse(readFileSync(target, "utf-8")) as OAuthTokens;
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

/** access token 是否已过期（含 60s 提前量） */
export function isExpired(tokens: OAuthTokens, skewMs = 60_000): boolean {
  if (!tokens.expiresAt) return false;
  return Date.now() > tokens.expiresAt - skewMs;
}
