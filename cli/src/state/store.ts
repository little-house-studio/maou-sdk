/**
 * Maou CLI 状态（zustand）—— 持 UIState，onStream 调 reducer 纯函数。
 */

import { create } from "zustand";
import type { StreamEvent } from "@little-house-studio/types";
import type { UIState, ChatMessage, Toast } from "./types.js";
import { reduce } from "./reducer.js";

interface Store extends UIState {
  setAgentMeta: (agentName: string, provider: string, model: string, maxContext: number) => void;
  setThinking: (level: number) => void;
  setOverlay: (kind: UIState["overlay"]) => void;
  setSessionId: (id: string) => void;
  setProviderModel: (p: string, m: string) => void;
  pushUserMessage: (text: string) => void;
  clearMessages: () => void;
  onStream: (ev: StreamEvent) => void;
  setStreaming: (b: boolean) => void;
  setAborting: (b: boolean) => void;
  toastMsg: (text: string, kind?: Toast["kind"]) => void;
  // 全屏编辑器
  fullEditorInitial: string | null;
  fullEditorResult: string | null;
  pendingSubmit: string | null;
  openFullEditor: (initial: string) => void;
  exitFullEditor: (value: string, submit: boolean) => void;
  clearPendingSubmit: () => void;
  // 命令
  runCommand: (id: string) => void;
  // 退出（app.tsx effect 监听 exitRequested 调 useApp().exit）
  exitRequested: boolean;
  requestExit: () => void;
  // 鼠标驱动
  mouseCursorCol: number | null;     // 鼠标点击输入框的目标列（InputBar 监听移光标）
  setMouseCursorCol: (col: number | null) => void;
  chatScrollOffset: number;          // 对话区滚动偏移（滚轮驱动）
  scrollChat: (dir: "up" | "down") => void;
  // InputBar 滚轮驱动（内容 >viewportLines 时，鼠标在输入框行内滚轮 → 移光标）
  inputLineCount: number;            // InputBar 当前内容行数（InputBar 上报）
  setInputLineCount: (n: number) => void;
  inputCursorShift: { dir: "up" | "down"; nonce: number } | null;  // 滚轮→InputBar 光标移动指令
  shiftInputCursor: (dir: "up" | "down") => void;
}

const initialState: UIState = {
  messages: [],
  currentAssistantId: null,
  streaming: false,
  aborting: false,
  sessionId: null,
  agentName: "maou",
  provider: "",
  model: "",
  maxContext: 0,
  round: 0,
  thinkingLevel: 2,
  rounds: [],
  cacheHistory: [],
  currentRoundUsage: { input: 0, output: 0 },
  eventBlock: { mode: "idle", upTokens: 0, downTokens: 0 },
  toast: null,
  overlay: null,
  mouseCursorCol: null,
  chatScrollOffset: 0,
};

export const useStore = create<Store>((set) => ({
  ...initialState,

  setAgentMeta: (agentName, provider, model, maxContext) =>
    set({ agentName, provider, model, maxContext }),
  setThinking: (level) => set({ thinkingLevel: Math.max(0, Math.min(5, level)) }),
  setOverlay: (overlay) => set({ overlay }),
  setSessionId: (sessionId) => set({ sessionId }),
  setProviderModel: (provider, model) => set({ provider, model }),
  pushUserMessage: (text) => set((s) => ({
    messages: [...s.messages, { id: `u${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, role: "user", content: text, ts: Date.now() }],
    streaming: true,
    currentRoundUsage: { input: 0, output: 0 },
    eventBlock: { mode: "thinking", upTokens: 0, downTokens: 0, detail: undefined },
  })),
  clearMessages: () => set({ messages: [], currentAssistantId: null, rounds: [], cacheHistory: [], round: 0, sessionId: null, toast: null }),
  setStreaming: (streaming) => set({ streaming }),
  setAborting: (aborting) => set({ aborting }),
  toastMsg: (text, kind = "info") => set({ toast: { text: text.slice(0, 80), kind } }),

  fullEditorInitial: null,
  fullEditorResult: null as string | null,
  pendingSubmit: null as string | null,
  openFullEditor: (initial) => set({ fullEditorInitial: initial, overlay: null }),
  exitFullEditor: (value, submit) => set({
    fullEditorInitial: null,
    fullEditorResult: submit ? null : value,
    pendingSubmit: submit ? value : null,
  }),
  clearPendingSubmit: () => set({ pendingSubmit: null, fullEditorResult: null }),

  runCommand: (id) => {
    const s = useStore.getState();
    switch (id) {
      case "new": s.clearMessages(); s.toastMsg("新会话", "ok"); break;
      case "model": s.setOverlay("model"); break;
      case "sessions": s.setOverlay("sessions"); break;
      case "help": s.setOverlay("help"); break;
      case "quit": s.requestExit(); break;
    }
    set({ overlay: null });
  },

  exitRequested: false,
  requestExit: () => set({ exitRequested: true }),

  mouseCursorCol: null,
  setMouseCursorCol: (col) => set({ mouseCursorCol: col }),
  chatScrollOffset: 0,
  scrollChat: (dir) => set((s) => ({ chatScrollOffset: Math.max(0, s.chatScrollOffset + (dir === "up" ? 1 : -1)) })),

  inputLineCount: 1,
  setInputLineCount: (n) => set({ inputLineCount: n }),
  inputCursorShift: null,
  shiftInputCursor: (dir) => set((s) => ({ inputCursorShift: { dir, nonce: (s.inputCursorShift?.nonce ?? 0) + 1 } })),

  onStream: (ev) => set((s) => reduce(s, ev)),
}));
