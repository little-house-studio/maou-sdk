/**
 * parseSSEStream 单测 —— 验证 client.ts 拆分后 SSE 合并的正确性
 *
 * mock 一个 text/event-stream 响应体，断言：
 * - delta 序列正确拼接
 * - finishReason 提取（[DONE] → stop / choice.finish_reason）
 * - usage 提取（OpenAI data.usage）
 * - rawEvents 收集所有非空行
 * - toolChunks 透传给 adapter
 *
 * 这是 client.ts 拆分（chatStream+chat SSE 合并）的回归保护。
 */
import { describe, it, expect } from "vitest";
import { parseSSEStream } from "./sse-reader.js";
import { OpenAIChatAdapter } from "./adapters/openai.js";
import type { APIPreset } from "./adapters/types.js";

/** 把 SSE 文本帧字符串包成 ReadableStream（模拟 response.body） */
function makeSSEBody(frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(f));
      controller.close();
    },
  });
}

const ADAPTER = new OpenAIChatAdapter();
const PRESET: APIPreset = { model: "m", url: "http://x", protocol: "openai", key: "k" };

describe("parseSSEStream（client.ts SSE 合并回归）", () => {
  it("拼接 delta + 提取 finishReason + usage + 收集 rawEvents", async () => {
    // 标准 OpenAI 流式响应：3 个 delta + 1 个 finish + [DONE]
    const frames = [
      `data: {"choices":[{"delta":{"content":"你好"}}]}\n\n`,
      `data: {"choices":[{"delta":{"content":"，世界"}}]}\n\n`,
      `data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":3,"total_tokens":8}}\n\n`,
      `data: [DONE]\n\n`,
    ];

    const toolChunks = new Map<number, { id: string; name: string; arguments: string }>();
    const gen = parseSSEStream({
      reader: makeSSEBody(frames).getReader(),
      adapter: ADAPTER,
      preset: PRESET,
      protocol: "openai",
      stallMs: 0,
      toolChunks,
    });

    let responseBody = "";
    const rawEvents: string[] = [];
    let finishReason: string | null = null;
    let accumulatedUsage: Record<string, number> | null = null;

    for await (const ev of gen) {
      rawEvents.push(ev.rawEvent);
      if (ev.done) {
        if (!finishReason) finishReason = "stop";
        continue;
      }
      if (ev.delta) responseBody += ev.delta;
      if (ev.finishReason) finishReason = ev.finishReason;
      if (ev.usage) {
        if (!accumulatedUsage) accumulatedUsage = {};
        Object.assign(accumulatedUsage, ev.usage);
      }
    }

    expect(responseBody).toBe("你好，世界");
    expect(finishReason).toBe("stop");
    expect(accumulatedUsage).toMatchObject({ prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 });
    // rawEvents 收集所有非空行：3 个 data + [DONE] = 4
    expect(rawEvents.length).toBe(4);
    expect(rawEvents[3]).toBe("data: [DONE]");
  });

  it("[DONE] 前无 finish_reason 时设为 stop", async () => {
    const frames = [
      `data: {"choices":[{"delta":{"content":"hi"}}]}\n\n`,
      `data: [DONE]\n\n`,
    ];
    const toolChunks = new Map();
    const gen = parseSSEStream({
      reader: makeSSEBody(frames).getReader(),
      adapter: ADAPTER,
      preset: PRESET,
      protocol: "openai",
      stallMs: 0,
      toolChunks,
    });
    let finishReason = null;
    for await (const ev of gen) {
      if (ev.done) { if (!finishReason) finishReason = "stop"; }
      if (ev.finishReason) finishReason = ev.finishReason;
    }
    expect(finishReason).toBe("stop");
  });

  it("空 body 不崩，返回无 delta", async () => {
    const toolChunks = new Map();
    const gen = parseSSEStream({
      reader: makeSSEBody([]).getReader(),
      adapter: ADAPTER,
      preset: PRESET,
      protocol: "openai",
      stallMs: 0,
      toolChunks,
    });
    let responseBody = "";
    for await (const ev of gen) { if (ev.delta) responseBody += ev.delta; }
    expect(responseBody).toBe("");
  });

  it("非 data 行也收集到 rawEvents", async () => {
    const frames = [
      `: comment line\n\n`,                                   // SSE 注释行（非 data）
      `event: ping\n\n`,                                      // event 行（非 data）
      `data: {"choices":[{"delta":{"content":"x"}}]}\n\n`,
      `data: [DONE]\n\n`,
    ];
    const toolChunks = new Map();
    const gen = parseSSEStream({
      reader: makeSSEBody(frames).getReader(),
      adapter: ADAPTER,
      preset: PRESET,
      protocol: "openai",
      stallMs: 0,
      toolChunks,
    });
    const rawEvents: string[] = [];
    for await (const ev of gen) rawEvents.push(ev.rawEvent);
    // 注释行 + event 行 + 2 个 data = 4
    expect(rawEvents.length).toBe(4);
    expect(rawEvents).toContain(": comment line");
    expect(rawEvents).toContain("event: ping");
  });

  it("JSON 解析失败的 data 行不崩，仍收集 rawEvent", async () => {
    const frames = [
      `data: {invalid json\n\n`,
      `data: {"choices":[{"delta":{"content":"ok"}}]}\n\n`,
      `data: [DONE]\n\n`,
    ];
    const toolChunks = new Map();
    const gen = parseSSEStream({
      reader: makeSSEBody(frames).getReader(),
      adapter: ADAPTER,
      preset: PRESET,
      protocol: "openai",
      stallMs: 0,
      toolChunks,
    });
    let responseBody = "";
    const rawEvents: string[] = [];
    for await (const ev of gen) {
      rawEvents.push(ev.rawEvent);
      if (ev.delta) responseBody += ev.delta;
    }
    // 坏行不贡献 delta，但 rawEvent 收集了
    expect(responseBody).toBe("ok");
    expect(rawEvents).toContain("data: {invalid json");
  });
});
