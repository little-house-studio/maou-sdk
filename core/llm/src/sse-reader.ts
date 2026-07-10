/**
 * SSE 流式响应解析器 —— 解析 text/event-stream 格式的 LLM 流式响应
 *
 * 从 client.ts 拆出。chatStream（流式）和 chat（非流式但收事件流响应）原本各有一段近重复的
 * SSE while 循环（合计 ~240 行），合并成本模块的一个共享 async generator，消除 ~90 行重复。
 *
 * 设计原则：parseSSEStream 只负责"解析 + yield 事件 + 释放 reader"，**不累积状态**。
 * 累积（responseBody / rawEvents / usage / toolChunks …）由调用方在消费 yield 时自行维护。
 * 这样流读取异常（abort/网络中断）时，调用方 catch 能拿到自己已累积的部分结果
 * （chatStream 用它组装 partial ModelResponse），与拆分前的 abort 语义完全一致。
 *
 * 流读取异常不在本模块 catch——上抛给调用方各自处理。
 */

import type {
  ProtocolAdapter,
  APIPreset,
} from "./adapters/types.js";
import { extractUsageFromEvent } from "./usage-extractor.js";

/** 解析 SSE 流时 yield 的事件（调用方据此累积状态） */
export interface SSEParsedEvent {
  /** 本事件的 delta 文本（可能为空） */
  delta: string;
  /** 思考/推理内容增量 */
  thinking?: string;
  /** 原始 SSE 行文本（供 rawEvents 收集） */
  rawEvent: string;
  /** 结束原因（出现即记录） */
  finishReason: string | null;
  /** 从本事件提取的 usage（调用方累积） */
  usage: ReturnType<typeof extractUsageFromEvent>;
  /** [DONE] 标记（调用方据此设 finishReason="stop"） */
  done: boolean;
}

/**
 * 读一个流式分片，带 stall 超时保护。
 * 服务器中途停滞（超过 stallMs 无新数据）时不会无限挂起，
 * 而是 cancel reader 并抛错，交由上层 catch/重试。
 */
async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  stallMs: number,
) {
  if (!stallMs || stallMs <= 0) return reader.read();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stall = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reader.cancel(new Error("stream stall timeout")).catch(() => {});
      reject(new Error(`流式响应停滞超过 ${stallMs}ms 无新数据，已中止`));
    }, stallMs);
  });
  try {
    return await Promise.race([reader.read(), stall]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 解析 text/event-stream 响应体，yield 每个解析后的事件。
 *
 * 调用方（chatStream 用 yield* 透传，chat 消费但只取累积）负责：
 * - responseBody += event.delta
 * - rawEvents.push(event.rawEvent)
 * - finishReason / reasoningFallbackUsed / firstOutput 计时
 * - accumulatedUsage 累积
 * - toolChunks 传入本函数，结束后用 adapter.collectToolCalls 收集
 *
 * @param args.reader  response.body.getReader()
 * @param args.adapter  协议适配器（解析 SSE event）
 * @param args.preset   API 预设（含 transformResponse 钩子）
 * @param args.protocol 协议名（usage 提取用）
 * @param args.stallMs  流式停滞超时（= LLMClient._streamStallMs）
 * @param args.toolChunks  调用方维护的 tool chunk 累积 Map（parseStreamEvent 往里写）
 * @yields SSEParsedEvent  每个解析后的事件（含 tail flush 的最后一个事件）
 */
export async function* parseSSEStream(args: {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  adapter: ProtocolAdapter;
  preset: APIPreset;
  protocol: string;
  stallMs: number;
  toolChunks: Map<number, { id: string; name: string; arguments: string }>;
}): AsyncGenerator<SSEParsedEvent, void> {
  const { reader, adapter, preset, protocol, stallMs, toolChunks } = args;
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await readChunk(reader, stallMs);
      if (done) {
        // 流结束：flush decoder 残留字节 + 处理 buffer 最后一行
        const tail = decoder.decode();
        if (tail) buffer += tail;
        if (buffer.trim()) {
          const decoded = buffer.trim();
          // 非 data tail 行：只带 rawEvent（原实现对所有非空 tail 行 push rawEvents）
          if (!decoded.startsWith("data: ")) {
            yield { delta: "", rawEvent: decoded, finishReason: null, usage: null, done: false };
          } else {
            const eventJson = decoded.slice(6);
            if (eventJson !== "[DONE]") {
              try {
                const tailData = JSON.parse(eventJson);
                const tailEvent = adapter.parseStreamEvent(tailData, toolChunks, preset);
                yield {
                  delta: tailEvent.delta ?? "",
                  thinking: tailEvent.thinking,
                  rawEvent: decoded,
                  finishReason: tailEvent.finishReason ?? null,
                  usage: extractUsageFromEvent(tailData, protocol),
                  done: false,
                };
              } catch {
                console.warn(`[LLMClient] SSE tail JSON.parse failed: ${eventJson.slice(0, 200)}`);
                yield { delta: "", rawEvent: decoded, finishReason: null, usage: null, done: false };
              }
            } else {
              // tail 是 [DONE]：原实现对 [DONE] 不 push rawEvents（在 if eventJson !== "[DONE]" 外），
              // 但原 tail 分支里 [DONE] 会落到 `if (decoded) rawEvents.push(decoded)` 之前已 push？
              // 原实现：tail flush 里 `if (decoded) rawEvents.push(decoded)` 在最外层，
              // 所以 [DONE] tail 也会被 push。这里 yield 一下让调用方收 rawEvent。
              yield { delta: "", rawEvent: decoded, finishReason: null, usage: null, done: true };
            }
          }
        }
        buffer = "";
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const decoded = line.trim();
        if (!decoded) continue;
        // 非 data 行：只带 rawEvent（调用方收 rawEvents），无 delta/finishReason
        if (!decoded.startsWith("data: ")) {
          yield { delta: "", rawEvent: decoded, finishReason: null, usage: null, done: false };
          continue;
        }

        const eventJson = decoded.slice(6);
        if (eventJson === "[DONE]") {
          yield { delta: "", rawEvent: decoded, finishReason: null, usage: null, done: true };
          continue;
        }

        let data: Record<string, unknown>;
        try {
          data = JSON.parse(eventJson);
        } catch {
          // JSON 解析失败可能是 chunk 边界切割或厂商返回非 JSON 错误。记日志方便排查。
          console.warn(`[LLMClient] SSE data JSON.parse failed: ${eventJson.slice(0, 200)}`);
          // 解析失败仍把 rawEvent 交给调用方（原实现对非空行都 push rawEvents）
          yield { delta: "", rawEvent: decoded, finishReason: null, usage: null, done: false };
          continue;
        }

        // 应用 transformResponse 钩子（用于 truly weird 的厂商格式）
        if (preset.transformResponse && typeof preset.transformResponse === "function") {
          try { data = preset.transformResponse(data); } catch { /* 转换失败不影响主流程 */ }
        }

        const event = adapter.parseStreamEvent(data, toolChunks, preset);
        yield {
          delta: event.delta ?? "",
          thinking: event.thinking,
          rawEvent: decoded,
          finishReason: event.finishReason ?? null,
          usage: extractUsageFromEvent(data, protocol),
          done: false,
        };
      }
    }
  } finally {
    // 安全释放 reader：先 cancel 关闭底层流，再 releaseLock。
    // try/catch 防止 abort/异常态下 releaseLock 抛二次错误覆盖原始异常。
    try { await reader.cancel(); } catch { /* 已关闭或 abort 态 */ }
    try { reader.releaseLock(); } catch { /* 锁已释放 */ }
  }
}
