/**
 * 本机 loopback 回调：接 authorization code，或端口被占用时退回粘贴。
 */

import { createServer, type Server } from "node:http";
import { oauthErrorHtml, oauthSuccessHtml } from "./page.js";

export type CallbackResult = { code: string; state?: string };

export type CallbackServer = {
  redirectUri: string;
  waitForCode: () => Promise<CallbackResult | null>;
  cancelWait: () => void;
  close: () => void;
};

export function callbackHost(): string {
  return process.env.MAOU_OAUTH_CALLBACK_HOST?.trim() || "127.0.0.1";
}

export async function startCallbackServer(opts: {
  port: number;
  path: string;
  expectedState?: string;
  successMessage?: string;
}): Promise<CallbackServer> {
  const host = callbackHost();
  const redirectUri = `http://localhost:${opts.port}${opts.path}`;

  let settleWait: ((value: CallbackResult | null) => void) | undefined;
  let settled = false;
  const waitForCodePromise = new Promise<CallbackResult | null>((resolve) => {
    settleWait = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
  });

  const finish = (value: CallbackResult | null) => settleWait?.(value);

  return new Promise((resolve) => {
    const server: Server = createServer((req, res) => {
      try {
        const url = new URL(req.url || "", "http://localhost");
        if (url.pathname !== opts.path) {
          res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
          res.end(oauthErrorHtml("回调路径不匹配。"));
          return;
        }
        const error = url.searchParams.get("error");
        if (error) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(oauthErrorHtml("授权未完成。", `error=${error}`));
          finish(null);
          return;
        }
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state") ?? undefined;
        if (!code) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(oauthErrorHtml("缺少 authorization code。"));
          return;
        }
        if (opts.expectedState && state && state !== opts.expectedState) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(oauthErrorHtml("state 不匹配。"));
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(oauthSuccessHtml(opts.successMessage));
        finish({ code, state });
      } catch {
        res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
        res.end(oauthErrorHtml("处理回调时出错。"));
      }
    });

    server.on("error", () => {
      finish(null);
      resolve({
        redirectUri,
        waitForCode: async () => null,
        cancelWait: () => {},
        close: () => {
          try {
            server.close();
          } catch {
            // ignore
          }
        },
      });
    });

    server.listen(opts.port, host, () => {
      resolve({
        redirectUri,
        waitForCode: () => waitForCodePromise,
        cancelWait: () => finish(null),
        close: () => {
          finish(null);
          server.close();
        },
      });
    });
  });
}

/** 本机回调与粘贴码赛跑，谁先到用谁 */
export async function raceCodeFromCallback(opts: {
  server: CallbackServer;
  expectedState: string;
  signal?: AbortSignal;
  onPrompt?: (prompt: { message: string; placeholder?: string }) => Promise<string>;
  parse: (input: string) => { code?: string; state?: string };
}): Promise<string> {
  const onAbort = () => opts.server.cancelWait();
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  if (opts.signal?.aborted) onAbort();

  let manual: string | undefined;
  let manualError: Error | undefined;
  const prompt = opts.onPrompt;
  const manualPromise = prompt
    ? prompt({
        message: "在浏览器完成登录，或把授权码 / 完整回调 URL 粘贴到这里：",
        placeholder: opts.server.redirectUri,
      })
        .then((input) => {
          manual = input;
          opts.server.cancelWait();
        })
        .catch((err: unknown) => {
          manualError = err instanceof Error ? err : new Error(String(err));
          opts.server.cancelWait();
        })
    : Promise.resolve();

  try {
    const result = await opts.server.waitForCode();
    if (manualError) throw manualError;
    if (result?.code) return result.code;
    if (manual) {
      const parsed = opts.parse(manual);
      if (parsed.state && parsed.state !== opts.expectedState) {
        throw new Error("OAuth state 不匹配");
      }
      if (parsed.code) return parsed.code;
    }
    await manualPromise;
    if (manualError) throw manualError;
    if (manual) {
      const parsed = opts.parse(manual);
      if (parsed.state && parsed.state !== opts.expectedState) {
        throw new Error("OAuth state 不匹配");
      }
      if (parsed.code) return parsed.code;
    }
    throw new Error("未拿到 authorization code（本机回调未命中，也没有粘贴码）");
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
  }
}
