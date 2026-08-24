import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyAuthOverrides } from "../auth-overrides.js";
import {
  applyOAuthToPreset,
  completeAnthropicLogin,
  extractCode,
  getOAuthApiKey,
  inferOAuthProvider,
  isExpired,
  listOAuthProviderInfo,
  listOAuthStatus,
  loadTokens,
  logoutOAuth,
  parseAuthorizationInput,
  pollXaiToken,
  refreshOAuthToken,
  resolveOAuthPreset,
  saveTokens,
  startAnthropicLogin,
  startGeminiCliLogin,
  startOpenAICodexLogin,
  startXaiLogin,
} from "./index.js";
import { pollOAuthDeviceCodeFlow } from "./device-code.js";
import { jwtExpiryMs } from "./jwt.js";
import type { OAuthTokens } from "./types.js";

const origFetch = globalThis.fetch;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "maou-oauth-"));
  process.env.MAOU_OAUTH_DIR = dir;
});

afterEach(() => {
  globalThis.fetch = origFetch;
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MAOU_OAUTH_DIR;
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("parseAuthorizationInput", () => {
  it("解析完整回调 URL / code#state / 裸 code", () => {
    expect(parseAuthorizationInput("https://x.test/cb?code=abc&state=s1")).toEqual({
      code: "abc",
      state: "s1",
    });
    expect(parseAuthorizationInput("tok#st")).toEqual({ code: "tok", state: "st" });
    expect(extractCode("https://x.test/cb?code=zz")).toBe("zz");
    expect(extractCode("bare")).toBe("bare");
  });
});

describe("catalog / infer", () => {
  it("列出五家内置厂商", () => {
    expect(listOAuthProviderInfo().map((p) => p.id)).toEqual([
      "anthropic",
      "openai-codex",
      "github-copilot",
      "google",
      "xai",
    ]);
  });

  it("从 protocol / url 推断 provider", () => {
    expect(inferOAuthProvider({ protocol: "anthropic", url: "https://api.anthropic.com" })).toBe("anthropic");
    expect(inferOAuthProvider({ protocol: "openai-codex", url: "https://example.com" })).toBe("openai-codex");
    expect(
      inferOAuthProvider({ protocol: "responses", url: "https://cli-chat-proxy.grok.com/v1/responses" }),
    ).toBe("xai");
    expect(inferOAuthProvider({ protocol: "openai", url: "https://api.openai.com" })).toBeNull();
  });
});

describe("store + status", () => {
  it("读写登出与过期判断", () => {
    const tokens: OAuthTokens = {
      provider: "anthropic",
      accessToken: "a",
      expiresAt: Date.now() - 1000,
    };
    saveTokens(tokens);
    expect(loadTokens("anthropic")?.accessToken).toBe("a");
    expect(isExpired(loadTokens("anthropic")!)).toBe(true);
    expect(listOAuthStatus().find((s) => s.provider === "anthropic")).toMatchObject({
      loggedIn: true,
      expired: true,
    });
    logoutOAuth("anthropic");
    expect(loadTokens("anthropic")).toBeNull();
  });

  it("无 expiresAt 时读 JWT exp", () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const payload = Buffer.from(JSON.stringify({ exp }), "utf8").toString("base64url");
    const jwt = `x.${payload}.y`;
    expect(jwtExpiryMs(jwt)).toBe(exp * 1000);
    expect(isExpired({ provider: "xai", accessToken: jwt, expiresAt: undefined })).toBe(false);
  });
});

describe("start* 授权 URL", () => {
  it("anthropic / openai-codex / google 带 PKCE", () => {
    const a = startAnthropicLogin();
    expect(a.url).toContain("client_id=9d1c250a");
    expect(a.url).toContain("code_challenge=");
    expect(a.redirectUri).toContain("console.anthropic.com");

    const c = startOpenAICodexLogin();
    expect(c.url).toContain("client_id=app_EMoamEEZ73f0CkXaXp7hrann");
    expect(c.url).toContain("originator=maou");
    expect(c.redirectUri).toContain("localhost:1455");

    const g = startGeminiCliLogin();
    expect(g.url).toContain("accounts.google.com");
    expect(g.url).toContain("code_challenge_method=S256");
  });
});

describe("换票 / 刷新 / 注入", () => {
  it("completeAnthropicLogin 落盘并 applyOAuthToPreset", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(200, {
        access_token: "atk",
        refresh_token: "rtk",
        expires_in: 3600,
        token_type: "Bearer",
      }),
    ) as typeof fetch;

    const req = startAnthropicLogin();
    const tokens = await completeAnthropicLogin("the-code#st", req);
    expect(tokens.accessToken).toBe("atk");
    expect(loadTokens("anthropic")?.refreshToken).toBe("rtk");

    const preset = await applyOAuthToPreset({ model: "", url: "" } as { model: string; url: string }, "anthropic");
    expect(preset.key).toBe("atk");
    expect(preset.oauth).toBe(true);
    expect(preset.oauthProvider).toBe("anthropic");
    expect(preset.protocol).toBe("anthropic");
    expect(preset.url).toContain("api.anthropic.com");
  });

  it("过期后 refreshOAuthToken 单飞", async () => {
    saveTokens({
      provider: "anthropic",
      accessToken: "old",
      refreshToken: "rtk",
      expiresAt: Date.now() - 10,
    });
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      return jsonResponse(200, { access_token: "new", refresh_token: "rtk2", expires_in: 3600 });
    }) as typeof fetch;

    const [a, b] = await Promise.all([refreshOAuthToken("anthropic"), refreshOAuthToken("anthropic")]);
    expect(a.accessToken).toBe("new");
    expect(b.accessToken).toBe("new");
    expect(calls).toBe(1);
    expect(await getOAuthApiKey("anthropic")).toBe("new");
  });

  it("resolveOAuthPreset 未登录但已有 key 时不抛", async () => {
    const out = await resolveOAuthPreset({
      model: "claude-sonnet-4-5",
      url: "https://api.anthropic.com",
      protocol: "anthropic",
      key: "sk-manual",
      oauth: true,
    });
    expect(out.key).toBe("sk-manual");
    expect(out.oauthProvider).toBe("anthropic");
  });
});

describe("xai 设备码", () => {
  it("申请设备码后轮询换票并落盘", async () => {
    let step = 0;
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("/device/code")) {
        return jsonResponse(200, {
          device_code: "dev",
          user_code: "ABCD-EFGH",
          verification_uri: "https://auth.x.ai/device",
          expires_in: 60,
          interval: 0.01,
        });
      }
      step += 1;
      if (step === 1) {
        return jsonResponse(400, { error: "authorization_pending" });
      }
      return jsonResponse(200, {
        access_token: "x-access",
        refresh_token: "x-refresh",
        expires_in: 3600,
      });
    }) as typeof fetch;

    const start = await startXaiLogin();
    expect(start.userCode).toBe("ABCD-EFGH");
    const tokens = await pollXaiToken(start);
    expect(tokens.accessToken).toBe("x-access");
    expect(loadTokens("xai")?.refreshToken).toBe("x-refresh");
  });
});

describe("设备码轮询", () => {
  it("pending → complete，slow_down 拉长间隔", async () => {
    let n = 0;
    const value = await pollOAuthDeviceCodeFlow({
      intervalSeconds: 0.01,
      expiresInSeconds: 5,
      poll: async () => {
        n += 1;
        if (n === 1) return { status: "pending" as const };
        if (n === 2) return { status: "slow_down" as const, intervalSeconds: 0.01 };
        return { status: "complete" as const, value: "ok" };
      },
    });
    expect(value).toBe("ok");
    expect(n).toBe(3);
  });
});

describe("applyAuthOverrides", () => {
  it("anthropic oauth 改 Bearer + beta", () => {
    const headers = applyAuthOverrides(
      { "x-api-key": "sk", "Content-Type": "application/json" },
      { model: "m", url: "https://api.anthropic.com", key: "tok", oauth: true, protocol: "anthropic" },
      "anthropic",
    );
    expect(headers["x-api-key"]).toBeUndefined();
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers["anthropic-beta"]).toContain("oauth-2025-04-20");
  });

  it("xai 订阅口补身份头", () => {
    const headers = applyAuthOverrides(
      { Authorization: "Bearer t" },
      {
        model: "grok-4",
        url: "https://cli-chat-proxy.grok.com/v1/responses",
        key: "t",
        oauth: true,
        oauthProvider: "xai",
      },
      "responses",
    );
    expect(headers["x-xai-token-auth"]).toBe("xai-grok-cli");
    expect(headers["x-grok-client-identifier"]).toBe("grok-shell");
  });
});
