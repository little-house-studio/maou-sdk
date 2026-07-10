/**
 * Bedrock 二进制事件流解析器
 *
 * 从 client.ts 拆出（原 _readBedrockEventStream private async generator）。
 * Bedrock Converse Stream API 返回 application/vnd.amazon.eventstream 格式的二进制流，
 * 每个消息包含 headers（含 :event-type）和 body（JSON payload）。
 *
 * 完全不依赖 LLMClient 实例状态（纯函数，接 body 参数），故独立成模块。
 * @smithy/core 动态 import 保持在这里（浏览器友好，不进静态依赖图）。
 */

/**
 * 读取 Bedrock 二进制事件流并解码为 JSON 事件
 *
 * @yields 解码后的 { data: Record<string, unknown>, rawText: string } 事件
 */
export async function* readBedrockEventStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<{ data: Record<string, unknown>; rawText: string }> {
  // 动态加载 smithy 解码器（仅 Bedrock 需要；保持核心对浏览器友好）
  const { EventStreamCodec } = await import("@smithy/core/event-streams");
  const codec = new EventStreamCodec(
    (input: Uint8Array) => new TextDecoder("utf-8").decode(input),
    (input: string) => new TextEncoder().encode(input),
  );

  const reader = body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        codec.endOfStream();
        break;
      }
      if (value && value.byteLength > 0) {
        codec.feed(value);
        // 取出所有已解码的消息
        let messages = codec.getAvailableMessages();
        let decodedMessages = messages.getMessages();
        while (decodedMessages.length > 0) {
          for (const message of decodedMessages) {
            const bodyText = new TextDecoder("utf-8").decode(message.body);
            if (!bodyText.trim()) continue;
            try {
              const data = JSON.parse(bodyText) as Record<string, unknown>;
              // 将 event-type 注入到数据中，方便 adapter.parseStreamEvent 使用
              const eventType = message.headers[":event-type"];
              if (eventType && typeof eventType.value === "string") {
                data._eventType = eventType.value;
              }
              const messageType = message.headers[":message-type"];
              if (messageType && typeof messageType.value === "string") {
                data._messageType = messageType.value;
              }
              yield { data, rawText: bodyText };
            } catch {
              // JSON 解析失败，跳过
              console.warn(`[LLMClient] Bedrock eventstream JSON.parse failed: ${bodyText.slice(0, 200)}`);
            }
          }
          messages = codec.getAvailableMessages();
          decodedMessages = messages.getMessages();
        }
      }
    }
  } finally {
    try { await reader.cancel(); } catch { /* 已关闭 */ }
    try { reader.releaseLock(); } catch { /* 锁已释放 */ }
  }
}
