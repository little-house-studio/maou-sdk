/**
 * 事件 reducer —— 纯函数 (state, StreamEvent) => Partial<State>。
 *
 * 处理全部 27 个 StreamEvent type。重点陷阱已处理：
 *  ① error 后置 streaming:false（runAgentCli 遇 error 即 return，收不到后续 done）
 *  ② log（带 level）vs info（无 level）分流
 *  ③ model.usage 裸 {usage} 累计 token；assistant.usage 含 max_context 更新窗口
 *  ④ tool_call.tool 是对象；tool_result 的 toolCallId/name/content/ok 是顶层
 *  ⑤ session 是 Session 对象，取 .id
 */

import type { StreamEvent } from "@little-house-studio/types";
import type { UIState, ChatMessage, ToolCardState, RoundUsage } from "./types.js";

let idc = 0;
export const uid = (): string => `m${Date.now()}_${idc++}`;

type Patch = Partial<UIState>;

const MAX_RESULT = 2000;
const HISTORY = 20;

/** 从 usage 对象取 input/output token（兼容各家字段名） */
function parseUsage(u: Record<string, unknown> | undefined): { input: number; output: number; cacheRead?: number } {
  if (!u) return { input: 0, output: 0 };
  const input = Number(u.prompt_tokens ?? u.input_tokens ?? u.inputTokens ?? 0) || 0;
  const output = Number(u.completion_tokens ?? u.output_tokens ?? u.outputTokens ?? 0) || 0;
  const details = u.prompt_tokens_details as { cached_tokens?: number } | undefined;
  // 注意：保留 cacheRead=0（不转 undefined），让 0% 缓存轮次也进入 cacheHistory，
  // 否则平均值会只算有命中的轮次，导致偏高。
  const cacheRead = Number(u.cached_tokens ?? u.cache_read_input_tokens ?? details?.cached_tokens ?? 0) || 0;
  return { input, output, cacheRead };
}

function pushRound(state: UIState, usage: RoundUsage): Patch {
  const full: RoundUsage = { ...usage, total: usage.total ?? (usage.input + usage.output) };
  const rounds = [...state.rounds, full].slice(-HISTORY);
  // 存原始量 {cacheRead, input}，而非预算比率 ——
  // 平均缓存率必须用 sum(cacheRead)/sum(cacheRead+input) 合并计算，
  // 否则 mean-of-rates 在分母差异大的轮次间会产生显著偏差。
  // cacheRead 0 也纳入（0 缓存轮次拉低平均，反映真实命中率）。
  let cacheHistory = state.cacheHistory;
  if (usage.input > 0 || (usage.cacheRead ?? 0) > 0) {
    cacheHistory = [...state.cacheHistory, { cacheRead: usage.cacheRead ?? 0, input: usage.input }].slice(-HISTORY);
  }
  return { rounds, cacheHistory };
}

export function reduce(state: UIState, ev: StreamEvent): Patch {
  switch (ev.type) {
    // ── 会话 ──────────────────────────────────────────────
    case "session": {
      const sid = (ev.session as { id?: string } | undefined)?.id ?? (ev.sessionId as string | undefined) ?? null;
      return { sessionId: sid };
    }

    // ── 状态文本 ──────────────────────────────────────────
    case "status": {
      const text = (ev.text ?? ev.message ?? "") as string;
      return { eventBlock: { ...state.eventBlock, mode: "thinking", detail: text || undefined } };
    }

    // ── 思考增量 ──────────────────────────────────────────
    case "thinking_delta": {
      const delta = ev.delta ?? "";
      const blocks = state.messages.find(m => m.id === state.currentAssistantId)?.thinkingBlocks ?? [];
      let newBlocks: ChatMessage["thinkingBlocks"];
      const last = blocks[blocks.length - 1];
      if (last?.streaming) {
        newBlocks = [...blocks.slice(0, -1), { ...last, content: last.content + delta }];
      } else {
        newBlocks = [...blocks, { id: uid(), content: delta, streaming: true }];
      }
      return patchCurrentAssistant(state, { thinkingBlocks: newBlocks }) ?? {
        eventBlock: { ...state.eventBlock, mode: "thinking" },
      };
    }

    // ── 助手文本增量 ──────────────────────────────────────
    case "assistant_delta": {
      const delta = ev.delta ?? "";
      const id = state.currentAssistantId;
      const existing = id ? state.messages.find(m => m.id === id) : undefined;
      // 若当前消息已有 toolCalls（上一轮带工具的），新建消息流式占位，不追加到旧消息
      const shouldCreate = !id || !existing || !!existing.toolCalls?.length;
      let messages = state.messages;
      let currentAssistantId = id;
      if (shouldCreate) {
        currentAssistantId = uid();
        messages = [...messages, { id: currentAssistantId, role: "assistant", content: delta, streaming: true, ts: Date.now(), thinkingBlocks: [] }];
      } else {
        messages = messages.map(m => m.id === currentAssistantId ? { ...m, content: m.content + delta, streaming: true } : m);
      }
      return {
        messages,
        currentAssistantId,
        eventBlock: { ...state.eventBlock, mode: "generating", detail: undefined },
      };
    }

    // ── 完整助手消息（含 usage.max_context） ──────────────
    case "assistant": {
      const content = ev.content ?? "";
      const usage = parseUsage(ev.usage as Record<string, unknown> | undefined);
      const maxContext = Number((ev.usage as { max_context?: number } | undefined)?.max_context) || undefined;
      const round = ev.round ?? state.round;
      // 完整 assistant 消息：若当前占位消息是本轮流式占位则更新；否则新建。
      // 关键：若占位消息已有 toolCalls（上一轮带工具调用的消息），不能覆盖——
      // 新轮次的回复必须是独立消息，否则回复被塞进上一轮工具卡片消息，
      // 渲染时工具卡片"悬浮"在底部，回复显示顺序错乱。
      const id = state.currentAssistantId;
      const existing = id ? state.messages.find(m => m.id === id) : undefined;
      const canUpdate = existing && !existing.toolCalls?.length && existing.streaming;
      let messages = state.messages;
      if (canUpdate) {
        messages = messages.map(m => m.id === id ? {
          ...m, content: content || m.content, streaming: false,
          usage: { input: usage.input, output: usage.output, maxContext },
        } : m);
      } else {
        messages = [...messages, { id: uid(), role: "assistant", content, streaming: false, ts: Date.now(), usage: { input: usage.input, output: usage.output, maxContext } }];
      }
      const patch: Patch = {
        messages,
        currentAssistantId: null,
        maxContext: maxContext ?? state.maxContext,
      };
      // 注意：runtime 同一轮会先发 model.usage 再发 assistant，二者携带同一份 result.usage。
      // model.usage 已累计 token 到 currentRoundUsage；assistant 仅用于刷新消息展示，
      // 不应再累加，否则 input/output 会被翻倍（cacheRead 用 ?? 不翻倍 → 缓存率被压低）。
      patch.eventBlock = { ...state.eventBlock, upTokens: state.currentRoundUsage.input, downTokens: state.currentRoundUsage.output };
      return patch;
    }

    // ── 工具调用（ev.tool 是对象） ────────────────────────
    case "tool_call": {
      const tool = ev.tool as { id?: string; name: string; parameters?: Record<string, unknown> } | undefined;
      const id = state.currentAssistantId ?? uid();
      let messages = state.messages;
      if (!state.currentAssistantId || !messages.find(m => m.id === id)) {
        messages = [...messages, { id, role: "assistant", content: "", streaming: true, ts: Date.now(), thinkingBlocks: [] }];
      }
      const tc: ToolCardState = {
        id: tool?.id ?? uid(),
        name: tool?.name ?? "?",
        args: JSON.stringify(tool?.parameters ?? {}),
        done: false,
      };
      messages = messages.map(m => m.id === id ? { ...m, toolCalls: [...(m.toolCalls ?? []), tc] } : m);
      return {
        messages,
        currentAssistantId: id,
        eventBlock: { ...state.eventBlock, mode: "tool_pending", detail: tc.name },
      };
    }

    // ── 工具结果（toolCallId/name/content/ok 是顶层！） ───
    case "tool_result": {
      const toolCallId = ev.toolCallId as string | undefined;
      const name = ev.name as string | undefined;
      const content = typeof ev.content === "string" ? ev.content : JSON.stringify(ev.content ?? "");
      const ok = ev.ok !== false;
      const messages = state.messages.map(m => m.toolCalls ? {
        ...m,
        toolCalls: m.toolCalls.map(tc =>
          (tc.id === toolCallId || (!toolCallId && tc.name === name && !tc.done))
            ? { ...tc, result: content.slice(0, MAX_RESULT), isError: !ok, done: true }
            : tc
        ),
      } : m);
      return { messages, eventBlock: { ...state.eventBlock, mode: ok ? "generating" : "error", detail: name } };
    }

    // ── 工具待执行 ────────────────────────────────────────
    case "tool_pending": {
      const tool = ev.tool as { name?: string } | undefined;
      return { eventBlock: { ...state.eventBlock, mode: "tool_pending", detail: tool?.name } };
    }

    // ── model.usage（裸 usage，不含 max_context） ─────────
    case "model.usage": {
      const usage = parseUsage(ev.usage as Record<string, unknown> | undefined);
      const cur = state.currentRoundUsage;
      // cacheRead 也累加（多步轮次：agent 模式下一轮可能多次 LLM 调用，每次都有 cache）。
      // 之前用 ?? 会丢弃前几次的 cache，导致缓存率偏低。
      const merged: RoundUsage = {
        input: cur.input + usage.input,
        output: cur.output + usage.output,
        cacheRead: (cur.cacheRead ?? 0) + (usage.cacheRead ?? 0),
      };
      return {
        currentRoundUsage: merged,
        eventBlock: { ...state.eventBlock, upTokens: merged.input, downTokens: merged.output },
      };
    }

    // ── 轮次 ──────────────────────────────────────────────
    case "agent_round": {
      const round = ev.round ?? state.round + 1;
      // 上一轮结束，归档 usage 到 rounds 历史，重置当前轮
      const patch = pushRound(state, state.currentRoundUsage);
      return { round, currentRoundUsage: { input: 0, output: 0 }, ...patch };
    }

    // ── log（带 level）vs info（无 level） ────────────────
    case "log": {
      const level = ev.level as string | undefined;
      const message = ev.message as string | undefined;
      if (level === "error") return { toast: { text: (message ?? "").slice(0, 80), kind: "err" } };
      if (level === "warning" || level === "warn") return { toast: { text: (message ?? "").slice(0, 80), kind: "warn" } };
      return {}; // info/debug 静默
    }
    case "info": {
      const message = ev.message as string | undefined;
      // "已中断" 等运行时信息
      return { eventBlock: { ...state.eventBlock, detail: message } };
    }

    // ── trace 类（toast 提示或静默） ──────────────────────
    case "model.error": {
      const err = (ev.error as string | undefined) ?? (ev.message as string | undefined) ?? "模型错误";
      return { toast: { text: err.slice(0, 80), kind: "err" } };
    }
    case "model.loop_detected": {
      return { toast: { text: "循环输出，重试中", kind: "warn" } };
    }
    case "model.tool_detected": {
      return {}; // 已有 tool_pending 跟进
    }
    case "round_limit": {
      return { toast: { text: (ev.message as string | undefined) ?? "轮次上限", kind: "warn" } };
    }
    case "verification": {
      return { eventBlock: { ...state.eventBlock, detail: ev.ok ? "验证通过" : "验证失败" } };
    }
    case "loop_check": {
      return {};
    }

    // ── 结束 ──────────────────────────────────────────────
    case "done": {
      // 归档本轮 usage
      const roundPatch = state.currentRoundUsage.input || state.currentRoundUsage.output
        ? pushRound(state, state.currentRoundUsage)
        : {};
      const messages = state.messages.map(m =>
        m.id === state.currentAssistantId || m.streaming
          ? { ...m, streaming: false }
          : m
      );
      // 关闭所有 thinkingBlock 流式
      const messagesClosed = messages.map(m => m.thinkingBlocks ? {
        ...m, thinkingBlocks: m.thinkingBlocks.map(b => ({ ...b, streaming: false })),
      } : m);
      // round：runtime done 事件的 rounds 字段硬编码 0（已知 bug），不可靠。
      // 优先用 agent_round 累加的 state.round；仅当 ev.rounds 更大时采用。
      const evRounds = ev.rounds as number | undefined;
      const round = typeof evRounds === "number" && evRounds > state.round ? evRounds : state.round;
      return {
        ...roundPatch,
        messages: messagesClosed,
        streaming: false,
        aborting: false,
        currentAssistantId: null,
        round,
        currentRoundUsage: { input: 0, output: 0 },
        eventBlock: { mode: "idle", upTokens: 0, downTokens: 0, detail: undefined },
      };
    }
    case "error": {
      // 陷阱①：error 后 runAgentCli 即 return，必须这里置 streaming:false
      const msg = typeof ev.message === "string" ? ev.message : String(ev.message ?? "错误");
      const messages = state.messages.map(m => m.streaming ? { ...m, streaming: false } : m);
      return {
        messages,
        streaming: false,
        aborting: false,
        currentAssistantId: null,
        toast: { text: msg.slice(0, 80), kind: "err" },
        eventBlock: { mode: "error", upTokens: 0, downTokens: 0, detail: msg.slice(0, 40) },
      };
    }

    // ── 静默 drop（trace/调试，信息密度优先） ─────────────
    case "model.request":
    case "model.response.raw":
    case "raw_response":
    case "field_complete":
    case "field_streaming":
    case "queue_delivered":
    case "profile":
      return {};

    default:
      return {};
  }
}

/** 把 patch 应用到当前 assistant 消息（thinking_delta 用） */
function patchCurrentAssistant(state: UIState, patch: Partial<ChatMessage>): Patch | null {
  const id = state.currentAssistantId;
  if (!id || !state.messages.find(m => m.id === id)) return null;
  const messages = state.messages.map(m => m.id === id ? { ...m, ...patch } : m);
  return { messages };
}
