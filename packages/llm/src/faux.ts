/**
 * Faux（Mock）Provider —— 内存模拟 LLM，供测试 / 演示使用，不发起真实 HTTP。
 *
 * 用法：把 preset.protocol 设为 "faux"（或 "mock"），然后用 registerFauxProvider
 * 预设响应；LLMClient 在 protocol === "faux" 时会短路调用 takeFauxResponse 取回
 * 预设响应，按 chunk 模拟流式吐出。
 *
 * 对标 pi-ai：registerFauxProvider / fauxAssistantMessage / fauxText / fauxThinking /
 * fauxToolCall。
 *
 * @example
 * registerFauxProvider({
 *   responses: [
 *     fauxAssistantMessage(fauxThinking('让我想想'), fauxText('你好！')),
 *     fauxAssistantMessage(fauxToolCall('get_weather', { city: '北京' })),
 *   ],
 * })
 * // 之后任何 protocol:"faux" 的调用会依次返回上面两条
 */

import type { APIPreset, LLMToolCall, LLMUsage } from "./adapters/types.js";

/** faux 响应（与 ModelResponse 的关键字段对齐，供 client 组装） */
export interface FauxResponse {
  content: string;
  reasoningContent?: string;
  toolCalls?: LLMToolCall[];
  usage?: LLMUsage | null;
  finishReason?: string | null;
}

/** faux 消息片段 */
export type FauxPart =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool"; name: string; args: Record<string, unknown>; id?: string };

/** 动态响应器：根据本轮消息返回一条 faux 响应 */
export type FauxResponder = (
  messages: Record<string, unknown>[],
  preset: APIPreset,
) => FauxResponse;

interface FauxProviderEntry {
  responses: FauxResponse[];
  cursor: number;
  respond?: FauxResponder;
  cycle: boolean;
}

/** model → provider 配置；"*" 为通配（匹配所有未单独注册的 model） */
const REGISTRY = new Map<string, FauxProviderEntry>();

let _toolIdCounter = 0;
function nextToolId(): string {
  _toolIdCounter += 1;
  return `faux_tool_${Date.now().toString(36)}_${_toolIdCounter}`;
}

// ── 片段构造器 ──

export function fauxText(text: string): FauxPart {
  return { kind: "text", text };
}

export function fauxThinking(text: string): FauxPart {
  return { kind: "thinking", text };
}

export function fauxToolCall(
  name: string,
  args: Record<string, unknown> = {},
  id?: string,
): FauxPart {
  return { kind: "tool", name, args, id };
}

/**
 * 把若干片段（或裸字符串，按 text 处理）组装成一条 faux 响应。
 */
export function fauxAssistantMessage(...parts: Array<FauxPart | string>): FauxResponse {
  let content = "";
  let reasoningContent = "";
  const toolCalls: LLMToolCall[] = [];

  for (const part of parts) {
    if (typeof part === "string") {
      content += part;
      continue;
    }
    if (part.kind === "text") {
      content += part.text;
    } else if (part.kind === "thinking") {
      reasoningContent += part.text;
    } else if (part.kind === "tool") {
      toolCalls.push({
        id: part.id ?? nextToolId(),
        name: part.name,
        parameters: part.args ?? {},
        provider: "faux",
        type: "function",
      });
    }
  }

  return {
    content,
    reasoningContent: reasoningContent || undefined,
    toolCalls: toolCalls.length ? toolCalls : undefined,
    finishReason: toolCalls.length ? "tool_calls" : "stop",
  };
}

// ── 注册 / 清理 ──

/**
 * 注册一个 faux provider。
 *
 * @param config.model    匹配的模型名（默认 "*" 通配所有模型）
 * @param config.responses 预设响应队列（FIFO 依次返回；用尽后行为见 cycle）
 * @param config.respond   动态响应器（优先级高于 responses）
 * @param config.cycle     responses 用尽后是否从头循环（默认 false：保留最后一条重复返回）
 */
export function registerFauxProvider(config: {
  model?: string;
  responses?: Array<FauxResponse | string>;
  respond?: FauxResponder;
  cycle?: boolean;
}): void {
  const model = config.model ?? "*";
  const responses = (config.responses ?? []).map((r) =>
    typeof r === "string" ? fauxAssistantMessage(r) : r,
  );
  REGISTRY.set(model, {
    responses,
    cursor: 0,
    respond: config.respond,
    cycle: config.cycle ?? false,
  });
}

/** 清空所有已注册的 faux provider */
export function clearFauxProviders(): void {
  REGISTRY.clear();
  _toolIdCounter = 0;
}

/** 移除指定模型的 faux provider（默认移除通配 "*"） */
export function unregisterFauxProvider(model = "*"): void {
  REGISTRY.delete(model);
}

// ── 取回响应（供 LLMClient 调用）──

/**
 * 取回下一条 faux 响应。
 * 查找顺序：preset.model 精确匹配 → 通配 "*"。
 * 若都未注册，则回显最后一条 user 消息（保证 protocol:"faux" 始终可用）。
 */
export function takeFauxResponse(
  preset: APIPreset,
  messages: Record<string, unknown>[],
): FauxResponse | null {
  const model = String(preset.model ?? "");
  const entry = REGISTRY.get(model) ?? REGISTRY.get("*");

  if (!entry) {
    return echoResponse(messages);
  }

  // 动态响应器优先
  if (entry.respond) {
    try {
      return entry.respond(messages, preset);
    } catch (err) {
      return { content: `[faux] responder error: ${String(err)}`, finishReason: "error" };
    }
  }

  if (entry.responses.length === 0) {
    return echoResponse(messages);
  }

  // 队列取值
  if (entry.cursor < entry.responses.length) {
    const resp = entry.responses[entry.cursor];
    entry.cursor += 1;
    if (entry.cycle && entry.cursor >= entry.responses.length) {
      entry.cursor = 0;
    }
    return resp;
  }

  // 用尽且不循环：返回最后一条
  return entry.responses[entry.responses.length - 1];
}

/** 回显最后一条 user 消息（默认 faux 行为） */
function echoResponse(messages: Record<string, unknown>[]): FauxResponse {
  let lastUser = "";
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      const c = messages[i].content;
      lastUser = typeof c === "string" ? c : JSON.stringify(c);
      break;
    }
  }
  return { content: `[faux] echo: ${lastUser}`, finishReason: "stop" };
}
