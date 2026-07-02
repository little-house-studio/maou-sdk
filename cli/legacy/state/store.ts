/** Maou CLI 状态（zustand）— 极简 */
import { create } from "zustand";
import type { StreamEvent } from "@little-house-studio/types";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: { id: string; name: string; args: string; result?: string; isError?: boolean; done: boolean }[];
  usage?: { input: number; output: number };
  streaming?: boolean;
  ts: number;
}

export type ModalKind = null | "command" | "model" | "sessions" | "help";

interface State {
  messages: ChatMessage[];
  streaming: boolean;
  currentAssistantId: string | null;
  sessionId: string | null;
  provider: string;
  model: string;
  tokenHistory: number[];
  totalInput: number;
  totalOutput: number;
  round: number;
  modal: ModalKind;
  toast: { text: string; kind: "ok" | "err" | "info" } | null;

  send: (text: string) => void;
  onStream: (ev: StreamEvent) => void;
  setSessionId: (id: string) => void;
  setProviderModel: (p: string, m: string) => void;
  setModal: (m: ModalKind) => void;
  toastMsg: (text: string, kind?: "ok" | "err" | "info") => void;
  clearMessages: () => void;
  finishStream: () => void;
}

let idc = 0;
const uid = () => `m${Date.now()}_${idc++}`;

export const useStore = create<State>((set) => ({
  messages: [], streaming: false, currentAssistantId: null, sessionId: null,
  provider: "", model: "", tokenHistory: [], totalInput: 0, totalOutput: 0, round: 0,
  modal: null, toast: null,

  send: (text) => set((s) => ({
    messages: [...s.messages, { id: uid(), role: "user", content: text, ts: Date.now() }],
    streaming: true,
  })),

  setSessionId: (id) => set({ sessionId: id }),
  setProviderModel: (p, m) => set({ provider: p, model: m }),
  setModal: (m) => set({ modal: m }),
  toastMsg: (text, kind = "info") => set({ toast: { text, kind } }),
  finishStream: () => set({ streaming: false }),
  clearMessages: () => set({ messages: [], currentAssistantId: null, tokenHistory: [], totalInput: 0, totalOutput: 0, round: 0, sessionId: null }),

  onStream: (ev) => set((s) => {
    if (ev.type === "assistant_delta" && ev.delta) {
      let messages = s.messages, id = s.currentAssistantId;
      if (!id || !messages.find(m => m.id === id)) {
        id = uid();
        messages = [...messages, { id, role: "assistant" as const, content: "", streaming: true, ts: Date.now() }];
      }
      messages = messages.map(m => m.id === id ? { ...m, content: m.content + ev.delta, streaming: true } : m);
      return { messages, currentAssistantId: id };
    }
    if (ev.type === "tool_call") {
      const tool = ev.tool as { id?: string; name: string; parameters?: Record<string, unknown> } | undefined;
      const id = s.currentAssistantId ?? uid();
      const messages = (s.currentAssistantId ? s.messages : [...s.messages, { id, role: "assistant" as const, content: "", streaming: true, ts: Date.now() }]).map(m =>
        m.id === id ? { ...m, toolCalls: [...(m.toolCalls ?? []), { id: tool?.id ?? uid(), name: tool?.name ?? "?", args: JSON.stringify(tool?.parameters ?? {}), done: false }] } : m
      );
      return { messages, currentAssistantId: id };
    }
    if (ev.type === "tool_result") {
      const tool = ev.tool as { id?: string; name?: string } | undefined;
      const content = typeof ev.content === "string" ? ev.content : JSON.stringify(ev.content ?? "");
      const messages = s.messages.map(m => m.toolCalls ? {
        ...m, toolCalls: m.toolCalls.map(tc => (tc.id === tool?.id || (!tool?.id && tc.name === tool?.name && !tc.done)) ? { ...tc, result: content.slice(0, 2000), isError: ev.ok === false, done: true } : tc)
      } : m);
      return { messages };
    }
    if (ev.type === "model.usage" && ev.usage) {
      const u = ev.usage as Record<string, unknown>;
      const input = Number(u.prompt_tokens ?? u.input_tokens ?? 0) || 0;
      const output = Number(u.completion_tokens ?? u.output_tokens ?? 0) || 0;
      return { tokenHistory: [...s.tokenHistory, input + output].slice(-20), totalInput: s.totalInput + input, totalOutput: s.totalOutput + output };
    }
    if (ev.type === "done") {
      const messages = s.messages.map(m => m.id === s.currentAssistantId ? { ...m, streaming: false } : m);
      return { messages, streaming: false, round: s.round + 1 };
    }
    if (ev.type === "error") {
      const msg = typeof ev.message === "string" ? ev.message : String(ev.message ?? "错误");
      return { toast: { text: msg.slice(0, 80), kind: "err" as const }, streaming: false };
    }
    return {};
  }),
}));
