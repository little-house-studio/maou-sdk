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
import type { UIState, ChatMessage, ToolCardState, RoundUsage, SystemEvent } from "./types.js";
import { TOAST_TEXT_MAX } from "../config/ui-constants.js";
import {
  isMainAgentMainModelUsage,
  modelReportsPromptCache,
  cacheHistoryFromEventCache,
  loadCacheHistoryFromLedger,
} from "../lib/prompt-cache.js";

let idc = 0;
export const uid = (): string => `m${Date.now()}_${idc++}`;

type Patch = Partial<UIState>;

/** 工具结果完整保留，UI 层 Collapsible 负责折叠（过短截断会导致展开仍看不全） */
const MAX_RESULT = 500_000;
const HISTORY = 20;

function clipToast(s: string): string {
  return s.slice(0, TOAST_TEXT_MAX);
}

/**
 * 思考结束：把仍 streaming 的 thinking 块收尾。
 * 正文 / 工具开始时就必须 seal，否则 UI 一直当「思考中」展开全文。
 */
function sealThinkingBlocks(
  blocks: ChatMessage["thinkingBlocks"] | undefined,
  now = Date.now(),
): ChatMessage["thinkingBlocks"] | undefined {
  if (!blocks?.length) return blocks;
  let changed = false;
  const next = blocks.map((b) => {
    if (!b.streaming) return b;
    changed = true;
    return {
      ...b,
      streaming: false,
      duration: b.duration ?? (b.startTs ? now - b.startTs : undefined),
    };
  });
  return changed ? next : blocks;
}

/** 给一条消息 seal thinking；未变则返回原引用 */
function sealMessageThinking(m: ChatMessage, now = Date.now()): ChatMessage {
  const sealed = sealThinkingBlocks(m.thinkingBlocks, now);
  return sealed === m.thinkingBlocks ? m : { ...m, thinkingBlocks: sealed };
}

/** 从 usage 对象取 input/output token（兼容各家字段名） */
function parseUsage(u: Record<string, unknown> | undefined): { input: number; output: number; cacheRead?: number } {
  if (!u) return { input: 0, output: 0 };
  const input = Number(u.prompt_tokens ?? u.input_tokens ?? u.inputTokens ?? 0) || 0;
  const output = Number(u.completion_tokens ?? u.output_tokens ?? u.outputTokens ?? 0) || 0;
  const details = u.prompt_tokens_details as { cached_tokens?: number } | undefined;
  const cacheRead = Number(u.cached_tokens ?? u.cache_read_input_tokens ?? details?.cached_tokens ?? 0) || 0;
  return { input, output, cacheRead };
}

/**
 * 归档一轮 token 到 rounds。
 * cacheHistory 优先镜像 agent 层 PromptCacheLedger 快照（event.cache）；
 * 无 snapshot 时回退本地累加（兼容旧事件/测试）。
 */
function pushRound(
  state: UIState,
  usage: RoundUsage,
  eventCache?: unknown,
): Patch {
  const full: RoundUsage = { ...usage, total: usage.total ?? (usage.input + usage.output) };
  const rounds = [...state.rounds, full].slice(-HISTORY);
  const fromAgent = cacheHistoryFromEventCache(eventCache);
  let cacheHistory = state.cacheHistory;
  if (fromAgent) {
    cacheHistory = fromAgent;
  } else {
    // 回退：仅主模型且支持 cache 时本地 append
    const eligible =
      usage.cacheEligible === true &&
      modelReportsPromptCache(state.model, state.provider) &&
      (usage.input > 0 || (usage.cacheRead ?? 0) > 0);
    if (eligible) {
      cacheHistory = [
        ...state.cacheHistory,
        { cacheRead: usage.cacheRead ?? 0, input: usage.input, model: state.model || undefined },
      ].slice(-HISTORY);
    }
  }
  return { rounds, cacheHistory };
}

export function reduce(state: UIState, ev: StreamEvent): Patch {
  // /goal 监督模式：supervisor session 的事件进 supervisorMessages（不进主对话区，避免混乱）
  // 用 ev.sessionId 判断来源——supervisor run 的 event sessionId 是 supervisorSessionId
  const evSessionId = (ev.session as { id?: string } | undefined)?.id ?? (ev.sessionId as string | undefined) ?? null;
  const isSupervisorEv = !!state.supervisor?.supervisorSessionId && evSessionId === state.supervisor.supervisorSessionId;

  // supervisor 事件：简化追加到 supervisorMessages（不参与主 messages 的流式占位/工具卡片逻辑）
  if (isSupervisorEv && (ev.type === "assistant" || ev.type === "assistant_delta" || ev.type === "tool_call" || ev.type === "tool_result")) {
    const content = (ev.type === "assistant_delta" ? (ev.delta ?? "") : (ev.content ?? "")) as string;
    if (content) {
      const last = state.supervisorMessages[state.supervisorMessages.length - 1];
      // delta 追加到上一条 streaming 的；否则新建
      if (ev.type === "assistant_delta" && last?.streaming) {
        return { supervisorMessages: [...state.supervisorMessages.slice(0, -1), { ...last, content: last.content + content }] };
      }
      return { supervisorMessages: [...state.supervisorMessages, { id: `s${Date.now()}_${Math.random().toString(36).slice(2,6)}`, role: "assistant", content, ts: Date.now(), streaming: ev.type === "assistant_delta" }] };
    }
    if (ev.type === "tool_call" || ev.type === "tool_result") {
      const name = (ev as { name?: string }).name ?? "tool";
      const tc = ev.type === "tool_result" ? `  ↳ ${(ev as { content?: string }).content?.slice(0, 100) ?? ""}` : `▸ ${name}`;
      return { supervisorMessages: [...state.supervisorMessages, { id: `s${Date.now()}_${Math.random().toString(36).slice(2,6)}`, role: "assistant", content: tc, ts: Date.now() }] };
    }
    return {};
  }

  switch (ev.type) {
    // ── 会话 ──────────────────────────────────────────────
    case "session": {
      const sid = (ev.session as { id?: string } | undefined)?.id ?? (ev.sessionId as string | undefined) ?? null;
      return { sessionId: sid };
    }

    // ── 会话注入（非真人消息：bus / continue / verify / notice）──
    // 不进用户气泡，进 systemEvents 行
    case "session_inject": {
      const kindRaw = String(ev.kind ?? "session_inject");
      const sysKind: SystemEvent["kind"] =
        kindRaw === "agent_message" || kindRaw === "runtime_control" || kindRaw === "system_notice"
          ? kindRaw
          : "session_inject";
      const author = ev.author as { type?: string; id?: string; displayName?: string } | undefined;
      const who =
        author?.type === "agent" ? `agent:${author.displayName || author.id || "?"}` :
        author?.type === "system" ? `system:${author.displayName || author.id || "?"}` :
        author?.type === "tool" ? `tool:${author.displayName || author.id || "?"}` :
        sysKind;
      const raw = String(ev.content ?? ev.message ?? kindRaw).slice(0, 160);
      const content = `${who} · ${raw}`;
      const sysEvent: SystemEvent = {
        id: uid(),
        kind: sysKind,
        content,
        ts: Date.now(),
        detail: typeof ev.detail === "string" ? ev.detail : undefined,
      };
      return { systemEvents: [...state.systemEvents, sysEvent] };
    }

    // ── 状态文本 ──────────────────────────────────────────
    case "status": {
      const text = (ev.text ?? ev.message ?? "") as string;
      const isRetry = /重试|retry|loop.?detect/i.test(text);
      return {
        eventBlock: {
          ...state.eventBlock,
          mode: isRetry ? "retrying" : "thinking",
          detail: text || undefined,
        },
      };
    }

    // ── 思考增量 ──────────────────────────────────────────
    // 若尚无 assistant 占位（思考常先于正文到达），先建一条空 assistant，避免 thinking 被丢掉
    case "thinking_delta": {
      const delta = String(ev.delta ?? "");
      if (!delta) return { eventBlock: { ...state.eventBlock, mode: "thinking" } };

      let messages = state.messages;
      let currentAssistantId = state.currentAssistantId;
      let existing = currentAssistantId
        ? messages.find((m) => m.id === currentAssistantId)
        : undefined;

      // 当前占位已带 toolCalls → 说明是上一轮工具消息，思考属于新一轮
      if (existing?.toolCalls?.length) {
        existing = undefined;
        currentAssistantId = null;
      }
      if (!currentAssistantId || !existing) {
        currentAssistantId = uid();
        existing = {
          id: currentAssistantId,
          role: "assistant",
          content: "",
          streaming: true,
          ts: Date.now(),
          thinkingBlocks: [],
          round: state.round + 1,
          kind: "assistant_turn",
          author: { type: "agent", id: "ai", displayName: "ai" },
        };
        messages = [...messages, existing];
      }

      const blocks = existing.thinkingBlocks ?? [];
      const last = blocks[blocks.length - 1];
      const newBlocks =
        last?.streaming
          ? [...blocks.slice(0, -1), { ...last, content: last.content + delta }]
          : [...blocks, { id: uid(), content: delta, streaming: true, startTs: Date.now() }];

      messages = messages.map((m) =>
        m.id === currentAssistantId ? { ...m, thinkingBlocks: newBlocks, streaming: true } : m,
      );
      return {
        messages,
        currentAssistantId,
        eventBlock: { ...state.eventBlock, mode: "thinking", detail: "思考中…" },
      };
    }

    // ── 助手文本增量 ──────────────────────────────────────
    case "assistant_delta": {
      const delta = ev.delta ?? "";
      const id = state.currentAssistantId;
      const existing = id ? state.messages.find(m => m.id === id) : undefined;
      // 仅当「上一轮已收口」（不在 streaming 且已有工具）才新开消息；
      // 本轮仍 streaming 时即使已有工具也继续写同一条，避免 LIVE+完成双份。
      const shouldCreate =
        !id ||
        !existing ||
        (!existing.streaming && (existing.toolCalls?.length ?? 0) > 0);
      let messages = state.messages;
      let currentAssistantId = id;
      const nowTs = Date.now();
      if (shouldCreate) {
        // 新正文轮：上一轮占位上的 thinking 先收尾（若还挂着）
        if (existing?.thinkingBlocks?.some((b) => b.streaming)) {
          messages = messages.map((m) =>
            m.id === existing.id ? sealMessageThinking(m, nowTs) : m,
          );
        }
        currentAssistantId = uid();
        messages = [...messages, { id: currentAssistantId, role: "assistant", content: delta, streaming: true, ts: nowTs, thinkingBlocks: [], round: state.round + 1 }];
      } else {
        // 同一条消息：正文开始 → 立刻 seal thinking（收成一行标识）
        messages = messages.map((m) => {
          if (m.id !== currentAssistantId) return m;
          const sealed = sealThinkingBlocks(m.thinkingBlocks, nowTs);
          return {
            ...m,
            content: m.content + delta,
            streaming: true,
            thinkingBlocks: sealed,
          };
        });
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
      // runtime 顺序：先 assistant 完整事件，再 processToolCalls。
      // 若本轮还有工具，必须保留 currentAssistantId，否则 tool_call 会另开空消息 → 双份 UI。
      const nativeTools = (ev as { nativeToolCalls?: unknown[] }).nativeToolCalls;
      const hasFollowOnTools = Array.isArray(nativeTools) && nativeTools.length > 0;

      const id = state.currentAssistantId;
      const existing = id ? state.messages.find(m => m.id === id) : undefined;
      // 可更新：当前槽仍是本轮（streaming，或尚无工具的思考/正文占位）
      const canUpdate =
        !!existing &&
        (existing.streaming || !(existing.toolCalls?.length) || !!existing.thinkingBlocks?.length);
      let messages = state.messages;
      const nowTs = Date.now();
      let slotId = id;

      if (canUpdate && id) {
        messages = messages.map(m => m.id === id ? {
          ...m,
          content: content || m.content,
          // 后面还有工具 → 保持 LIVE；否则本轮文案结束
          streaming: hasFollowOnTools ? true : false,
          usage: { input: usage.input, output: usage.output, maxContext },
          thinkingBlocks: sealThinkingBlocks(m.thinkingBlocks, nowTs),
          round: m.round ?? round,
        } : m);
        slotId = id;
      } else {
        // 无可用占位：新建。若 content 与最近一条 assistant 完全相同则合并，防重放双份
        const lastAsst = [...messages].reverse().find((m) => m.role === "assistant");
        if (
          lastAsst &&
          content &&
          lastAsst.content === content &&
          !lastAsst.toolCalls?.length
        ) {
          messages = messages.map((m) =>
            m.id === lastAsst.id
              ? {
                  ...m,
                  streaming: hasFollowOnTools ? true : false,
                  usage: { input: usage.input, output: usage.output, maxContext },
                  thinkingBlocks: sealThinkingBlocks(m.thinkingBlocks, nowTs),
                }
              : m,
          );
          slotId = lastAsst.id;
        } else {
          slotId = uid();
          messages = [...messages, {
            id: slotId,
            role: "assistant",
            content,
            streaming: hasFollowOnTools ? true : false,
            ts: nowTs,
            usage: { input: usage.input, output: usage.output, maxContext },
            thinkingBlocks: sealThinkingBlocks(
              existing?.thinkingBlocks?.length ? existing.thinkingBlocks : undefined,
              nowTs,
            ),
            kind: "assistant_turn",
            author: { type: "agent", id: "ai", displayName: "ai" },
            round,
          }];
        }
      }
      const patch: Patch = {
        messages,
        // 有后续工具则保留槽位，供 tool_call 挂载
        currentAssistantId: hasFollowOnTools ? slotId : null,
        maxContext: maxContext ?? state.maxContext,
      };
      // 注意：runtime 同一轮会先发 model.usage 再发 assistant，二者携带同一份 result.usage。
      // model.usage 已累计 token 到 currentRoundUsage；assistant 仅用于刷新消息展示，
      // 不应再累加，否则 input/output 会被翻倍（cacheRead 用 ?? 不翻倍 → 缓存率被压低）。
      patch.eventBlock = { ...state.eventBlock, upTokens: state.currentRoundUsage.input, downTokens: state.currentRoundUsage.output };
      return patch;
    }

    // ── 工具调用（ev.tool 是对象） ────────────────────────
    // 注意：runtime 会在执行前先 announce tool_call，执行完再 tool_result。
    // 若已有同 id 卡（重复 announce / 重放）不重复加。
    case "tool_call": {
      const tool = ev.tool as { id?: string; name: string; parameters?: Record<string, unknown> } | undefined;
      let messages = state.messages;
      const nowTs = Date.now();

      // 解析挂载目标：currentAssistantId → 最近一条 assistant（防 assistant 清槽后工具另开）
      let id = state.currentAssistantId ?? null;
      if (!id || !messages.find((m) => m.id === id)) {
        const lastAsst = [...messages].reverse().find((m) => m.role === "assistant");
        id = lastAsst?.id ?? null;
      }
      if (!id) {
        id = uid();
        messages = [
          ...messages.map((m) => sealMessageThinking(m, nowTs)),
          { id, role: "assistant", content: "", streaming: true, ts: nowTs, thinkingBlocks: [] },
        ];
      }

      const tcId = tool?.id ?? uid();
      const tcName = tool?.name ?? "?";
      // 已有同 id，或同名未完成的 pending 预检卡 → 升级/更新，不重复插
      let already = false;
      messages = messages.map((m) => {
        if (m.id !== id) return m;
        // 工具开始 = 思考已结束，先 seal
        const sealedBlocks = sealThinkingBlocks(m.thinkingBlocks, nowTs);
        const list = m.toolCalls ?? [];
        let idx = list.findIndex((t) => t.id === tcId);
        if (idx < 0) {
          idx = list.findIndex(
            (t) =>
              !t.done &&
              t.name === tcName &&
              (t.id.startsWith("pending_") || !t.result),
          );
        }
        // 再兜底：同名且 args 相同的未完成卡（防 announce 双 id）
        if (idx < 0) {
          const argsStr = JSON.stringify(tool?.parameters ?? {});
          idx = list.findIndex(
            (t) => !t.done && t.name === tcName && t.args === argsStr,
          );
        }
        if (idx >= 0) {
          already = true;
          const next = list.slice();
          next[idx] = {
            ...next[idx]!,
            id: tcId, // 预检卡升级为真实 id
            name: tcName,
            args: JSON.stringify(tool?.parameters ?? {}),
            done: false,
            callStartTs: next[idx]!.callStartTs ?? nowTs,
          };
          return { ...m, toolCalls: next, streaming: true, thinkingBlocks: sealedBlocks };
        }
        return {
          ...m,
          thinkingBlocks: sealedBlocks,
          streaming: true,
        };
      });
      if (!already) {
        const tc: ToolCardState = {
          id: tcId,
          name: tcName,
          args: JSON.stringify(tool?.parameters ?? {}),
          done: false,
          callStartTs: nowTs,
        };
        messages = messages.map((m) =>
          m.id === id
            ? {
                ...m,
                toolCalls: [...(m.toolCalls ?? []), tc],
                streaming: true,
                thinkingBlocks: sealThinkingBlocks(m.thinkingBlocks, nowTs),
              }
            : m,
        );
      }
      return {
        messages,
        currentAssistantId: id,
        streaming: true,
        eventBlock: { ...state.eventBlock, mode: "tool_pending", detail: tcName },
      };
    }

    // ── 工具结果（toolCallId/name/content/ok 是顶层！） ───
    case "tool_result": {
      const toolCallId = ev.toolCallId as string | undefined;
      const name = ev.name as string | undefined;
      const content = typeof ev.content === "string" ? ev.content : JSON.stringify(ev.content ?? "");
      const ok = ev.ok !== false;
      const now = Date.now();
      // 若只有 result、没有事先的 tool_call（旧路径/后台补发），补一张已完成卡
      let matched = false;
      let messages = state.messages.map((m) => {
        if (!m.toolCalls?.length) return m;
        const next = m.toolCalls.map((tc) => {
          if (tc.id === toolCallId || (!toolCallId && tc.name === name && !tc.done)) {
            matched = true;
            return {
              ...tc,
              result: content.slice(0, MAX_RESULT),
              isError: !ok,
              done: true,
              callDuration: tc.callStartTs ? now - tc.callStartTs : undefined,
            };
          }
          return tc;
        });
        if (next === m.toolCalls) return m;
        // 本消息上所有工具都结束 → 收口 streaming，避免下一条又叠 LIVE
        const allDone = next.every((t) => t.done);
        return { ...m, toolCalls: next, streaming: allDone ? false : m.streaming };
      });
      if (!matched && (toolCallId || name)) {
        // 优先挂到最近 assistant，不新开空消息
        let id = state.currentAssistantId ?? null;
        if (!id || !messages.find((m) => m.id === id)) {
          id = [...messages].reverse().find((m) => m.role === "assistant")?.id ?? null;
        }
        if (!id) {
          id = uid();
          messages = [
            ...messages,
            { id, role: "assistant", content: "", streaming: false, ts: now, thinkingBlocks: [] },
          ];
        }
        const tc: ToolCardState = {
          id: toolCallId ?? uid(),
          name: name ?? "?",
          args: "{}",
          result: content.slice(0, MAX_RESULT),
          isError: !ok,
          done: true,
          callStartTs: now,
          callDuration: 0,
        };
        messages = messages.map((m) => {
          if (m.id !== id) return m;
          const list = [...(m.toolCalls ?? []), tc];
          const allDone = list.every((t) => t.done);
          return { ...m, toolCalls: list, streaming: allDone ? false : true };
        });
        return {
          messages,
          currentAssistantId: id,
          eventBlock: { ...state.eventBlock, mode: ok ? "generating" : "error", detail: name },
        };
      }
      return { messages, eventBlock: { ...state.eventBlock, mode: ok ? "generating" : "error", detail: name } };
    }

    // ── 工具待执行（模型流式中预检到 tool 字段） ──────────
    // 只更新状态栏；若带 name 且尚无进行中卡，补一张 pending 卡（意图先于完整 tool_call）
    case "tool_pending": {
      const tool = ev.tool as { name?: string; id?: string; parameters?: Record<string, unknown> } | undefined;
      const name = tool?.name;
      if (!name) {
        return { eventBlock: { ...state.eventBlock, mode: "tool_pending", detail: undefined } };
      }
      const id = state.currentAssistantId ?? uid();
      let messages = state.messages;
      if (!state.currentAssistantId || !messages.find((m) => m.id === id)) {
        messages = [
          ...messages,
          { id, role: "assistant", content: "", streaming: true, ts: Date.now(), thinkingBlocks: [] },
        ];
      }
      const hasPending = messages.some(
        (m) =>
          m.id === id &&
          m.toolCalls?.some((t) => !t.done && (t.name === name || (tool?.id && t.id === tool.id))),
      );
      if (!hasPending) {
        const tc: ToolCardState = {
          id: tool?.id ?? `pending_${name}_${Date.now().toString(36)}`,
          name,
          args: JSON.stringify(tool?.parameters ?? {}),
          done: false,
          callStartTs: Date.now(),
        };
        messages = messages.map((m) =>
          m.id === id
            ? { ...m, toolCalls: [...(m.toolCalls ?? []), tc], streaming: true }
            : m,
        );
      }
      return {
        messages,
        currentAssistantId: id,
        streaming: true,
        eventBlock: { ...state.eventBlock, mode: "tool_pending", detail: name },
      };
    }

    // ── model.usage（裸 usage，不含 max_context） ─────────
    // 仅累计「当前会话主 agent 的主模型」；分桶权威在 agent PromptCacheLedger。
    case "model.usage": {
      if (isSupervisorEv) return {};
      const evRec = ev as Record<string, unknown>;
      const usageModel = String(evRec.model ?? "");
      const usageAgent = String(evRec.agentName ?? evRec.agent_name ?? "");
      const usageRole = String(evRec.role ?? "main");
      if (
        !isMainAgentMainModelUsage({
          role: usageRole,
          usageModel: usageModel || state.model,
          mainModel: state.model,
          agentName: usageAgent || state.agentName,
          mainAgentName: state.agentName,
        })
      ) {
        return {};
      }

      const usage = parseUsage(ev.usage as Record<string, unknown> | undefined);
      const cur = state.currentRoundUsage;
      const eligible = modelReportsPromptCache(usageModel || state.model, state.provider);
      const merged: RoundUsage = {
        input: cur.input + usage.input,
        output: cur.output + usage.output,
        cacheRead: eligible
          ? (cur.cacheRead ?? 0) + (usage.cacheRead ?? 0)
          : (cur.cacheRead ?? 0),
        cacheEligible: eligible || cur.cacheEligible === true,
      };
      // 镜像 agent 层 samples（未 seal 的 current 不在 samples 里，history 仍是已封印轮次）
      const fromAgent = cacheHistoryFromEventCache(evRec.cache);
      return {
        currentRoundUsage: merged,
        ...(fromAgent ? { cacheHistory: fromAgent } : {}),
        eventBlock: { ...state.eventBlock, upTokens: merged.input, downTokens: merged.output },
      };
    }

    // ── 主模型切换：切到新桶（旧桶留在 agent ledger，可恢复）──
    case "model_switched": {
      const nextModel = String((ev as { model?: string }).model ?? state.model);
      const { cacheHistory } = loadCacheHistoryFromLedger(
        state.agentName,
        state.sessionId,
        nextModel || state.model,
      );
      return {
        model: nextModel || state.model,
        cacheHistory,
        currentRoundUsage: { input: 0, output: 0 },
      };
    }

    // ── 轮次 ──────────────────────────────────────────────
    case "agent_round": {
      const round = ev.round ?? state.round + 1;
      // agent 层已 seal；event.cache 为封印后快照。CLI 归档 token + 镜像 samples。
      const patch = pushRound(state, state.currentRoundUsage, (ev as { cache?: unknown }).cache);
      return { round, currentRoundUsage: { input: 0, output: 0 }, ...patch };
    }

    // ── log（带 level）vs info（无 level） ────────────────
    case "log": {
      const level = ev.level as string | undefined;
      const message = (ev.message as string | undefined) ?? "";
      // 压缩报告 → 一行黄色系统事件；展开 detail 看阶段 token / 摘要
      if (
        message.includes("上下文已压缩") ||
        message.includes("ContextEngine] 压缩失败") ||
        message.includes("压缩失败，本轮跳过")
      ) {
        const oneLine = message
          .replace(/^\[ContextEngine\]\s*/, "")
          .split("\n")[0]!
          .trim();
        // SDK 经 log.detail 下发压缩摘要；无则回退整段 message
        const detailField = (ev as { detail?: unknown }).detail;
        const detailRaw =
          typeof detailField === "string" ? detailField : message;
        const sysEvent: SystemEvent = {
          id: uid(),
          kind: "compress",
          // 一行标题放宽，避免 token 数字被 clip 掉
          content: oneLine.length > 140 ? oneLine.slice(0, 137) + "…" : oneLine,
          ts: Date.now(),
          detail: detailRaw,
        };
        // 大压缩：一行系统事件（可点开）+ 短 toast（store 补 timer，约 1.2s 消失）
        return {
          systemEvents: [...state.systemEvents, sysEvent],
          toast: {
            text: message.includes("失败")
              ? clipToast("压缩失败，将稍后重试")
              : "上下文已压缩",
            kind: message.includes("失败") ? "warn" : "ok",
          },
        };
      }
      if (level === "error") return { toast: { text: clipToast(message), kind: "err" } };
      if (level === "warning" || level === "warn") {
        const isRetry = /重试|retry|循环输出|stall|可重试/i.test(message);
        const detail = clipToast(message).slice(0, 36);
        return {
          toast: { text: clipToast(message), kind: "warn" },
          ...(isRetry
            ? {
                eventBlock: {
                  ...state.eventBlock,
                  mode: "retrying" as const,
                  detail,
                },
              }
            : {}),
        };
      }
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
      const sysEvent: SystemEvent = { id: uid(), kind: "other", content: clipToast(err), ts: Date.now() };
      return { toast: { text: clipToast(err), kind: "err" }, systemEvents: [...state.systemEvents, sysEvent] };
    }
    case "model.loop_detected": {
      const retry = typeof ev.retry === "number" ? ev.retry + 1 : undefined;
      const detail = retry != null ? `循环输出 #${retry}` : "循环输出";
      const sysEvent: SystemEvent = {
        id: uid(),
        kind: "retry_fail",
        content: "循环输出，重试中",
        ts: Date.now(),
      };
      return {
        toast: { text: "循环输出，重试中", kind: "warn" },
        systemEvents: [...state.systemEvents, sysEvent],
        eventBlock: {
          ...state.eventBlock,
          mode: "retrying",
          detail,
        },
      };
    }
    case "model.tool_detected": {
      return {}; // 已有 tool_pending 跟进
    }
    case "round_limit": {
      const m = (ev.message as string | undefined) ?? "轮次上限";
      const sysEvent: SystemEvent = { id: uid(), kind: "retry_fail", content: m, ts: Date.now() };
      return {
        toast: { text: clipToast(m), kind: "warn" },
        systemEvents: [...state.systemEvents, sysEvent],
        eventBlock: {
          ...state.eventBlock,
          mode: "retrying",
          detail: clipToast(m).slice(0, 36),
        },
      };
    }
    case "verification": {
      return { eventBlock: { ...state.eventBlock, detail: ev.ok ? "验证通过" : "验证失败" } };
    }
    case "loop_check": {
      // 运行时空响应 / continue 类检查：有文案则显示为重试中
      const msg = String(ev.message ?? ev.detail ?? "");
      if (/重试|retry|empty|continue|空/i.test(msg)) {
        return {
          eventBlock: {
            ...state.eventBlock,
            mode: "retrying",
            detail: (msg || "重试中").slice(0, 36),
          },
        };
      }
      return {};
    }

    // ── 结束 ──────────────────────────────────────────────
    case "done": {
      // 归档本轮 usage；cache 优先用 agent 层 done 事件上的分桶快照
      const roundPatch = state.currentRoundUsage.input || state.currentRoundUsage.output
        ? pushRound(state, state.currentRoundUsage, (ev as { cache?: unknown }).cache)
        : (cacheHistoryFromEventCache((ev as { cache?: unknown }).cache)
          ? { cacheHistory: cacheHistoryFromEventCache((ev as { cache?: unknown }).cache)! }
          : {});
      const now = Date.now();
      const messages = state.messages.map(m =>
        m.id === state.currentAssistantId || m.streaming
          ? { ...m, streaming: false, doneTs: now, duration: m.duration ?? (now - m.ts) }
          : m
      );
      // 关闭所有 thinkingBlock 流式，算 duration
      const messagesClosed = messages.map(m => m.thinkingBlocks ? {
        ...m, thinkingBlocks: m.thinkingBlocks.map(b => ({
          ...b, streaming: false,
          duration: b.duration ?? (b.startTs ? now - b.startTs : undefined),
        })),
      } : m);
      // round：runtime done 事件的 rounds 字段硬编码 0（已知 bug），不可靠。
      // 优先用 agent_round 累加的 state.round；仅当 ev.rounds 更大时采用。
      const evRounds = ev.rounds as number | undefined;
      const round = typeof evRounds === "number" && evRounds > state.round ? evRounds : state.round;
      // 通用：done event 展开了命令的 meta。supervisorMode=true → /goal 命令触发监督模式，
      // 存 supervisor session 信息（实际 state 由 useSupervisorState hook 查 SDK 补全）。
      const supervisorMode = ev.supervisorMode === true;
      const supervisorPatch = supervisorMode ? {
        supervisor: {
          active: true,
          mainSessionId: (ev.mainSessionId as string | undefined) ?? null,
          supervisorSessionId: (ev.sessionId as string | undefined) ?? null,
          state: "planning" as const,
        },
      } : {};
      return {
        ...roundPatch,
        messages: messagesClosed,
        streaming: false,
        aborting: false,
        currentAssistantId: null,
        round,
        currentRoundUsage: { input: 0, output: 0 },
        eventBlock: { mode: "idle", upTokens: 0, downTokens: 0, detail: undefined },
        ...supervisorPatch,
      };
    }
    case "error": {
      // 陷阱①：error 后 runAgentCli 即 return，必须这里置 streaming:false
      const msg = typeof ev.message === "string" ? ev.message : String(ev.message ?? "错误");
      const nowTs = Date.now();
      const messages = state.messages.map((m) => {
        const sealed = sealMessageThinking(m, nowTs);
        return sealed.streaming ? { ...sealed, streaming: false } : sealed;
      });
      const sysEvent: SystemEvent = { id: uid(), kind: "other", content: clipToast(msg), ts: nowTs };
      return {
        messages,
        streaming: false,
        aborting: false,
        currentAssistantId: null,
        toast: { text: clipToast(msg), kind: "err" },
        eventBlock: { mode: "error", upTokens: 0, downTokens: 0, detail: msg.slice(0, 40) },
        systemEvents: [...state.systemEvents, sysEvent],
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
