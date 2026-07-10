/**
 * Maou CLI 状态（zustand）—— 持 UIState，onStream 调 reducer 纯函数。
 */

import { create } from "zustand";
import type { StreamEvent } from "@little-house-studio/types";
import type { UIState, ChatMessage, SystemEvent, Toast, CompletionState, SupervisorState } from "./types.js";
import type { CompletionItem } from "../overlay/Completer.js";
import { complete } from "../overlay/Completer.js";
import { reduce } from "./reducer.js";
import { dispatchDisplayEvent } from "../events/display-events.js";
import { SUPERVISOR_MANAGER } from "@little-house-studio/agent";

interface Store extends UIState {
  setAgentMeta: (agentName: string, provider: string, model: string, maxContext: number) => void;
  setThinking: (level: number) => void;
  setOverlay: (kind: UIState["overlay"]) => void;
  setSessionId: (id: string | null) => void;
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
  /** 判断是否纯 UI 命令（开 overlay/退出），命中走本地 runCommand；未命中透传 runtime */
  isLocalCommand: (id: string) => boolean;
  mouseCursorLine: number | null;    // 鼠标点击输入框的目标行（0-based，多行场景）
  setMouseCursorLine: (line: number | null) => void;
  // 鼠标捕获开关：true=启用 SGR 鼠标（点击/滚轮），false=关闭（恢复终端原生选字）。
  // Terminal.app 下 1000 模式与直接拖拽选字互斥，提供运行时切换。
  mouseCapture: boolean;
  setMouseCapture: (b: boolean) => void;
  // 对话区滚动（行级，marginTop={-offset} 上移内容实现网页感滚动）
  chatScrollOffset: number;          // 当前滚动偏移（0=底部看最新）
  maxChatScroll: number;             // 最大滚动偏移（contentHeight - viewportHeight，组件回写）
  autoFollow: boolean;               // 是否自动跟随底部（新消息到达时滚到底）
  scrollChat: (dir: "up" | "down") => void;
  setChatScrollOffset: (n: number) => void;
  setMaxChatScroll: (n: number, followGrowth?: boolean) => void;
  setAutoFollow: (b: boolean) => void;
  scrollToBottom: () => void;
  // InputBar 滚轮驱动（内容 >viewportLines 时，鼠标在输入框行内滚轮 → 移光标）
  inputLineCount: number;            // InputBar 当前内容行数（InputBar 上报）
  setInputLineCount: (n: number) => void;
  inputCursorShift: { dir: "up" | "down"; nonce: number } | null;  // 滚轮→InputBar 光标移动指令
  shiftInputCursor: (dir: "up" | "down") => void;
  // InputBar 屏幕矩形 + 文本选区（鼠标点击移光标 / 框选删除用）
  inputRect: { left: number; top: number; width: number; height: number } | null;
  setInputRect: (r: { left: number; top: number; width: number; height: number } | null) => void;
  inputTextSel: { startIdx: number; endIdx: number } | null;  // 字符索引，按 code point
  setInputTextSel: (s: { startIdx: number; endIdx: number } | null) => void;
  inputSelectCmd: { col: number; line: number; phase: "start" | "extend"; nonce: number } | null;
  dispatchInputSelect: (col: number, line: number, phase: "start" | "extend") => void;
  overlayScrollCmd: { dir: "up" | "down"; nonce: number } | null;
  scrollOverlay: (dir: "up" | "down") => void;
  // goal 监督状态
  supervisor: SupervisorState | null;
  setSupervisor: (s: SupervisorState | null) => void;
  clearSupervisor: () => void;
  exitSupervisor: () => void;  // 退出监督：unbind SDK binding + 清状态 + 切回主 session
  toggleEventBlockExpanded: () => void;  // 切换 EventBlock 粗略/展开模式
  scrollSupervisor: (dir: "up" | "down") => void;  // 滚轮→EventBlock 展开滚动
  // 通用发送桥接（GoalPanel 确认按钮等）
  pendingSend: string | null;
  requestSend: (text: string) => void;
  clearPendingSend: () => void;
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
  // 补全菜单（提升到 store，供 InputBar 与 app.tsx 全局按键共享）
  completion: CompletionState | null;
  updateCompletion: (input: string) => void;   // 输入变化时重算候选
  cycleCompletion: (dir: "up" | "down") => void;
  acceptCompletion: () => string | null;       // 返回补全后的文本（不含已有前缀外的部分）
  closeCompletion: () => void;
  // ToolCard 展开/折叠时调整滚动偏移（保持卡片头不动）
  expandShift: (delta: number) => void;
  // 鼠标选区（自画反色 + OSC52 复制）
  selection: { start: { row: number; col: number }; end: { row: number; col: number } } | null;
  setSelection: (s: { start: { row: number; col: number }; end: { row: number; col: number } } | null) => void;
  // hover 元素 id（鼠标悬浮可点击元素时设）
  hoverId: string | null;
  setHoverId: (id: string | null) => void;
  // agent 切换：AgentPanel 选择后触发，useAgent 监听 nonce 变化重建 handle
  pendingAgentName: string | null;
  agentSwitchNonce: number;
  requestAgentSwitch: (name: string) => void;
  clearPendingAgentSwitch: () => void;
  // 会话按 agent 记忆：切 agent 前缓存当前，切回恢复
  saveCurrentSession: (agentName: string) => void;
  restoreSession: (agentName: string) => boolean;  // 返回是否有缓存
  setMessages: (messages: ChatMessage[], systemEvents?: SystemEvent[]) => void;
}

const initialState: UIState = {
  messages: [],
  systemEvents: [],
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
  inputRect: null,
  inputTextSel: null,
  inputSelectCmd: null,
  overlayScrollCmd: null,
  supervisor: null,
  supervisorMessages: [],
  eventBlockExpanded: false,
  supervisorScrollCmd: null,
  lastStreamNonce: 0,
  supervisorCheckNonce: 0,
  pendingSend: null,
  agentSessionMap: {},
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

// 上次会话持久化（~/.maou/last-session.json）—— 启动自动加载用
const LAST_SESSION_PATH = join(homedir(), ".maou", "last-session.json");
export function loadLastSession(): { agentName: string; sessionId: string } | null {
  try {
    return JSON.parse(readFileSync(LAST_SESSION_PATH, "utf-8"));
  } catch { return null; }
}
function saveLastSession(agentName: string, sessionId: string): void {
  try {
    mkdirSync(dirname(LAST_SESSION_PATH), { recursive: true });
    writeFileSync(LAST_SESSION_PATH, JSON.stringify({ agentName, sessionId }, null, 2));
  } catch { /* 静默 */ }
}

// 纯 UI 命令白名单（开 overlay / 退出 / 调思考级别）。
// 其余 /xxx 透传 runtime 由 SDK commandRegistry 识别。
const LOCAL_COMMANDS = new Set(["model", "sessions", "help", "settings", "agents", "quit", "thinking"]);

export const useStore = create<Store>((set, get) => ({
  ...initialState,

  setAgentMeta: (agentName, provider, model, maxContext) =>
    set({ agentName, provider, model, maxContext }),
  setThinking: (level) => set({ thinkingLevel: Math.max(0, Math.min(5, level)) }),
  setOverlay: (overlay) => set({ overlay }),
  setSessionId: (sessionId) => {
    set({ sessionId });
    if (sessionId) {
      const an = get().agentName;
      if (an) saveLastSession(an, sessionId);
    }
  },
  setProviderModel: (provider, model) => set({ provider, model }),
  pushUserMessage: (text) => set((s) => ({
    messages: [...s.messages, { id: `u${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, role: "user", content: text, ts: Date.now() }],
    streaming: true,
    currentRoundUsage: { input: 0, output: 0 },
    eventBlock: { mode: "thinking", upTokens: 0, downTokens: 0, detail: undefined },
  })),
  clearMessages: () => set({ messages: [], systemEvents: [], currentAssistantId: null, rounds: [], cacheHistory: [], round: 0, sessionId: null, toast: null }),
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

  // 纯 UI 命令白名单：只开 overlay / 退出 / 调思考级别。其余 /xxx（goal/new/clear/stop/agent 等）
  // 透传 runtime，由 SDK commandRegistry 识别——SDK 加新命令 CLI 自动支持。
  isLocalCommand: (id) => LOCAL_COMMANDS.has(id),

  runCommand: (id) => {
    const s = useStore.getState();
    switch (id) {
      case "model": s.setOverlay("model"); break;
      case "sessions": s.setOverlay("sessions"); break;
      case "help": s.setOverlay("help"); break;
      case "settings": s.setOverlay("settings"); break;
      case "agents": s.setOverlay("agents"); break;
      case "quit": s.requestExit(); break;
      case "thinking": {
        const cur = s.thinkingLevel;
        s.setThinking((cur + 1) % 6);
        s.toastMsg(`思考级别: ${s.thinkingLevel}`, "info");
        break;
      }
      default: return;  // 未知命令不关 overlay（透传路径已在 InputBar 处理）
    }
    set({ overlay: null });
  },

  exitRequested: false,
  requestExit: () => set({ exitRequested: true }),

  mouseCursorCol: null,
  setMouseCursorCol: (col) => set({ mouseCursorCol: col }),
  mouseCursorLine: null,
  setMouseCursorLine: (line) => set({ mouseCursorLine: line }),
  mouseCapture: process.env.MAOU_MOUSE !== "0",  // 默认开；MAOU_MOUSE=0 关
  setMouseCapture: (b) => set({ mouseCapture: b }),
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
  // maxChatScroll 回写：内容高度变化时由 ScrollHistory 调用。
  // followGrowth=true（流式内容增长）：!autoFollow 时 max 增大 Δ，offset 同步加 Δ 保持视口钉住。
  // 守卫：max 无变化时不 set（避免闪烁）。
  setMaxChatScroll: (n, followGrowth = false) => set((s) => {
    const max = Math.max(0, n);
    if (max === s.maxChatScroll) return s;
    const delta = max - s.maxChatScroll;
    if (followGrowth && !s.autoFollow && delta > 0) {
      return { maxChatScroll: max, chatScrollOffset: Math.max(0, Math.min(max, s.chatScrollOffset + delta)) };
    }
    return { maxChatScroll: max };
  }),
  setAutoFollow: (b) => set({ autoFollow: b }),
  scrollToBottom: () => set({ chatScrollOffset: 0, autoFollow: true }),

  inputLineCount: 1,
  setInputLineCount: (n) => set({ inputLineCount: n }),
  inputCursorShift: null,
  shiftInputCursor: (dir) => set((s) => ({ inputCursorShift: { dir, nonce: (s.inputCursorShift?.nonce ?? 0) + 1 } })),
  inputRect: null,
  setInputRect: (r) => set({ inputRect: r }),
  inputTextSel: null,
  setInputTextSel: (s) => set({ inputTextSel: s }),
  inputSelectCmd: null,
  dispatchInputSelect: (col, line, phase) => set((s) => ({ inputSelectCmd: { col, line, phase, nonce: (s.inputSelectCmd?.nonce ?? 0) + 1 } })),
  overlayScrollCmd: null,
  scrollOverlay: (dir) => set((s) => ({ overlayScrollCmd: { dir, nonce: (s.overlayScrollCmd?.nonce ?? 0) + 1 } })),
  supervisor: null,
  setSupervisor: (supervisor) => set({ supervisor }),
  clearSupervisor: () => set({ supervisor: null }),
  toggleEventBlockExpanded: () => set((s) => ({ eventBlockExpanded: !s.eventBlockExpanded })),
  supervisorScrollCmd: null,
  scrollSupervisor: (dir) => set((s) => ({ supervisorScrollCmd: { dir, nonce: (s.supervisorScrollCmd?.nonce ?? 0) + 1 } })),
  exitSupervisor: () => {
    // 退出监督：SDK unbind binding（让 SUPERVISOR_MANAGER 释放）+ 清状态 + 切回主 session
    const sup = get().supervisor;
    if (sup?.mainSessionId) {
      try { SUPERVISOR_MANAGER.unbind(sup.mainSessionId); } catch { /* 静默 */ }
    }
    if (sup?.mainSessionId) set({ sessionId: sup.mainSessionId });
    set({ supervisor: null, supervisorMessages: [], eventBlockExpanded: false });
  },
  pendingSend: null,
  requestSend: (text) => set({ pendingSend: text }),
  clearPendingSend: () => set({ pendingSend: null }),

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
    const next = [...s.inputHistory, text].slice(-20);  // 最多 20 条（DESIGN）
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

  // 补全菜单：输入变化时重算候选（同步 complete()）
  completion: null,
  updateCompletion: (input) => {
    const { items, prefix } = complete(input);
    set({ completion: items.length > 0 ? { items, sel: 0, prefix } : null });
  },
  cycleCompletion: (dir) => set((s) => {
    if (!s.completion || s.completion.items.length === 0) return s;
    const n = s.completion.items.length;
    const next = dir === "up" ? (s.completion.sel - 1 + n) % n : (s.completion.sel + 1) % n;
    return { completion: { ...s.completion, sel: next } };
  }),
  acceptCompletion: (): string | null => {
    let result: string | null = null;
    set((s) => {
      if (!s.completion) return s;
      const sel = s.completion.items[s.completion.sel];
      if (!sel) return s;
      result = sel.value + " ";
      return { completion: null };
    });
    return result;
  },
  closeCompletion: () => set({ completion: null }),

  // ToolCard 展开导致内容增高 delta 行：offset 同步增加，保持 marginTop 不变（卡片头不动）
  // 展开/折叠导致内容增高 delta 行：同步 offset+=delta + maxChatScroll+=delta + autoFollow=false，
  // 使 marginTop=-(max-offset) 不变 → 卡片头不动，新内容在下方长出（DESIGN）。
  // 预增 maxChatScroll 让随后 ScrollHistory 测量 effect 的 `max===s.maxChatScroll` 守卫命中跳过，
  // 避免与 setMaxChatScroll(followGrowth) 双重叠加 offset。
  expandShift: (delta) => set((s) => {
    if (delta === 0) return s;
    const newMax = s.maxChatScroll + delta;
    return {
      maxChatScroll: Math.max(0, newMax),
      chatScrollOffset: Math.max(0, Math.min(newMax, s.chatScrollOffset + delta)),
      autoFollow: false,
    };
  }),

  // 鼠标选区
  selection: null,
  setSelection: (sel) => set({ selection: sel }),
  hoverId: null,
  setHoverId: (id) => set({ hoverId: id }),

  // agent 切换
  pendingAgentName: null,
  agentSwitchNonce: 0,
  requestAgentSwitch: (name) => set((s) => ({
    pendingAgentName: name,
    agentSwitchNonce: s.agentSwitchNonce + 1,
  })),
  clearPendingAgentSwitch: () => set({ pendingAgentName: null }),

  // 会话按 agent 记忆：缓存当前 agent 的会话（切走前调）
  saveCurrentSession: (agentName) => set((s) => ({
    agentSessionMap: {
      ...s.agentSessionMap,
      [agentName]: { sessionId: s.sessionId, messages: s.messages, systemEvents: s.systemEvents },
    },
  })),
  // 恢复 agent 的会话（切回时调）。有缓存→恢复，无→返回 false（由调用方清空新建）
  restoreSession: (agentName) => {
    const cached = get().agentSessionMap[agentName];
    if (cached) {
      set({
        sessionId: cached.sessionId,
        messages: cached.messages,
        systemEvents: cached.systemEvents,
        currentAssistantId: null,
        round: cached.messages.length,
      });
      return true;
    }
    return false;
  },
  setMessages: (messages, systemEvents = []) => set({
    messages, systemEvents, currentAssistantId: null, round: messages.length,
  }),

  onStream: (ev) => {
    // 单次 set 合并 reducer patch + nonce 递增（避免两次 set 触发 React hooks 顺序问题）
    // supervisorCheckNonce 只在 tool_result/done 递增（状态变化点），不每事件递增——避免流式 delta 高频触发 useSupervisorState
    const checkSup = ev.type === "tool_result" || ev.type === "done";
    set((s) => {
      const patch = reduce(s, ev);
      const patch2: Record<string, unknown> = { ...patch, lastStreamNonce: (s.lastStreamNonce ?? 0) + 1 };
      if (checkSup) patch2.supervisorCheckNonce = (s.supervisorCheckNonce ?? 0) + 1;
      return patch2;
    });
    // displayEvents 通用分发（副作用，reducer 外处理）：tool_result 带 displayEvents 时
    // 遍历调 dispatchDisplayEvent。新增 displayEvent type 只需 registerDisplayHandler。
    if (ev.type === "tool_result") {
      const de = (ev as { displayEvents?: unknown }).displayEvents;
      if (Array.isArray(de)) {
        for (const e of de) {
          if (e && typeof e === "object" && typeof (e as { type?: unknown }).type === "string") {
            dispatchDisplayEvent(e as Parameters<typeof dispatchDisplayEvent>[0]);
          }
        }
      }
    }
  },
}));
