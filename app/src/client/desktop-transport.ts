export type DesktopHttpStart = {
  id: string;
  path: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
};

export type DesktopAppBridge = {
  kind: "desktop";
  platform?: "darwin" | "win32" | "linux";
  httpStart: (
    req: DesktopHttpStart,
  ) => Promise<{ status: number; statusText: string; headers: Record<string, string> }>;
  httpAbort: (id: string) => void;
  onHttpChunk: (id: string, cb: (chunk: Uint8Array) => void) => () => void;
  onHttpEnd: (id: string, cb: () => void) => () => void;
  onHttpError: (id: string, cb: (message: string) => void) => () => void;
  wsOpen: (id: string, url: string) => void;
  wsSend: (id: string, data: string) => void;
  wsClose: (id: string) => void;
  onWsMessage: (id: string, cb: (data: string) => void) => () => void;
};

declare global {
  interface Window {
    maouApp?: DesktopAppBridge;
  }
}

/** Path+query for an /api call; null if the request should stay on the page origin. */
export function desktopApiPath(input: RequestInfo | URL): string | null {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  const u = new URL(raw, "http://maou.local");
  if (u.pathname === "/api" || u.pathname.startsWith("/api/")) {
    return `${u.pathname}${u.search}`;
  }
  return null;
}

export function desktopWsPath(url: string): string | null {
  try {
    const u = new URL(url, "http://maou.local");
    if (u.pathname.startsWith("/ws/")) return `${u.pathname}${u.search}`;
  } catch {
    if (url.includes("/ws/")) return url;
  }
  return null;
}

function headerRecord(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...headers };
}

async function bodyText(body: BodyInit | null | undefined): Promise<string | undefined> {
  if (body == null) return undefined;
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof Blob) return body.text();
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
  if (ArrayBuffer.isView(body)) {
    return new TextDecoder().decode(body as ArrayBufferView);
  }
  return String(body);
}

export function installDesktopTransport(bridge = window.maouApp): boolean {
  if (!bridge) return false;
  const host = bridge;

  const origFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const path = desktopApiPath(input);
    if (!path) return origFetch(input, init);
    const id = crypto.randomUUID();
    const method =
      init?.method ||
      (typeof input === "object" && "method" in input ? input.method : "GET") ||
      "GET";
    const headers = headerRecord(init?.headers);
    const ac = new AbortController();
    init?.signal?.addEventListener("abort", () => {
      host.httpAbort(id);
      ac.abort();
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const offChunk = host.onHttpChunk(id, (chunk) => {
          controller.enqueue(chunk);
        });
        const offEnd = host.onHttpEnd(id, () => {
          offChunk();
          offEnd();
          offErr();
          controller.close();
        });
        const offErr = host.onHttpError(id, (message) => {
          offChunk();
          offEnd();
          offErr();
          controller.error(new Error(message));
        });
      },
      cancel() {
        host.httpAbort(id);
      },
    });
    return bodyText(init?.body).then((body) =>
      host.httpStart({ id, path, method, headers, body }).then(
        (head) =>
          new Response(stream, {
            status: head.status,
            statusText: head.statusText,
            headers: head.headers,
          }),
      ),
    );
  };

  const OrigWS = window.WebSocket;
  class IpcWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSING = 2;
    readonly CLOSED = 3;
    readyState = IpcWebSocket.CONNECTING;
    onopen: ((ev: Event) => void) | null = null;
    onmessage: ((ev: MessageEvent<string>) => void) | null = null;
    onclose: ((ev: CloseEvent) => void) | null = null;
    onerror: ((ev: Event) => void) | null = null;
    readonly url: string;
    private id = crypto.randomUUID();
    private pending: string[] = [];
    private offMsg: (() => void) | null = null;

    constructor(url: string | URL) {
      this.url = String(url);
      this.offMsg = host.onWsMessage(this.id, (data) => {
        const ev = new MessageEvent("message", { data });
        if (this.onmessage) this.onmessage(ev);
        else this.pending.push(data);
      });
      queueMicrotask(() => {
        if (this.readyState === IpcWebSocket.CLOSED) return;
        host.wsOpen(this.id, this.url);
        this.readyState = IpcWebSocket.OPEN;
        this.onopen?.(new Event("open"));
        if (this.onmessage) {
          for (const data of this.pending) {
            this.onmessage(new MessageEvent("message", { data }));
          }
          this.pending = [];
        }
      });
    }

    send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
      host.wsSend(this.id, String(data));
    }

    close() {
      if (this.readyState === IpcWebSocket.CLOSED) return;
      this.readyState = IpcWebSocket.CLOSED;
      this.offMsg?.();
      this.offMsg = null;
      host.wsClose(this.id);
      this.onclose?.(new CloseEvent("close"));
    }

    addEventListener() {}
    removeEventListener() {}
    dispatchEvent() {
      return false;
    }
  }

  window.WebSocket = IpcWebSocket as unknown as typeof WebSocket;
  void OrigWS;
  return true;
}
