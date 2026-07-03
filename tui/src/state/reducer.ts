/**
 * 事件 reducer —— 纯函数 (state, StreamEvent) => Partial<UIState>。
 *
 * 直接移植自 cli/src/state/reducer.ts（已验证 27 type + 陷阱①-⑤），仅做
 * 去 zustand 化：返回 Partial<UIState>，由 app 用 {...state, ...patch} 合并
 * 后调 tui.requestRender()。
 *
 * 重点陷阱已处理：
 *  ① error 后置 streaming:false（runAgentCli 遇 error 即 return，收不到后续 done）
 *  ② log（带 level）vs info（无 level）分流
 *  ③ model.usage 裸 {usage} 累计 token；assistant.usage 含 max_context 更新窗口
 *  ④ tool_call.tool 是对象；tool_result 的 toolCallId/name/content/ok 是顶层
 *  ⑤ session 是 Session 对象，取 .id
 *
 * toast 字段比 cli 多 expiresAt（app 无 React effect 自动清除，故带时间戳）。
 */

import type { StreamEvent } from "@little-house-studio/types";
import type { UIState, ChatMessage, Block, RoundUsage, Toast } from "./types.js";

let idc = 0;
export const uid = (): string => `m${Date.now()}_${idc++}`;

type Patch = Partial<UIState>;

const MAX_RESULT = 2000;
const HISTORY = 20;
const TOAST_TTL = 4000; // ms

function makeToast(text: string, kind: Toast["kind"]): Toast {
  return { text: text.slice(0, 80), kind, expiresAt: Date.now() + TOAST_TTL };
}

/** 从 usage 对象取 input/output/cacheRead token（兼容各家字段名） */
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
      return patchCurrentAssistantBlocks(state, blocks => {
        const last = blocks[blocks.length - 1];
        if (last?.type === "thinking" && last.streaming) {
          return [...blocks.slice(0, -1), { ...last, content: last.content + delta }];
        }
        return [...blocks, { type: "thinking", id: uid(), content: delta, streaming: true }];
      }) ?? { eventBlock: { ...state.eventBlock, mode: "thinking" } };
    }

    // ── 助手文本增量 ──────────────────────────────────────
    case "assistant_delta": {
      const delta = ev.delta ?? "";
      const id = state.currentAssistantId;
      let messages = state.messages;
      let currentAssistantId = id;
      if (!id || !messages.find(m => m.id === id)) {
        currentAssistantId = uid();
        messages = [...messages, { id: currentAssistantId, role: "assistant", blocks: [], streaming: true, ts: Date.now() }];
      }
      messages = messages.map(m => m.id === currentAssistantId ? {
        ...m,
        blocks: appendTextBlock(m.blocks, delta),
        streaming: true,
      } : m);
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
      const id = state.currentAssistantId;
      let messages = state.messages;
      if (id && messages.find(m => m.id === id)) {
        messages = messages.map(m => m.id === id ? {
          ...m,
          blocks: content ? finalizeTextBlocks(m.blocks, content) : m.blocks,
          streaming: false,
          usage: { input: usage.input, output: usage.output, maxContext },
        } : m);
      } else {
        messages = [...messages, { id: uid(), role: "assistant", blocks: content ? [{ type: "text", content }] : [], streaming: false, ts: Date.now(), usage: { input: usage.input, output: usage.output, maxContext } }];
      }
      const patch: Patch = {
        messages,
        // 轮内 assistant 事件不清 currentAssistantId——同一轮多次 LLM 调用（工具间）
        // 后续 assistant_delta 应复用同一消息，避免创建多条空 ai 消息。
        // currentAssistantId 只在 done 事件清。
        maxContext: maxContext ?? state.maxContext,
      };
      const cur = state.currentRoundUsage;
      // 注意：runtime 同一轮会先发 model.usage 再发 assistant，二者携带同一份 result.usage。
      // model.usage 已累计 token 到 currentRoundUsage；assistant 仅用于刷新消息展示，
      // 不应再累加，否则 input/output 会被翻倍（cacheRead 用 ?? 不翻倍 → 缓存率被压低）。
      patch.eventBlock = { ...state.eventBlock, upTokens: cur.input, downTokens: cur.output };
      void round;
      return patch;
    }

    // ── 工具调用（ev.tool 是对象） ────────────────────────
    case "tool_call": {
      const tool = ev.tool as { id?: string; name: string; parameters?: Record<string, unknown> } | undefined;
      const id = state.currentAssistantId ?? uid();
      let messages = state.messages;
      if (!state.currentAssistantId || !messages.find(m => m.id === id)) {
        messages = [...messages, { id, role: "assistant", blocks: [], streaming: true, ts: Date.now() }];
      }
      const toolBlock: Block = {
        type: "tool",
        id: tool?.id ?? uid(),
        name: tool?.name ?? "?",
        args: JSON.stringify(tool?.parameters ?? {}),
        done: false,
      };
      messages = messages.map(m => m.id === id ? { ...m, blocks: [...m.blocks, toolBlock] } : m);
      return {
        messages,
        currentAssistantId: id,
        eventBlock: { ...state.eventBlock, mode: "tool_pending", detail: toolBlock.name },
      };
    }

    // ── 工具结果（toolCallId/name/content/ok 是顶层！） ───
    case "tool_result": {
      const toolCallId = ev.toolCallId as string | undefined;
      const name = ev.name as string | undefined;
      const content = typeof ev.content === "string" ? ev.content : JSON.stringify(ev.content ?? "");
      const ok = ev.ok !== false;
      const messages = state.messages.map(m => ({
        ...m,
        blocks: m.blocks.map(b =>
          (b.type === "tool" && (b.id === toolCallId || (!toolCallId && b.name === name && !b.done)))
            ? { ...b, result: content.slice(0, MAX_RESULT), isError: !ok, done: true }
            : b
        ),
      }));
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
      if (level === "error") return { toast: makeToast(message ?? "", "err") };
      if (level === "warning" || level === "warn") return { toast: makeToast(message ?? "", "warn") };
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
      return { toast: makeToast(err, "err") };
    }
    case "model.loop_detected": {
      return { toast: makeToast("循环输出，重试中", "warn") };
    }
    case "model.tool_detected": {
      return {}; // 已有 tool_pending 跟进
    }
    case "round_limit": {
      return { toast: makeToast((ev.message as string | undefined) ?? "轮次上限", "warn") };
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
      // 关闭所有 thinking block 流式
      const messagesClosed = messages.map(m => ({
        ...m,
        blocks: m.blocks.map(b => b.type === "thinking" ? { ...b, streaming: false } : b),
      }));
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
        toast: makeToast(msg, "err"),
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

/** 把 blocks 更新应用到当前 assistant 消息（thinking_delta 用） */
function patchCurrentAssistantBlocks(state: UIState, updater: (blocks: Block[]) => Block[]): Patch | null {
  const id = state.currentAssistantId;
  if (!id || !state.messages.find(m => m.id === id)) return null;
  const messages = state.messages.map(m => m.id === id ? { ...m, blocks: updater(m.blocks) } : m);
  return { messages };
}

/** 追加文本到末尾 text block；若末尾非 text 则新建 text block（保证 tool/thinking 后的文本穿插） */
function appendTextBlock(blocks: Block[], delta: string): Block[] {
  const last = blocks[blocks.length - 1];
  if (last?.type === "text") {
    return [...blocks.slice(0, -1), { type: "text", content: last.content + delta }];
  }
  return [...blocks, { type: "text", content: delta }];
}

/** 完整 assistant 消息收尾：用最终 content 替换末尾 text block（若无 text block 则追加） */
function finalizeTextBlocks(blocks: Block[], content: string): Block[] {
  const last = blocks[blocks.length - 1];
  if (last?.type === "text") {
    return [...blocks.slice(0, -1), { type: "text", content }];
  }
  return [...blocks, { type: "text", content }];
}
