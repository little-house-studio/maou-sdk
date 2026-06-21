/**
 * WebSocket 传输
 *
 * 对标 pi-ai 的 transport: websocket / websocket-cached。
 * 实现方式：把一个 WebSocket 适配成"返回 SSE 响应的 fetch"，从而无需改动 LLMClient
 * 既有的 SSE 解析逻辑——直接通过 `new LLMClient({ fetchImpl: createWebSocketFetch(...) })`
 * 注入即可。
 *
 * 约定（可通过 options 覆盖）：
 *   - 连接后把 HTTP body 原样写入 WS；
 *   - 每条 WS 消息视为一个事件 JSON，包装成 `data: <json>\n\n` 帧交给 SSE 解析器；
 *   - 收到 "[DONE]" 或连接关闭即结束流。
 *
 * 需要一个能说这套约定的 WS 服务端；浏览器用内置 WebSocket，Node<22 回退到 `ws` 包。
 */

/** 结构化最小 WebSocket 接口（兼容浏览器 WebSocket 与 ws 包） */
interface MinimalWebSocket {
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (ev: { data?: unknown; message?: unknown }) => void): void;
  readyState: number;
}
type WebSocketCtor = new (url: string, protocols?: string | string[]) => MinimalWebSocket;

export interface WebSocketFetchOptions {
  /** WS 端点；缺省时由请求 URL 推导（http→ws, https→wss） */
  url?: string;
  /** 复用单条连接（websocket-cached）：顺序调用间不重连 */
  cached?: boolean;
  /** 子协议 */
  protocols?: string | string[];
  /** 自定义 WebSocket 实现（默认 globalThis.WebSocket，Node<22 回退 ws 包） */
  WebSocketImpl?: WebSocketCtor;
  /** 把一条 WS 消息转成 0..n 个 SSE data 帧文本（默认：原样一帧） */
  toFrames?: (message: string) => string[];
  /** 判断一条消息是否表示流结束（默认 message.trim() === "[DONE]"） */
  isDone?: (message: string) => boolean;
  /** 发送前把 HTTP body 编码为要写入 WS 的文本（默认原样） */
  encodeRequest?: (body: string) => string;
}

function deriveWsUrl(httpUrl: string): string {
  return httpUrl.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
}

async function resolveWebSocketCtor(opts: WebSocketFetchOptions): Promise<WebSocketCtor> {
  if (opts.WebSocketImpl) return opts.WebSocketImpl;
  const g = globalThis as Record<string, unknown>;
  if (typeof g.WebSocket !== "undefined") return g.WebSocket as WebSocketCtor;
  // Node < 22：回退到 ws 包（需自行安装）。用非字面量 specifier 避免静态类型解析。
  const wsModule = "ws";
  const ws = (await import(wsModule)) as { WebSocket?: WebSocketCtor; default?: WebSocketCtor };
  const ctor = ws.WebSocket ?? ws.default;
  if (!ctor) throw new Error("无可用 WebSocket 实现（请在 Node<22 安装 ws 包，或传入 WebSocketImpl）");
  return ctor;
}

function messageToString(data: unknown): string {
  if (typeof data === "string") return data;
  if (data instanceof Uint8Array) return new TextDecoder().decode(data);
  if (data && typeof (data as { toString?: unknown }).toString === "function") return String(data);
  return "";
}

/**
 * 构造一个把 WebSocket 适配为 SSE 响应的 fetch。
 * 直接传给 `new LLMClient({ fetchImpl })`。
 */
export function createWebSocketFetch(options: WebSocketFetchOptions = {}): typeof fetch {
  const toFrames = options.toFrames ?? ((m: string) => [m]);
  const isDone = options.isDone ?? ((m: string) => m.trim() === "[DONE]");
  const encodeRequest = options.encodeRequest ?? ((b: string) => b);

  let cachedSocket: MinimalWebSocket | null = null;

  const wsFetch = async (input: unknown, init?: { body?: unknown }): Promise<Response> => {
    const httpUrl = typeof input === "string" ? input : String((input as { url?: string })?.url ?? "");
    const wsUrl = options.url ?? deriveWsUrl(httpUrl);
    const body = typeof init?.body === "string" ? init.body : String(init?.body ?? "");

    const Ctor = await resolveWebSocketCtor(options);

    // 取得（或复用）socket
    const socket: MinimalWebSocket =
      options.cached && cachedSocket && cachedSocket.readyState === 1
        ? cachedSocket
        : new Ctor(wsUrl, options.protocols);
    if (options.cached) cachedSocket = socket;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        let closed = false;
        const finish = () => {
          if (closed) return;
          closed = true;
          try { controller.close(); } catch { /* already closed */ }
          if (!options.cached) { try { socket.close(); } catch { /* ignore */ } }
        };

        socket.addEventListener("message", (ev) => {
          const text = messageToString(ev.data ?? ev.message);
          if (!text) return;
          if (isDone(text)) { finish(); return; }
          for (const frame of toFrames(text)) {
            controller.enqueue(encoder.encode(`data: ${frame}\n\n`));
          }
        });
        socket.addEventListener("error", (ev) => {
          if (!closed) {
            closed = true;
            try { controller.error(new Error(`WebSocket 传输错误: ${messageToString((ev as { message?: unknown }).message)}`)); } catch { /* ignore */ }
          }
        });
        socket.addEventListener("close", () => finish());

        const sendBody = () => {
          try { socket.send(encodeRequest(body)); } catch (e) { controller.error(e); }
        };
        if (socket.readyState === 1) sendBody();
        else socket.addEventListener("open", sendBody);
      },
    });

    return new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  };

  return wsFetch as unknown as typeof fetch;
}
