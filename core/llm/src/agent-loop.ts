/**
 * agentLoop —— LLM 层内置的极简 agent 循环
 *
 * 对标 pi-ai 的 agentLoop：定义工具 + 执行器 → 调用模型 → 执行工具调用 → 把结果喂回 →
 * 重复，直到模型不再调用工具或达到 maxSteps。完全自包含（基于 LLMClient + ModelCaller），
 * 与 harness/AgentRuntime 那套"提示树驱动"的重型 agent 解耦，适合 SDK 用户快速搭建。
 *
 * 工具消息格式对齐 core/context/message-builder.ts（OpenAI 原生 shape，各协议适配器都能消费）：
 *   assistant: { role:"assistant", content, tool_calls:[{id,type:"function",function:{name,arguments}}] }
 *   tool:      { role:"tool", tool_call_id, content }
 *
 * @example
 * const tools = [defineTool({ name:"add", description:"相加", parameters: Type.Object({a:Type.Number(),b:Type.Number()}), execute:({a,b})=>a+b })]
 * for await (const ev of agentLoop({ preset, tools, prompt:"3+4 等于几？用 add 工具" })) {
 *   if (ev.type === "text") process.stdout.write(ev.delta)
 * }
 */

import { LLMClient } from "./client.js";
import { ModelCaller, type CallerStreamEvent, type ModelCallResult } from "./caller.js";
import type { APIPreset, LLMToolCall, LLMUsage } from "./adapters/types.js";
import { validateToolCall, type DefinedTool } from "./tools/index.js";
import { createStealthMapper, type StealthMapper } from "./stealth.js";

/** 朴素工具（不依赖 TypeBox） */
export interface AgentLoopTool {
  name: string;
  description?: string;
  /** JSON Schema 参数定义 */
  parameters?: Record<string, unknown>;
  execute: (
    args: Record<string, unknown>,
    ctx: { call: LLMToolCall; step: number },
  ) => unknown | Promise<unknown>;
}

/** agentLoop 接受朴素工具或 defineTool 产出的类型安全工具 */
// 用 DefinedTool<any> 作为联合成员：execute 的参数类型随 schema 变化（逆变），
// 收窄成具体 TObject 会导致具体工具无法赋给联合类型。这是有意的变型逃逸口。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AgentLoopAnyTool = AgentLoopTool | DefinedTool<any>;

/** agentLoop 参数 */
export interface AgentLoopParams {
  preset: APIPreset;
  tools: AgentLoopAnyTool[];
  /** 初始用户输入（与 messages 二选一/可叠加） */
  prompt?: string;
  /** 系统提示 */
  system?: string;
  /** 预置历史（提供时作为起点；prompt 会追加在其后） */
  messages?: Record<string, unknown>[];
  /** 最大步数（默认 12） */
  maxSteps?: number;
  /** 是否流式（默认 true） */
  stream?: boolean;
  /** 中断信号 */
  abortSignal?: AbortSignal;
  /** 工具执行/校验出错时，把错误文本作为 tool 结果继续（默认 true）；false 则抛出 */
  continueOnToolError?: boolean;
  /** 伪装为 Claude Code 工具名（Bash/Read/Edit…）发送；收到调用后自动还原查执行器 */
  stealth?: boolean;
}

/** agentLoop 流式事件 */
export type AgentLoopEvent =
  | { type: "step_start"; step: number }
  | { type: "text"; delta: string; content: string; step: number }
  | { type: "thinking"; delta: string; step: number }
  | { type: "tool_call"; tool: LLMToolCall; step: number }
  | { type: "tool_result"; name: string; id: string; result: string; isError: boolean; step: number }
  | { type: "step_end"; step: number; finishReason: string | null }
  | { type: "error"; error: string; step: number };

/** 停止原因 */
export type AgentLoopStopReason = "done" | "max_steps" | "aborted" | "error";

/** agentLoop 最终结果 */
export interface AgentLoopResult {
  /** 完整消息历史（含工具调用与结果） */
  messages: Record<string, unknown>[];
  /** 实际执行步数 */
  steps: number;
  /** 最后一步的正文 */
  finalText: string;
  /** 累计 token 用量 */
  usage: LLMUsage;
  /** 停止原因 */
  stoppedReason: AgentLoopStopReason;
}

interface NormalizedTool {
  name: string;
  schema: { name: string; description: string; parameters: Record<string, unknown> };
  defined?: DefinedTool;
  execute?: (args: Record<string, unknown>, ctx: { call: LLMToolCall; step: number }) => unknown | Promise<unknown>;
}

function isDefinedTool(t: AgentLoopAnyTool): t is DefinedTool {
  return typeof (t as DefinedTool).toSchema === "function";
}

function normalizeTools(tools: AgentLoopAnyTool[]): Map<string, NormalizedTool> {
  const map = new Map<string, NormalizedTool>();
  for (const t of tools) {
    if (isDefinedTool(t)) {
      map.set(t.name, {
        name: t.name,
        schema: t.toSchema(),
        defined: t,
        execute: t.execute as NormalizedTool["execute"],
      });
    } else {
      map.set(t.name, {
        name: t.name,
        schema: {
          name: t.name,
          description: t.description ?? t.name,
          parameters: t.parameters ?? { type: "object", properties: {} },
        },
        execute: t.execute,
      });
    }
  }
  return map;
}

function stringifyResult(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function accumulateUsage(into: LLMUsage, add: LLMUsage | null): void {
  if (!add) return;
  for (const key of ["prompt_tokens", "completion_tokens", "total_tokens", "cache_read_input_tokens"]) {
    const v = add[key];
    if (typeof v === "number") into[key] = (Number(into[key]) || 0) + v;
  }
}

/**
 * 运行 agent 循环。流式 yield 事件，最终 return AgentLoopResult。
 */
export async function* agentLoop(
  params: AgentLoopParams,
): AsyncGenerator<AgentLoopEvent, AgentLoopResult> {
  const maxSteps = params.maxSteps ?? 12;
  const stream = params.stream ?? true;
  const continueOnToolError = params.continueOnToolError ?? true;
  const toolMap = normalizeTools(params.tools);
  const stealth: StealthMapper | null = params.stealth ? createStealthMapper() : null;
  // 伪装：把对外暴露的工具 schema 名改成 Claude Code 规范名
  const toolSchemas = [...toolMap.values()].map((t) => t.schema).map((s) =>
    stealth ? { ...s, name: stealth.forwardName(s.name) } : s,
  );

  // 组装初始消息
  const messages: Record<string, unknown>[] = [];
  if (params.system) messages.push({ role: "system", content: params.system });
  if (params.messages) messages.push(...params.messages);
  if (params.prompt) messages.push({ role: "user", content: params.prompt });

  const client = new LLMClient();
  const caller = new ModelCaller({
    client,
    emitEvent: (type, data) => ({ type, data }),
    emitLog: (level, data) => ({ type: level, data: { message: data } }),
    maxRetries: 2,
  });

  const usage: LLMUsage = {};
  let finalText = "";

  for (let step = 1; step <= maxSteps; step++) {
    if (params.abortSignal?.aborted) {
      return { messages, steps: step - 1, finalText, usage, stoppedReason: "aborted" };
    }

    yield { type: "step_start", step };

    let content = "";
    let result: ModelCallResult;
    try {
      const iter = caller.callStream({
        sessionId: "agentloop",
        roundIndex: step,
        preset: params.preset,
        messages: messages as Record<string, string>[],
        autoFormat: false,
        jsonSettings: null,
        stream,
        toolSchemas,
        nativeToolCalling: true,
        abortSignal: params.abortSignal,
      });

      let it = await iter.next();
      while (!it.done) {
        const ev: CallerStreamEvent = it.value;
        if (ev.type === "assistant_delta" && ev.data?.delta) {
          const d = String(ev.data.delta);
          content += d;
          yield { type: "text", delta: d, content, step };
        } else if (ev.type === "thinking_delta" && ev.data?.delta) {
          yield { type: "thinking", delta: String(ev.data.delta), step };
        } else if (ev.type === "model.error") {
          yield { type: "error", error: String(ev.data.error), step };
        }
        it = await iter.next();
      }
      result = it.value;
    } catch (err) {
      const isAbort = params.abortSignal?.aborted || (err instanceof DOMException && err.name === "AbortError");
      yield { type: "error", error: String(err), step };
      return {
        messages,
        steps: step,
        finalText,
        usage,
        stoppedReason: isAbort ? "aborted" : "error",
      };
    }

    accumulateUsage(usage, result.usage);
    finalText = result.content || content || finalText;
    const toolCalls = result.nativeToolCalls ?? [];

    // 追加 assistant 消息（带 tool_calls 配对）
    const assistantMsg: Record<string, unknown> = {
      role: "assistant",
      content: result.content ?? content ?? "",
    };
    if (toolCalls.length > 0) {
      assistantMsg.tool_calls = toolCalls.map((c) => ({
        id: c.id,
        type: c.type || "function",
        function: { name: c.name, arguments: JSON.stringify(c.parameters ?? {}) },
      }));
    }
    messages.push(assistantMsg);

    yield { type: "step_end", step, finishReason: toolCalls.length ? "tool_calls" : "stop" };

    // 无工具调用 → 完成
    if (toolCalls.length === 0) {
      return { messages, steps: step, finalText, usage, stoppedReason: "done" };
    }

    // 执行每个工具调用，结果喂回
    for (const call of toolCalls) {
      yield { type: "tool_call", tool: call, step };

      // 伪装模式下模型回传的是 Claude Code 名，还原回本项目名再查执行器
      const lookupName = stealth ? stealth.restoreName(call.name) : call.name;
      const tool = toolMap.get(lookupName);
      let resultText = "";
      let isError = false;

      if (!tool || !tool.execute) {
        resultText = `未知工具: ${call.name}`;
        isError = true;
      } else {
        // 类型安全工具：先校验参数
        let args: Record<string, unknown> = call.parameters ?? {};
        if (tool.defined) {
          const v = validateToolCall(tool.defined, call);
          if (!v.ok) {
            resultText = `参数校验失败: ${(v.errors ?? []).join("; ")}`;
            isError = true;
          } else {
            args = v.value as Record<string, unknown>;
          }
        }

        if (!isError) {
          try {
            const out = await tool.execute(args, { call, step });
            resultText = stringifyResult(out);
          } catch (err) {
            isError = true;
            resultText = `工具执行出错: ${String(err)}`;
            if (!continueOnToolError) {
              messages.push({ role: "tool", tool_call_id: call.id, content: resultText });
              yield { type: "tool_result", name: call.name, id: call.id, result: resultText, isError, step };
              throw err;
            }
          }
        }
      }

      messages.push({ role: "tool", tool_call_id: call.id, content: resultText });
      yield { type: "tool_result", name: call.name, id: call.id, result: resultText, isError, step };
    }
  }

  // 步数耗尽
  return { messages, steps: maxSteps, finalText, usage, stoppedReason: "max_steps" };
}
