/** Maou CLI 状态（zustand）—— 会话/消息/流式/UI */
import { create } from "zustand";
import type { StreamEvent } from "@little-house-studio/llm";

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

export type ModalKind = null | "model" | "help" | "confirm" | "command";

interface State {
  messages: ChatMessage[];
  streaming: boolean;
  currentAssistantId: string | null;
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
      round: s.hud.round,
    })),
  onStream: (ev) =>
    set((s) => {
      if (ev.type === "text" || ev.type === "thinking") {
        let messages = s.messages;
        let id = s.currentAssistantId;
        if (!id || !messages.find((m) => m.id === id)) {
          id = uid();
          messages = [...messages, { id, role: "assistant" as const, content: "", streaming: true, ts: Date.now() }];
        }
        messages = messages.map((m) =>
          m.id === id
            ? ev.type === "text"
              ? { ...m, content: m.content + ev.delta }
              : { ...m, thinking: (m.thinking ?? "") + ev.delta }
            : m,
        );
        return { messages, currentAssistantId: id };
      }
      if (ev.type === "toolCall") {
        const id = s.currentAssistantId ?? uid();
        const messages = (s.currentAssistantId ? s.messages : [...s.messages, { id, role: "assistant" as const, content: "", streaming: true, ts: Date.now() }]).map((m) =>
          m.id === id
            ? { ...m, toolCalls: [...(m.toolCalls ?? []), { id: ev.tool.id, name: ev.tool.name, args: JSON.stringify(ev.tool.parameters), done: false }] }
            : m,
        );
        return { messages, currentAssistantId: id };
      }
      if (ev.type === "usage" || ev.type === "done") {
        const hud = ev.type === "done" ? s.hud : {
          ...s.hud,
          tokenHistory: ev.usage.input || ev.usage.output ? [...s.hud.tokenHistory, ev.usage.input + ev.usage.output].slice(-40) : s.hud.tokenHistory,
          costHistory: ev.usage.cost.total ? [...s.hud.costHistory, ev.usage.cost.total].slice(-40) : s.hud.costHistory,
          totalCost: s.hud.totalCost + ev.usage.cost.total,
          totalInput: s.hud.totalInput + ev.usage.input,
          totalOutput: s.hud.totalOutput + ev.usage.output,
          round: s.hud.round + 1,
        };
        const expression = pickExpression(ev);
        const messages = ev.type === "done" ? s.messages.map((m) => (m.id === s.currentAssistantId ? { ...m, streaming: false, usage: { input: ev.message.usage?.input ?? 0, output: ev.message.usage?.output ?? 0, cost: ev.message.usage?.cost.total ?? 0 } } : m)) : s.messages;
        return { hud, expression, messages, streaming: ev.type === "usage" ? s.streaming : false };
      }
      if (ev.type === "error") {
        return { toast: { text: ev.error.slice(0, 60), kind: "err" }, streaming: false };
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

function pickExpression(ev: StreamEvent): string {
  if (ev.type !== "done") return "( ͡° ͜ʖ ͡°)";
  const faces = ["( ͡° ͜ʖ ͡°)", "( •̀ ω •́ )✧", "(≧∇≦)b", "(─‿─)", "(⊙_⊙)?", "(¬‿¬)", "(＠_＠;)"];
  return faces[Math.floor(Math.random() * faces.length)]!;
}
