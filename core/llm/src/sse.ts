/**
 * streamToSSE —— 把 LLM 流式事件桥接成 SSE（Server-Sent Events）输出，推给浏览器
 *
 * 解决"流式结果推前端"——这是把 LLM 流接到 Web 前端的标准做法。
 * SDK 提供"桥接器"（StreamEvent → SSE 文本帧），具体 HTTP 服务端由你用 Express/Fastify/Hono。
 *
 * 边界：SDK 只做"事件→SSE 帧"的格式化（紧耦合我们的事件类型，每个推流场景都重复造）；
 *      HTTP 服务端（res 写头/长连接管理）是通用 Web 活，归你的 Web 框架。
 *
 * @example Express:
 *   app.get("/chat", async (req, res) => {
 *     res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
 *     for await (const frame of streamToSSE(stream(model, ctx, { signal: req }))) {
 *       res.write(frame);
 *     }
 *     res.end();
 *   });
 */

import type { StreamEvent } from "./stream.js";

export interface SSEOptions {
  /** 心跳间隔 ms（定期发注释帧保活，默认 15000，0=关闭） */
  heartbeatMs?: number;
  /** 事件名映射（默认按 StreamEvent.type）；可自定义前端监听的 event 名 */
  eventName?: (ev: StreamEvent) => string;
  /** 每帧末尾是否加 \n\n（SSE 标准要求，默认 true） */
  withDelimiter?: boolean;
}

/**
 * 把一个 StreamEvent 编码成一条 SSE 帧（`event: X\ndata: {...}\n\n`）。
 */
export function encodeSSEFrame(ev: StreamEvent, opts: SSEOptions = {}): string {
  const eventName = opts.eventName ? opts.eventName(ev) : ev.type;
  const data = JSON.stringify(ev);
  const delim = opts.withDelimiter === false ? "" : "\n\n";
  if (eventName === "message") return `data: ${data}${delim}`;
  return `event: ${eventName}\ndata: ${data}${delim}`;
}

/**
 * 把 LLM 流（stream() 返回的 StreamResult）转成 SSE 帧的 async generator。
 * 可直接 pipe 到 HTTP response（res.write）。
 *
 * @param source stream() 返回的 StreamResult（async iterable）
 * @param opts SSE 选项（心跳/事件名）
 */
export async function* streamToSSE(
  source: AsyncIterable<StreamEvent>,
  opts: SSEOptions = {},
): AsyncGenerator<string, void, unknown> {
  const heartbeatMs = opts.heartbeatMs ?? 15_000;
  const heartbeat = heartbeatMs > 0 ? `: heartbeat\n\n` : "";
  let lastBeat = Date.now();

  for await (const ev of source) {
    // 心跳：距上次输出超过间隔，插一条注释帧（不触发前端 event）
    if (heartbeat && Date.now() - lastBeat >= heartbeatMs) {
      yield heartbeat;
      lastBeat = Date.now();
    }
    yield encodeSSEFrame(ev, opts);
    lastBeat = Date.now();
    // done/error 后结束（前端据此关闭）
    if (ev.type === "done" || ev.type === "error") return;
  }
}

/**
 * 便捷：直接把 stream() 结果写成 SSE 文本（一次性字符串，非流式输出）。
 * 适合一次性返回（如 serverless），不如 streamToSSE 的流式 pipe 实时。
 */
export async function collectSSE(source: AsyncIterable<StreamEvent>, opts?: SSEOptions): Promise<string> {
  let out = "";
  for await (const frame of streamToSSE(source, opts)) out += frame;
  return out;
}

/** Express/Fastify 响应头（SSE 标准） */
export const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no", // 关 Nginx 缓冲，保证实时推送
};
