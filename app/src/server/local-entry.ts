/**
 * 本机 loopback URL / 探测（测试用 TCP）
 *
 * 固定：http://127.0.0.1:8787
 */

export const MAOU_APP_BIND_HOST = "127.0.0.1";
export const MAOU_APP_DEFAULT_PORT = 8787;

/** @deprecated 别名 */
export const MAOU_APP_DEFAULT_HOST = MAOU_APP_BIND_HOST;
/** @deprecated 不再用域名入口 */
export const MAOU_APP_DOMAIN = "127.0.0.1";
export const MAOU_APP_HTTP_PORT = 80;
export const MAOU_APP_SOFT_PORT = 8787;

export function maouAppPublicUrl(
  port: number = MAOU_APP_DEFAULT_PORT,
  host: string = MAOU_APP_BIND_HOST,
): string {
  const h = (host || MAOU_APP_BIND_HOST).trim() || MAOU_APP_BIND_HOST;
  const p =
    Number.isFinite(port) && port > 0
      ? Math.floor(port)
      : MAOU_APP_DEFAULT_PORT;
  return `http://${h}:${p}`;
}

/** @deprecated */
export function maouAppUrl(
  hostOrPort?: string | number,
  port?: number,
): string {
  if (typeof hostOrPort === "number") return maouAppPublicUrl(hostOrPort);
  if (typeof port === "number") {
    return maouAppPublicUrl(port, String(hostOrPort || MAOU_APP_BIND_HOST));
  }
  return maouAppPublicUrl();
}

export function maouAppLoopbackUrl(
  port: number,
  bindHost: string = MAOU_APP_BIND_HOST,
): string {
  return maouAppPublicUrl(port, bindHost);
}

export function isPortlessPublicUrl(_port: number): boolean {
  return false;
}

export type HealthProbe = {
  ok: boolean;
  maou: boolean;
  status?: number;
  body?: { ok?: boolean; service?: string };
  error?: string;
};

export async function probeMaouApp(
  port: number,
  bindHost: string = MAOU_APP_BIND_HOST,
  timeoutMs = 900,
): Promise<HealthProbe> {
  const url = `${maouAppLoopbackUrl(port, bindHost)}/api/health`;
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await fetch(url, { signal: ac.signal });
      let body: { ok?: boolean; service?: string } | undefined;
      try {
        body = (await r.json()) as { ok?: boolean; service?: string };
      } catch {
        body = undefined;
      }
      const maou = Boolean(
        r.ok && body?.ok === true && body?.service === "maou-app",
      );
      return { ok: r.ok, maou, status: r.status, body };
    } finally {
      clearTimeout(t);
    }
  } catch (e) {
    return {
      ok: false,
      maou: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export type BindCheck = "free" | "in_use" | "need_privilege" | "error";

export function checkBind(
  port: number,
  host: string = MAOU_APP_BIND_HOST,
): Promise<BindCheck> {
  return new Promise((resolve) => {
    import("node:net").then(({ createServer }) => {
      const s = createServer();
      s.unref();
      s.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") resolve("in_use");
        else if (err.code === "EACCES") resolve("need_privilege");
        else resolve("error");
      });
      s.listen(port, host, () => {
        s.close((closeErr) => resolve(closeErr ? "error" : "free"));
      });
    });
  });
}

export function isPortFree(
  port: number,
  host: string = MAOU_APP_BIND_HOST,
): Promise<boolean> {
  return checkBind(port, host).then((c) => c === "free");
}

export function allocateFreePort(
  host: string = MAOU_APP_BIND_HOST,
): Promise<number> {
  return new Promise((resolve, reject) => {
    import("node:net").then(({ createServer }) => {
      const s = createServer();
      s.unref();
      s.once("error", reject);
      s.listen(0, host, () => {
        const addr = s.address();
        const p =
          typeof addr === "object" && addr && typeof addr.port === "number"
            ? addr.port
            : 0;
        s.close((err) => {
          if (err) reject(err);
          else if (p > 0) resolve(p);
          else reject(new Error("allocateFreePort: invalid port"));
        });
      });
    });
  });
}

export type ResolveListenPlan = {
  bindHost: string;
  port: number;
  publicUrl: string;
  reuseExisting: boolean;
  reason: string;
};

/** 简单计划：默认 127.0.0.1:8787；显式端口优先；已有 maou 则复用 */
export async function resolveListenPlan(opts?: {
  explicitPort?: number;
  bindHost?: string;
}): Promise<ResolveListenPlan> {
  const bindHost =
    (opts?.bindHost?.trim() || MAOU_APP_BIND_HOST) || MAOU_APP_BIND_HOST;
  const port =
    opts?.explicitPort != null &&
    Number.isFinite(opts.explicitPort) &&
    opts.explicitPort > 0
      ? Math.floor(opts.explicitPort)
      : MAOU_APP_DEFAULT_PORT;

  const probe = await probeMaouApp(port, bindHost);
  if (probe.maou) {
    return {
      bindHost,
      port,
      publicUrl: maouAppPublicUrl(port, bindHost),
      reuseExisting: true,
      reason: `existing maou-app on ${bindHost}:${port}`,
    };
  }
  if (probe.ok && !probe.maou) {
    throw new Error(
      `port ${port} is in use by another service (not maou-app). Use --port <other>.`,
    );
  }

  return {
    bindHost,
    port,
    publicUrl: maouAppPublicUrl(port, bindHost),
    reuseExisting: false,
    reason: `bind ${bindHost}:${port}`,
  };
}

export function hasBind80Privilege(): boolean {
  return false;
}

export function dropPrivilegesIfRoot(): { dropped: boolean; detail: string } {
  return { dropped: false, detail: "n/a" };
}

export function relaunchElevatedForPort80Sync(): {
  ok: boolean;
  status: number;
  mode: string;
} {
  return { ok: false, status: 1, mode: "disabled" };
}

export function resolveAppEndpointPath(): string {
  return "";
}

export function writeEndpointRecord(
  _port: number,
  _bindHost?: string,
): string {
  return "";
}

export function readEndpointRecord(): null {
  return null;
}
