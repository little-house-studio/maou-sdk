/**
 * PKCE（Proof Key for Code Exchange）辅助
 *
 * 所有 OAuth Authorization Code 流程共用：生成 code_verifier / code_challenge / state。
 */

import { randomBytes, createHash } from "node:crypto";

/** base64url 编码（去掉 padding 与 +/ 替换） */
export function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 生成 PKCE code_verifier（43~128 字符） */
export function generateCodeVerifier(): string {
  return base64url(randomBytes(32));
}

/** 由 code_verifier 计算 S256 code_challenge */
export function codeChallengeS256(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

/** 生成随机 state */
export function randomState(): string {
  return base64url(randomBytes(16));
}
