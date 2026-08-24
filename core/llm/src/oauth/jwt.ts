/**
 * 未校验的 JWT payload 读取（只用来取 exp / 账号字段，不作鉴权依据）。
 */

function decodeSegment(segment: string): Record<string, unknown> | null {
  try {
    const json = Buffer.from(segment, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  return decodeSegment(parts[1] ?? "");
}

export function jwtExpiryMs(token: string): number | undefined {
  const payload = decodeJwtPayload(token);
  const exp = payload?.exp;
  return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : undefined;
}
