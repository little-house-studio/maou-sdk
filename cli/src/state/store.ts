/** Maou CLI 状态（zustand）—— 会话/消息/流式/UI */
import { create } from "zustand";
import type { StreamEvent } from "@little-house-studio/types";
import type { AgentCliConfig } from "../types.js";

/** 全局 agent cli 配置（App 启动时 setConfig，Modals 等组件 getConfig 读取） */
let _config: AgentCliConfig | null = null;
export function setConfig(c: AgentCliConfig) { _config = c; }
export function getConfig(): AgentCliConfig | null { return _config; }

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  thinking?: string;
  toolCalls?: { id: string; name: string; args: string; result?: string; isError?: boolean; done: boolean }[];
  usage?: { input: number; output: number; cost: number };
  streaming?: boolean;
  ts: number;
}

export interface HudStats {
  tokenHistory: number[];
  costHistory: number[];
  totalCost: number;
  totalInput: number;
  totalOutput: number;
  round: number;
}

export type ModalKind = null | "model" | "help" | "confirm" | "command" | "sessions";

interface State {
  messages: ChatMessage[];
  streaming: boolean;
  currentAssistantId: string | null;
  sessionId: string | null;
  hud: HudStats;
  provider: string;
  model: string;
  sidebarOpen: boolean;
  hudOpen: boolean;
  modal: ModalKind;
  toast: { text: string; kind: "ok" | "err" | "info" } | null;
  expression: string;
  wireAngle: number;

  send: (text: string) => void;
  onStream: (ev: StreamEvent) => void;
  setSessionId: (id: string) => void;
  finishStream: () => void;
  setProviderModel: (p: string, m: string) => void;
  toggleSidebar: () => void;
  toggleHud: () => void;
  setModal: (m: ModalKind) => void;
  toastMsg: (text: string, kind?: "ok" | "err" | "info") => void;
  setExpression: (e: string) => void;
  tickWire: () => void;
  clearMessages: () => void;
}

let idc = 0;
const uid = () => `m${Date.now()}_${idc++}`;

export const useStore = create<State>((set) => ({
  messages: [],
  streaming: false,
  currentAssistantId: null,
  sessionId: null,
  hud: { tokenHistory: [], costHistory: [], totalCost: 0, totalInput: 0, totalOutput: 0, round: 0 },
  provider: "anthropic",
  model: "claude-sonnet-4-5",
  sidebarOpen: true,
  hudOpen: true,
  modal: null,
  toast: null,
  expression: "( ͡° ͜ʖ ͡°)",
  wireAngle: 0,

  send: (text) =>
    set((s) => ({
      messages: [...s.messages, { id: uid(), role: "user", content: text, ts: Date.now() }],
      streaming: true,
    })),

  setSessionId: (id) => set({ sessionId: id }),

  onStream: (ev) =>
    set((s) => {
      // 流式文本增量（agent 发 assistant_delta，带 delta 字段）
      if (ev.type === "assistant_delta" && ev.delta) {
        return appendAssistantDelta(s, ev.delta);
      }
      // 完整 assistant 回复（一轮结束，带 content）
      if (ev.type === "assistant" && ev.content != null) {
        // 如果已有 streaming 的 assistant 消息，更新内容；否则新建
        let messages = s.messages;
        let id = s.currentAssistantId;
        if (!id || !messages.find((m) => m.id === id)) {
          id = uid();
          messages = [...messages, { id, role: "assistant" as const, content: ev.content ?? "", streaming: false, ts: Date.now() }];
        } else {
          messages = messages.map((m) => (m.id === id ? { ...m, content: ev.content ?? m.content, streaming: false } : m));
        }
        return { messages, currentAssistantId: id };
      }
      // 工具调用
      if (ev.type === "tool_call") {
        const tool = ev.tool as { id?: string; name: string; parameters?: Record<string, unknown> } | undefined;
        const id = s.currentAssistantId ?? uid();
        const messages = (s.currentAssistantId ? s.messages : [...s.messages, { id, role: "assistant" as const, content: "", streaming: true, ts: Date.now() }]).map((m) =>
          m.id === id
            ? { ...m, toolCalls: [...(m.toolCalls ?? []), { id: tool?.id ?? uid(), name: tool?.name ?? "?", args: JSON.stringify(tool?.parameters ?? {}), done: false }] }
            : m,
        );
        return { messages, currentAssistantId: id };
      }
      // 工具结果回填
      if (ev.type === "tool_result") {
        const tool = ev.tool as { id?: string; name?: string } | undefined;
        const toolId = tool?.id;
        const content = typeof ev.content === "string" ? ev.content : JSON.stringify(ev.content ?? "");
        const messages = s.messages.map((m) =>
          m.toolCalls
            ? {
                ...m,
                toolCalls: m.toolCalls.map((tc) =>
                  tc.id === toolId || (!toolId && tc.name === tool?.name && !tc.done)
                    ? { ...tc, result: content.slice(0, 2000), isError: ev.ok === false, done: true }
                    : tc,
                ),
              }
            : m,
        );
        return { messages };
      }
      // token 用量
      if (ev.type === "model.usage" && ev.usage) {
        const u = ev.usage as Record<string, unknown>;
        const input = Number(u.prompt_tokens ?? u.input_tokens ?? 0) || 0;
        const output = Number(u.completion_tokens ?? u.output_tokens ?? 0) || 0;
        const total = input + output;
        return {
          hud: {
            ...s.hud,
            tokenHistory: total > 0 ? [...s.hud.tokenHistory, total].slice(-40) : s.hud.tokenHistory,
            totalInput: s.hud.totalInput + input,
            totalOutput: s.hud.totalOutput + output,
            round: s.hud.round,
          },
        };
      }
      // 完成
      if (ev.type === "done") {
        const messages = s.messages.map((m) => (m.id === s.currentAssistantId ? { ...m, streaming: false } : m));
        return { messages, streaming: false, hud: { ...s.hud, round: s.hud.round + 1 } };
      }
      // 错误
      if (ev.type === "error") {
        const msg = typeof ev.message === "string" ? ev.message : String(ev.message ?? "未知错误");
        return { toast: { text: msg.slice(0, 80), kind: "err" }, streaming: false };
      }
      return {};
    }),
  finishStream: () => set({ streaming: false }),
  setProviderModel: (provider, model) => set({ provider, model }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleHud: () => set((s) => ({ hudOpen: !s.hudOpen })),
  setModal: (modal) => set({ modal }),
  toastMsg: (text, kind = "info") => set({ toast: { text, kind } }),
  setExpression: (expression) => set({ expression }),
  tickWire: () => set((s) => ({ wireAngle: s.wireAngle + 0.08 })),
  clearMessages: () => set({ messages: [], currentAssistantId: null, hud: { tokenHistory: [], costHistory: [], totalCost: 0, totalInput: 0, totalOutput: 0, round: 0 } }),
}));

/** 追加流式 delta 到当前 assistant 消息（没有则新建） */
function appendAssistantDelta(s: State, delta: string): Partial<State> {
  let messages = s.messages;
  let id = s.currentAssistantId;
  if (!id || !messages.find((m) => m.id === id)) {
    id = uid();
    messages = [...messages, { id, role: "assistant" as const, content: "", streaming: true, ts: Date.now() }];
  }
  messages = messages.map((m) => (m.id === id ? { ...m, content: m.content + delta, streaming: true } : m));
  return { messages, currentAssistantId: id };
}
