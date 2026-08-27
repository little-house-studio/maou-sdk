import { request as httpRequest } from "node:http";
import type { IncomingHttpHeaders } from "node:http";
import { ipcMain, type WebContents } from "electron";

export type HttpStartReq = {
  id: string;
  path: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
};

const inflight = new Map<string, { abort: () => void }>();

function headerMap(headers: IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v == null) continue;
    out[k] = Array.isArray(v) ? v.join(", ") : v;
  }
  return out;
}

export function bindAppHttpIpc(socketPath: string): () => void {
  const start = (
    event: Electron.IpcMainInvokeEvent,
    req: HttpStartReq,
  ): Promise<{ status: number; statusText: string; headers: Record<string, string> }> => {
    const wc = event.sender;
    return new Promise((resolve, reject) => {
      let headSent = false;
      const httpReq = httpRequest(
        {
          socketPath,
          path: req.path,
          method: req.method || "GET",
          headers: {
            ...(req.headers ?? {}),
            host: "maou-app",
          },
        },
        (res) => {
          headSent = true;
          resolve({
            status: res.statusCode ?? 500,
            statusText: res.statusMessage ?? "",
            headers: headerMap(res.headers),
          });
          res.on("data", (chunk: Buffer) => {
            if (wc.isDestroyed()) return;
            wc.send(`app:http-chunk:${req.id}`, Uint8Array.from(chunk));
          });
          res.on("end", () => {
            inflight.delete(req.id);
            if (!wc.isDestroyed()) wc.send(`app:http-end:${req.id}`);
          });
          res.on("error", (err) => {
            inflight.delete(req.id);
            if (!wc.isDestroyed()) {
              wc.send(`app:http-error:${req.id}`, err.message);
            }
          });
        },
      );
      httpReq.on("error", (err) => {
        inflight.delete(req.id);
        if (!headSent) reject(err);
        else if (!wc.isDestroyed()) {
          wc.send(`app:http-error:${req.id}`, err.message);
        }
      });
      inflight.set(req.id, { abort: () => httpReq.destroy() });
      if (req.body) httpReq.write(req.body);
      httpReq.end();
    });
  };

  ipcMain.handle("app:http-start", start);
  const onAbort = (_e: Electron.IpcMainEvent, id: string) => {
    inflight.get(id)?.abort();
    inflight.delete(id);
  };
  ipcMain.on("app:http-abort", onAbort);

  return () => {
    ipcMain.removeHandler("app:http-start");
    ipcMain.removeListener("app:http-abort", onAbort);
    for (const job of inflight.values()) job.abort();
    inflight.clear();
  };
}

export function abortAllHttp(): void {
  for (const job of inflight.values()) job.abort();
  inflight.clear();
}

export type { WebContents };
