/**
 * 从粘贴串 / 回调 URL 里抽出 authorization code 与 state。
 */

export interface ParsedAuthorizationInput {
  code?: string;
  state?: string;
}

export function parseAuthorizationInput(input: string): ParsedAuthorizationInput {
  const value = input.trim();
  if (!value) return {};
  try {
    const url = new URL(value);
    return {
      code: url.searchParams.get("code") ?? undefined,
      state: url.searchParams.get("state") ?? undefined,
    };
  } catch {
    // 不是完整 URL
  }
  if (value.includes("#")) {
    const [code, state] = value.split("#", 2);
    return { code, state };
  }
  if (value.includes("code=")) {
    const params = new URLSearchParams(value.startsWith("?") ? value.slice(1) : value);
    return {
      code: params.get("code") ?? undefined,
      state: params.get("state") ?? undefined,
    };
  }
  return { code: value };
}

/** 只要 code（兼容旧 complete* 入参） */
export function extractCode(input: string): string {
  return parseAuthorizationInput(input).code ?? input.trim();
}

/** 设备码验证地址只接受 http(s)，避免被诱导打开其它协议 */
export function assertHttpUrl(raw: string, label = "verification_uri"): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`不可信的 ${label}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`不可信的 ${label}`);
  }
  return url.href;
}

export function assertHttpsUrl(raw: string, label = "verification_uri"): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`不可信的 ${label}`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`不可信的 ${label}`);
  }
  return url.href;
}
