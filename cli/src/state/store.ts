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
  // 对话区滚动（行级，marginTop={-offset} 上移内容实现网页感滚动）
  chatScrollOffset: number;          // 当前滚动偏移（0=底部看最新）
  maxChatScroll: number;             // 最大滚动偏移（contentHeight - viewportHeight，组件回写）
  autoFollow: boolean;               // 是否自动跟随底部（新消息到达时滚到底）
  scrollChat: (dir: "up" | "down") => void;
  setChatScrollOffset: (n: number) => void;
  setMaxChatScroll: (n: number) => void;
  setAutoFollow: (b: boolean) => void;
  scrollToBottom: () => void;
  // InputBar 滚轮驱动（内容 >viewportLines 时，鼠标在输入框行内滚轮 → 移光标）
  inputLineCount: number;            // InputBar 当前内容行数（InputBar 上报）
  setInputLineCount: (n: number) => void;
  inputCursorShift: { dir: "up" | "down"; nonce: number } | null;  // 滚轮→InputBar 光标移动指令
  shiftInputCursor: (dir: "up" | "down") => void;
  // 生成中消息排队：streaming 时 Enter 不发送而是入队，生成完自动 drain
  pendingMessages: string[];
  enqueueMessage: (text: string) => void;
  drainPendingMessage: () => string | undefined;
  clearPendingMessages: () => void;
  // 输入历史（上键回溯）：持久化到 ~/.maou/history.json
  inputHistory: string[];
  historyIndex: number;   // -1 = 未在历史中浏览，0+ = 当前浏览的历史索引
  pushInputHistory: (text: string) => void;
  navigateHistory: (dir: "up" | "down") => string | null;
  resetHistoryIndex: () => void;
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

// 输入历史持久化（~/.maou/history.json）
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
const HISTORY_PATH = join(homedir(), ".maou", "history.json");
function loadInputHistory(): string[] {
  try {
    return JSON.parse(readFileSync(HISTORY_PATH, "utf-8")).items ?? [];
  } catch {
    return [];
  }
}
function saveInputHistory(items: string[]): void {
  try {
    mkdirSync(dirname(HISTORY_PATH), { recursive: true });
    writeFileSync(HISTORY_PATH, JSON.stringify({ items }, null, 2));
  } catch { /* 静默 */ }
}

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
      case "settings": s.setOverlay("settings"); break;
      case "quit": s.requestExit(); break;
    }
    set({ overlay: null });
  },

  exitRequested: false,
  requestExit: () => set({ exitRequested: true }),

  mouseCursorCol: null,
  setMouseCursorCol: (col) => set({ mouseCursorCol: col }),
  // 行级平滑滚动（网页感）：marginTop={-(max-offset)} 上移内容。
  // offset 语义：0=看最新（底部），max=看最早（顶部）。
  // autoFollow=true 时新消息到达自动钉到底部（offset=0）；用户上滚后关闭，回到底部重启。
  chatScrollOffset: 0,
  maxChatScroll: 0,
  autoFollow: true,
  scrollChat: (dir) => set((s) => {
    const step = 2;
    const max = s.maxChatScroll;
    // wheelUp（向上看更早）→ offset 增大；wheelDown（向下看更新）→ offset 减小
    const next = Math.max(0, Math.min(max, s.chatScrollOffset + (dir === "up" ? step : -step)));
    // 用户主动滚到底（offset=0）→ 重启 autoFollow；否则关闭
    const atBottom = next <= 0;
    return { chatScrollOffset: next, autoFollow: atBottom };
  }),
  setChatScrollOffset: (n) => set((s) => ({ chatScrollOffset: Math.max(0, Math.min(s.maxChatScroll, n)) })),
  setMaxChatScroll: (n) => set({ maxChatScroll: Math.max(0, n) }),
  setAutoFollow: (b) => set({ autoFollow: b }),
  scrollToBottom: () => set({ chatScrollOffset: 0, autoFollow: true }),

  inputLineCount: 1,
  setInputLineCount: (n) => set({ inputLineCount: n }),
  inputCursorShift: null,
  shiftInputCursor: (dir) => set((s) => ({ inputCursorShift: { dir, nonce: (s.inputCursorShift?.nonce ?? 0) + 1 } })),

  // 生成中消息排队
  pendingMessages: [],
  enqueueMessage: (text) => set((s) => ({ pendingMessages: [...s.pendingMessages, text] })),
  drainPendingMessage: () => {
    let next: string | undefined;
    set((s) => {
      if (s.pendingMessages.length === 0) return s;
      next = s.pendingMessages[0];
      return { pendingMessages: s.pendingMessages.slice(1) };
    });
    return next;
  },
  clearPendingMessages: () => set({ pendingMessages: [] }),

  // 输入历史（内存 + 持久化）
  inputHistory: loadInputHistory(),
  historyIndex: -1,
  pushInputHistory: (text) => set((s) => {
    if (!text.trim() || s.inputHistory[s.inputHistory.length - 1] === text) return s;
    const next = [...s.inputHistory, text].slice(-100);  // 最多 100 条
    saveInputHistory(next);
    return { inputHistory: next };
  }),
  navigateHistory: (dir) => {
    let result: string | null = null;
    set((s) => {
      if (s.inputHistory.length === 0) return s;
      let idx: number;
      if (dir === "up") {
        idx = s.historyIndex < 0 ? s.inputHistory.length - 1 : Math.max(0, s.historyIndex - 1);
      } else {
        if (s.historyIndex < 0) return s;  // 不在历史中，下键无效
        idx = s.historyIndex + 1;
        if (idx >= s.inputHistory.length) {
          result = "";
          return { historyIndex: -1 };
        }
      }
      result = s.inputHistory[idx] ?? "";
      return { historyIndex: idx };
    });
    return result;
  },
  resetHistoryIndex: () => set({ historyIndex: -1 }),

  onStream: (ev) => set((s) => reduce(s, ev)),
}));
