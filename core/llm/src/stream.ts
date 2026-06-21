/**
 * stream / complete —— 无状态的核心 LLM API（对标 pi-ai 的 stream/complete）
 *
 * 形态：stream(model, context, options) → 事件流；complete(...) → AssistantMessage。
 * Context = { systemPrompt, messages, tools } 扁平、JSON 可序列化，是跨模型交接/持久化的基础。
 *
 * 比 pi-ai 更完善的地方：
 * - options.structuredOutput：复用我们的结构化 JSON 输出协议层（pi 没有）
 * - options.thinking：统一 5 级，映射到各厂商（见 reasoning.ts）
 * - 底层自带重试 + 429 退避（pi 无内置重试）
 * - abort 不抛错（见 stopReason），部分内容保留可续传
 *
 * @example
 * const model = getModel("anthropic", "claude-sonnet-4-5")!;
 * const ctx = { systemPrompt: "你是助手", messages: [{ role: "user", content: "hi" }] };
 * for await (const ev of stream(model, ctx)) { if (ev.type === "text") process.stdout.write(ev.delta); }
 * // 或一次性:
 * const msg = await complete(model, ctx);
 */

import { LLMClient } from "./client.js";
import { ModelCaller, type CallerStreamEvent, type ModelCallResult } from "./caller.js";
import type { APIPreset, LLMToolCall, LLMUsage } from "./adapters/types.js";
import type { ToolSchema } from "./tools/index.js";
import { reasoningParamsFor, type ReasoningLevel } from "./reasoning.js";
import { computeCost, type Pricing } from "./compute-cost.js";

// ─── Context / Message 类型（pi-ai 核心数据结构，我们更规整）──────────────────

/** 文本内容块 */
export interface TextContent {
  type: "text";
  text: string;
}
/** 图片内容块（vision 输入） */
export interface ImageContent {
  type: "image";
  data: string; // base64
  mimeType: string;
}
/** 思考/推理内容块（assistant 产出，跨厂商交接时转 <thinking> 文本） */
export interface ThinkingContent {
  type: "thinking";
  text: string;
}

/** 用户消息 */
export interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
}
/** 助手消息（可含 thinking + 文本 + 工具调用） */
export interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCallBlock)[];
  /** 厂商协议（用于跨厂商交接归一） */
  api?: string;
  provider?: string;
  model?: string;
  usage?: Usage;
  stopReason?: StopReason;
}
/** 工具结果消息 */
export interface ToolResultMessage {
  role: "tool";
  toolCallId: string;
  toolName?: string;
  content: string;
  isError?: boolean;
}

/** 工具调用块（assistant content 里的） */
export interface ToolCallBlock {
  type: "toolCall";
  id: string;
  name: string;
  parameters: Record<string, unknown>;
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage;

/** 会话上下文（扁平、JSON 可序列化） */
export interface Context {
  systemPrompt?: string;
  messages: Message[];
  tools?: (ToolSchema | DefinedToolLike)[];
}
/** 兼容 defineTool 产出的工具（有 toSchema） */
interface DefinedToolLike {
  name?: string;
  toSchema?: () => ToolSchema;
}

// ─── Usage / StopReason ────────────────────────────────────────────────────

/** 统一用量 + 成本（cost 永远填，含 error/aborted 部分量） */
export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Anthropic 1h 长缓存写入量（按 2x 计费） */
  cacheWrite1h?: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

/** 停止原因（abort 编码进流，不抛错） */
export type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

// ─── Model 类型（stream 的第一参）────────────────────────────────────────────

/**
 * stream/complete 接受的"模型"。
 * 可以是 getModel() 返回的 ModelSpec，也可以是 LLMConfig.toAPIPreset() 的 APIPreset，
 * 还可以是手写的 { model, url, protocol, key } 字面量（对标 pi 的 custom Model）。
 */
export type StreamModel =
  | APIPreset
  | (Record<string, unknown> & { model: string; url?: string; protocol?: string });

// ─── stream 选项 ─────────────────────────────────────────────────────────────

export interface StreamOptions {
  /** API key（缺省走 env，见 getEnvApiKey） */
  apiKey?: string;
  /** 统一思考级别 */
  thinking?: ReasoningLevel;
  thinkingBudgetTokens?: number;
  /** 结构化 JSON 输出（我们的优势：复用 protocol 层）。传 JSON Schema */
  structuredOutput?: Record<string, unknown> | string;
  /** 缓存保留：none/short(默认)/long(Anthropic 1h) */
  cacheRetention?: "none" | "short" | "long";
  /** 会话 id（缓存亲和 / 日志） */
  sessionId?: string;
  /** 最大输出 token */
  maxTokens?: number;
  /** 是否流式（默认 true；complete 内部置 false 语义但实现仍走流） */
  stream?: boolean;
  /** 中断信号（abort 不抛错，编码为 stopReason:"aborted"） */
  signal?: AbortSignal;
  /** 发送前/收到后拦截钩子（复用 LLMClient 的能力） */
  onPayload?: (ctx: { url: string; headers: Record<string, string>; body: string }) => void;
  onResponse?: (ctx: { url: string; status: number; headers: Record<string, string> }) => void;
}

// ─── stream 事件（对标 pi 的 AssistantMessageEvent，命名更直观）──────────────

export type StreamEvent =
  | { type: "text"; delta: string; content: string }
  | { type: "thinking"; delta: string; content: string }
  | { type: "toolCall"; tool: LLMToolCall }
  | { type: "usage"; usage: Usage }
  | { type: "done"; message: AssistantMessage }
  | { type: "error"; error: string; stopReason: StopReason };

// ─── 内部：Context → 适配器消息 ──────────────────────────────────────────────

/** 把 Context 消息转成底层 ModelCaller 吃的 Record 消息（OpenAI 原生 shape） */
function contextToAdapterMessages(ctx: Context): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const msg of ctx.messages) {
    if (msg.role === "user") {
      out.push({ role: "user", content: typeof msg.content === "string" ? msg.content : msg.content });
    } else if (msg.role === "assistant") {
      const texts = msg.content.filter((c) => c.type === "text").map((c) => (c as TextContent).text).join("");
      const calls = msg.content.filter((c) => c.type === "toolCall") as ToolCallBlock[];
      const entry: Record<string, unknown> = { role: "assistant", content: texts };
      if (calls.length) {
        entry.tool_calls = calls.map((c) => ({
          id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.parameters ?? {}) },
        }));
      }
      out.push(entry);
    } else if (msg.role === "tool") {
      out.push({ role: "tool", tool_call_id: msg.toolCallId, content: msg.content });
    }
  }
  return out;
}

/** 把 tools（ToolSchema 或 DefinedTool）归一成 caller 吃的 schema 数组 */
function normalizeTools(tools?: (ToolSchema | DefinedToolLike)[]): Record<string, unknown>[] | null {
  if (!tools?.length) return null;
  return tools.map((t) => {
    const s = "toSchema" in t && t.toSchema ? t.toSchema() : (t as ToolSchema);
    return s as unknown as Record<string, unknown>;
  });
}

/** 把 ModelSpec/APIPreset/字面量 归一成 APIPreset */
function toAPIPreset(model: StreamModel, opts: StreamOptions): APIPreset {
  const preset: APIPreset = { ...(model as APIPreset) };
  if (opts.apiKey) preset.key = opts.apiKey;
  if (opts.maxTokens) preset.maxTokens = opts.maxTokens;
  // cacheRetention → preset.cacheRetention（Anthropic adapter 识别）
  if (opts.cacheRetention) (preset as Record<string, unknown>).cacheRetention = opts.cacheRetention;
  // thinking → reasoning_params（各适配器翻译）
  if (opts.thinking && opts.thinking !== "off") {
    preset.reasoning_params = reasoningParamsFor(opts.thinking, { budgetTokens: opts.thinkingBudgetTokens });
  } else if (opts.thinking === "off") {
    preset.reasoning_params = { thinking: { type: "disabled" } };
  }
  return preset;
}

/** 把 LLMUsage（下划线字段）算成完整 Usage（含 cost，永远填） */
function computeUsage(raw: LLMUsage | null, preset: APIPreset): Usage {
  const input = Number(raw?.prompt_tokens ?? raw?.input_tokens ?? 0);
  const output = Number(raw?.completion_tokens ?? raw?.output_tokens ?? 0);
  const cacheRead = Number(raw?.cache_read_input_tokens ?? raw?.cache_hit_tokens ?? raw?.cached_tokens ?? 0);
  const cacheWrite = Number(raw?.cache_creation_input_tokens ?? 0);
  const cacheWrite1h = Number((raw as Record<string, unknown> | null)?.cache_write_1h ?? 0);
  const totalTokens = Number(raw?.total_tokens ?? input + output);

  const pricing = ((preset as Record<string, unknown>).pricing as Pricing | undefined) ?? null;
  let cost: Usage["cost"] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  if (pricing) {
    const c = computeCost(
      {
        prompt_tokens: input, completion_tokens: output, total_tokens: totalTokens,
        cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheWrite,
      },
      pricing,
    );
    if (c) {
      // Anthropic 1h 长缓存写入按 2x 计费（pi-ai 同款建模）
      const longWriteCost = cacheWrite1h > 0 ? (cacheWrite1h / 1e6) * pricing.inputPrice * 2 : 0;
      cost = {
        input: c.inputCost, output: c.outputCost, cacheRead: c.cacheSavings >= 0 ? -c.cacheSavings : 0,
        cacheWrite: c.totalCost - c.inputCost - c.outputCost + longWriteCost, total: c.totalCost + longWriteCost,
      };
    }
  }
  return { input, output, cacheRead, cacheWrite, cacheWrite1h: cacheWrite1h || undefined, totalTokens, cost };
}

// ─── 核心：stream ───────────────────────────────────────────────────────────

/**
 * 流式调用 LLM。返回事件流（async iterable）。
 * 用法：`for await (const ev of stream(model, ctx, opts)) { ... }`
 * 或 `await stream(...).result()` 拿最终 AssistantMessage（见 StreamResult）。
 */
export function stream(model: StreamModel, context: Context, options: StreamOptions = {}): StreamResult {
  const preset = toAPIPreset(model, options);
  const adapterMessages = contextToAdapterMessages(context);
  if (context.systemPrompt) adapterMessages.unshift({ role: "system", content: context.systemPrompt });
  const toolSchemas = normalizeTools(context.tools);

  const client = new LLMClient({
    onPayload: options.onPayload ? (c) => options.onPayload!(c) : undefined,
    onResponse: options.onResponse ? (c) => options.onResponse!(c) : undefined,
  });
  const caller = new ModelCaller({
    client,
    emitEvent: (type, data) => ({ type, data }),
    emitLog: () => ({ type: "log", data: {} }),
    maxRetries: 2,
  });

  return new StreamResult(async function* () {
    let content = "";
    let thinkingContent = "";
    let result: ModelCallResult | null = null;
    let aborted = false;

    try {
      const iter = caller.callStream({
        sessionId: options.sessionId ?? "stream",
        roundIndex: 1,
        preset,
        messages: adapterMessages as Record<string, string>[],
        autoFormat: !!options.structuredOutput,
        jsonSettings: options.structuredOutput
          ? { schema: typeof options.structuredOutput === "string" ? options.structuredOutput : JSON.stringify(options.structuredOutput) }
          : null,
        stream: true,
        toolSchemas,
        nativeToolCalling: toolSchemas ? true : undefined,
        abortSignal: options.signal,
      });

      let it = await iter.next();
      while (!it.done) {
        const ev: CallerStreamEvent = it.value;
        if (ev.type === "assistant_delta" && ev.data?.delta) {
          const d = String(ev.data.delta);
          content += d;
          yield { type: "text", delta: d, content };
        } else if (ev.type === "thinking_delta" && ev.data?.delta) {
          const d = String(ev.data.delta);
          thinkingContent += d;
          yield { type: "thinking", delta: d, content: thinkingContent };
        } else if (ev.type === "tool_pending") {
          yield { type: "toolCall", tool: ev.data.tool as LLMToolCall };
        } else if (ev.type === "model.error") {
          yield { type: "error", error: String(ev.data.error), stopReason: "error" };
        }
        it = await iter.next();
      }
      result = it.value;
    } catch (err) {
      const isAbort = options.signal?.aborted || (err instanceof DOMException && err.name === "AbortError");
      aborted = isAbort;
      if (!isAbort) {
        yield { type: "error", error: String(err), stopReason: "error" };
      }
    }

    // 构建最终 AssistantMessage（即便 abort/error，也保留部分内容/usage）
    const toolCalls = result?.nativeToolCalls ?? [];
    const blocks: AssistantMessage["content"] = [];
    if (thinkingContent) blocks.push({ type: "thinking", text: thinkingContent });
    if (content || toolCalls.length === 0) blocks.push({ type: "text", text: content });
    for (const c of toolCalls) {
      blocks.push({ type: "toolCall", id: c.id, name: c.name, parameters: c.parameters });
    }
    const usage = computeUsage(result?.usage ?? null, preset);
    const stopReason: StopReason = aborted
      ? "aborted"
      : toolCalls.length > 0
        ? "toolUse"
        : "stop";

    const message: AssistantMessage = {
      role: "assistant",
      content: blocks,
      api: preset.protocol,
      provider: (preset as Record<string, unknown>).name as string | undefined,
      model: preset.model,
      usage,
      stopReason,
    };

    yield { type: "usage", usage };
    yield { type: "done", message };
  });
}

/**
 * 非流式（一次性拿 AssistantMessage）。内部走 stream 收集。
 */
export async function complete(model: StreamModel, context: Context, options: StreamOptions = {}): Promise<AssistantMessage> {
  return stream(model, context, options).result();
}

// ─── StreamResult：事件流 + .result() Promise（对标 pi 的 EventStream）──────

/**
 * 包装 async generator，额外提供：
 * - .result()：返回最终 AssistantMessage 的 Promise（可与 for-await 并发）
 * - [Symbol.asyncIterator]：直接 for-await
 */
export class StreamResult implements AsyncIterable<StreamEvent> {
  private readonly gen: () => AsyncGenerator<StreamEvent>;
  private resultPromise: Promise<AssistantMessage> | null = null;

  constructor(gen: () => AsyncGenerator<StreamEvent>) {
    this.gen = gen;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<StreamEvent> {
    yield* this.consume();
  }

  /** 拿最终 AssistantMessage（消费整个流） */
  result(): Promise<AssistantMessage> {
    if (!this.resultPromise) {
      this.resultPromise = (async () => {
        let msg: AssistantMessage | null = null;
        for await (const ev of this.consume()) {
          if (ev.type === "done") msg = ev.message;
        }
        if (!msg) throw new Error("stream 结束但无 done 事件");
        return msg;
      })();
    }
    return this.resultPromise;
  }

  /** 内部：单消费者守卫（result 和 for-await 不能同时各自拉 generator） */
  private consumer: AsyncGenerator<StreamEvent> | null = null;
  private async *consume(): AsyncGenerator<StreamEvent> {
    if (!this.consumer) this.consumer = this.gen();
    yield* this.consumer;
  }
}
