/**
 * Maou CLI 状态（zustand）—— 持 UIState，onStream 调 pure reduce。
 *
 * 技术选型：zustand + reducer.ts 纯函数（不换 Redux/自研 store）。
 * 分区（方法命名空间，便于检索）：
 *   stream     — onStream / setStreaming / setAborting
 *   overlay    — setOverlay / runCommand / scrollOverlay
 *   mouse      — mouseCursor* / inputRect / selection / hoverId / chatScroll*
 *   completion — updateCompletion / cycleCompletion / acceptCompletion
 *   editor     — openFullEditor / exitFullEditor（无外部 $EDITOR）
 *   history    — pushInputHistory / navigateHistory
 *
 * 旧文件：legacy/pre-lib-migration/state/store.ts
 */

import { create } from "zustand";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { StreamEvent } from "@little-house-studio/types";
import type {
  UIState,
  ChatMessage,
  SystemEvent,
  Toast,
  CompletionState,
  SupervisorState,
  OverlayKind,
} from "./types.js";
import type { CompletionItem } from "../overlay/Completer.js";
import { complete, applyCompletion } from "../overlay/Completer.js";
import { reduce } from "./reducer.js";
import { dispatchDisplayEvent } from "../events/display-events.js";
import { SUPERVISOR_MANAGER } from "@little-house-studio/agent";
import { loadCacheHistoryFromLedger } from "../lib/prompt-cache.js";
import { perfInc } from "../hooks/perf.js";
import {
  noteUiPhase,
  setProcessStatsHudEnabled,
  setScrollBusy,
} from "../hooks/process-stats.js";
import {
  resolvePerfHudDefault,
  setPreferredPerfHud,
  resolveMouseCaptureDefault,
  setPreferredMouseCapture,
} from "../config/cli-ui-prefs.js";
import {
  getCommand,
  isLocalCommandId,
  registerBuiltinCliCommands,
} from "../config/cli-commands.js";
import {
  noteScrollWheel,
  scrollCoalesceMs,
  scrollCommitMinMs,
  scrollWheelLines,
} from "../hooks/scroll-pace.js";
import { invalidateClickTargetCache } from "../input/click-target.js";
import {
  userHistoryPath,
  projectLastSessionPath,
  projectSessionsDir,
  projectSessionFile,
} from "../config/paths.js";
import { DEFAULT_AGENT_NAME, resolveAgentName } from "../config/defaults.js";
import {
  STREAM_THROTTLE_MS,
  TOAST_TEXT_MAX,
  HISTORY_CHUNK_ROUNDS,
  HISTORY_OVERSCROLL_NOTCHES,
  SCROLL_IDLE_MS,
  SCROLL_COALESCE_MS,
} from "../config/ui-constants.js";

interface Store extends UIState {
  setAgentMeta: (agentName: string, provider: string, model: string, maxContext: number) => void;
  setThinking: (level: number) => void;
  setApprovalMode: (mode: UIState["approvalMode"]) => void;
  cycleApprovalMode: () => UIState["approvalMode"];
  setTerminalApproval: (req: UIState["terminalApproval"]) => void;
  setOverlay: (kind: UIState["overlay"]) => void;
  setSessionId: (id: string | null) => void;
  setProviderModel: (p: string, m: string) => void;
  pushUserMessage: (text: string) => void;
  clearMessages: () => void;
  /**
   * 新会话：清空消息/事件/滚动，刷新画廊种子，可选清屏。
   * 画廊会立刻显示，直到用户发出第一条非命令内容。
   */
  startNewSession: (opts?: { clearScreen?: boolean; toast?: string }) => void;
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
  /** 右上角 PerfHud（性能调试条）显示开关 */
  setPerfHud: (on: boolean) => void;
  togglePerfHud: () => boolean;
  /** /new 清屏、强制全量重绘：递增 screenEpoch（Ratatui 用） */
  bumpScreenEpoch: () => void;
  // 对话区滚动（行级，marginTop={-offset} 上移内容实现网页感滚动）
  chatScrollOffset: number;          // 当前滚动偏移（0=底部看最新）
  maxChatScroll: number;             // 最大滚动偏移（contentHeight - viewportHeight，组件回写）
  autoFollow: boolean;               // 是否自动跟随底部（新消息到达时滚到底）
  scrollChat: (dir: "up" | "down", step?: number) => void;
  setChatScrollOffset: (n: number) => void;
  /**
   * 更新可滚范围。
   * mode:
   *  - pin-content（默认）：保持 contentTopY（offset += Δmax）—— 适合底部追加内容
   *  - pin-offset：保持 offset 不变 —— 适合「上方/已见消息」测高修正（防上滑时跳 10+ 格）
   */
  setMaxChatScroll: (n: number, mode?: boolean | "pin-content" | "pin-offset") => void;
  /** 同时设定 max + offset（测高精细锚定用） */
  setChatScrollLayout: (max: number, offset: number) => void;
  setAutoFollow: (b: boolean) => void;
  scrollToBottom: () => void;
  /**
   * 历史窗口起点（items 下标）：贴底时自动收成最近 200 条；
   * 顶缘过滚 5 格后可减小起点以加载更早 100 条。
   */
  chatHistoryStart: number;
  setChatHistoryStart: (n: number) => void;
  /** 滚轮/拖选滚动中（降 paint / 关 hover） */
  scrollActive: boolean;
  markScrollActive: () => void;
  /** ScrollHistory 实测消息视口（1-based 屏幕行，不含 ↑预览/↓回底 chrome） */
  chatViewport: { top: number; bottom: number; height: number } | null;
  setChatViewport: (v: { top: number; bottom: number; height: number } | null) => void;
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
  /** InputBar 草稿（选区复制用字符切片，避免 VRAM 乱码） */
  inputDraft: string;
  setInputDraft: (v: string) => void;
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
  /** 输入/光标变化时重算候选；cursorIndex 为 UTF-16 索引 */
  updateCompletion: (input: string, cursorIndex?: number) => void;
  cycleCompletion: (dir: "up" | "down") => void;
  /**
   * 接受当前补全。返回新文本 + 新光标索引；失败 null。
   */
  acceptCompletion: (
    currentInput?: string,
    cursorIndex?: number,
  ) => { text: string; cursorIndex: number } | null;
  closeCompletion: () => void;
  // ToolCard 展开/折叠时调整滚动偏移（保持卡片头不动）
  expandShift: (delta: number) => void;
  /** MD/折叠等改高后通知 ScrollHistory 重测 */
  bumpContentLayout: () => void;
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
  gallerySeed: `boot-${Date.now().toString(36)}`,
  // 必须与 config.name / loadLastSession 过滤一致（旧值 "maou" 会导致
  // /new 写入 agentName=maou，启动用 coding 过滤时 miss → 回退到旧 jsonl）
  agentName: DEFAULT_AGENT_NAME,
  provider: "",
  model: "",
  maxContext: 0,
  round: 0,
  thinkingLevel: 2,
  approvalMode: "normal",
  terminalApproval: null,
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
  maxChatScroll: 0,
  autoFollow: true,
  perfHud: resolvePerfHudDefault(),
  mouseCapture: resolveMouseCaptureDefault(),
  screenEpoch: 0,
  chatHistoryStart: -1,
  scrollActive: false,
  contentLayoutEpoch: 0,
};

// 输入历史 / 上次会话持久化（路径见 config/paths）
function loadInputHistory(): string[] {
  try {
    return JSON.parse(readFileSync(userHistoryPath(), "utf-8")).items ?? [];
  } catch {
    return [];
  }
}
function saveInputHistory(items: string[]): void {
  try {
    const p = userHistoryPath();
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({ items }, null, 2));
  } catch { /* 静默 */ }
}

/** 项目态上次会话（按 cwd 隔离；不同路径互不串读） */
export interface ProjectLastSession {
  agentName: string;
  sessionId: string;
  /** 绝对路径，启动时再校验一次 */
  cwd?: string;
}

/**
 * coding 产品族 agent 名：历史上 store 默认 "maou"、产品 config "coding"、
 * 模板偶发 "main"。指针层视为同一产品，避免 /new 后因名字不一致回退旧会话。
 */
function isSameProductAgent(a?: string, b?: string): boolean {
  if (!a || !b) return true;
  if (a === b) return true;
  const aliases = new Set(["coding", "maou", "main"]);
  return aliases.has(a) && aliases.has(b);
}

/**
 * 读取「当前工作区」上次会话。
 * 1) <cwd>/.maou/last-session.json（且 session 文件存在）—— 含空 jsonl
 * 2) 否则本项目 sessions/ 下按 mtime 最新、非空的 jsonl
 *
 * 关键：指针存在就优先信指针。agentName 仅在「明显不同产品」时忽略指针；
 * coding/maou/main 互通，防止 /new 写入 maou、启动用 coding 过滤导致 miss。
 */
export function loadLastSession(
  cwd: string = process.cwd(),
  agentName?: string,
): ProjectLastSession | null {
  const absCwd = resolve(cwd);
  // 1) 项目 last-session 指针（含 /new 空会话）
  try {
    const raw = JSON.parse(
      readFileSync(projectLastSessionPath(absCwd), "utf-8"),
    ) as ProjectLastSession;
    if (raw?.sessionId && typeof raw.sessionId === "string") {
      const cwdOk = !raw.cwd || resolve(raw.cwd) === absCwd;
      const agentOk = isSameProductAgent(agentName, raw.agentName);
      const fileOk = existsSync(projectSessionFile(raw.sessionId, absCwd));
      if (cwdOk && agentOk && fileOk) {
        return {
          agentName: raw.agentName || agentName || DEFAULT_AGENT_NAME,
          sessionId: raw.sessionId,
          cwd: absCwd,
        };
      }
    }
  } catch {
    /* fall through */
  }

  // 2) 回退：本项目最新「非空」session。
  // 仅当 last-session 缺失/损坏/session 文件不存在时才用 mtime。
  // /new 空会话有指针时绝不能走到这里，否则会「复活」旧对话。
  try {
    const dir = projectSessionsDir(absCwd);
    if (!existsSync(dir)) return null;
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => ({
        id: f.replace(/\.jsonl$/, ""),
        mtime: statSync(join(dir, f)).mtimeMs,
        size: statSync(join(dir, f)).size,
      }))
      .filter((x) => x.size > 2)
      .sort((a, b) => b.mtime - a.mtime);
    const top = files[0];
    if (!top) return null;
    return {
      agentName: agentName || DEFAULT_AGENT_NAME,
      sessionId: top.id,
      cwd: absCwd,
    };
  } catch {
    return null;
  }
}

/** 写项目 last-session 指针；失败抛错给调用方决定是否静默 */
export function saveLastSession(
  agentName: string,
  sessionId: string,
  cwd: string = process.cwd(),
): void {
  const absCwd = resolve(cwd);
  const p = projectLastSessionPath(absCwd);
  mkdirSync(dirname(p), { recursive: true });
  const payload: ProjectLastSession = {
    agentName: resolveAgentName(agentName, DEFAULT_AGENT_NAME),
    sessionId,
    cwd: absCwd,
  };
  writeFileSync(p, JSON.stringify(payload, null, 2), "utf-8");
}

/** 生成新 session id（与 SessionStore 风格接近，足够唯一） */
function newSessionId(): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${ts}-${rand}`;
}

/**
 * 落盘「空会话」并更新 last-session 指针。
 * 这样下次启动：
 *  1) 读 last-session → 空 jsonl → 不恢复消息（画廊）
 *  2) 不会 fallback 到旧的大 jsonl
 */
export function persistEmptySession(
  agentName: string,
  cwd: string = process.cwd(),
): string {
  const absCwd = resolve(cwd);
  const sessionId = newSessionId();
  const name = resolveAgentName(agentName, DEFAULT_AGENT_NAME);
  const dir = projectSessionsDir(absCwd);
  mkdirSync(dir, { recursive: true });
  // 空 jsonl；指针存在时 loadLastSession 不会因 size=0 丢掉它
  const jsonl = projectSessionFile(sessionId, absCwd);
  writeFileSync(jsonl, "", "utf-8");
  const metaPath = join(dir, `${sessionId}.meta.json`);
  writeFileSync(
    metaPath,
    JSON.stringify(
      {
        id: sessionId,
        title: "新对话",
        agent_name: name,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf-8",
  );
  // 指针必须写成功；否则下次启动会 mtime 回退到旧对话
  saveLastSession(name, sessionId, absCwd);
  return sessionId;
}

// 本地命令白名单：config/cli-commands.ts 统一注册表
/** toast 自动消失计时（模块级，避免连发 toast 时旧 timer 清掉新提示） */
let _toastTimer: ReturnType<typeof setTimeout> | null = null;
let _toastGen = 0;

export const useStore = create<Store>((set, get) => ({
  ...initialState,

  setAgentMeta: (agentName, provider, model, maxContext) =>
    set((s) => {
      const nextAgent = agentName || s.agentName;
      const nextModel = model || s.model;
      // 从 agent 层 ledger 恢复 (agent, session, model) 桶镜像（可恢复，非清空销毁）
      const { cacheHistory } = loadCacheHistoryFromLedger(nextAgent, s.sessionId, nextModel);
      return {
        agentName: nextAgent,
        provider,
        model: nextModel,
        maxContext,
        cacheHistory,
        currentRoundUsage: { input: 0, output: 0 },
      };
    }),
  setThinking: (level) => set({ thinkingLevel: Math.max(0, Math.min(5, level)) }),
  setApprovalMode: (mode) => {
    set({ approvalMode: mode });
    // 同步 tools 层 terminal-policy.json（按当前 agent）
    void import("@little-house-studio/tools")
      .then((m) => {
        const agent = resolveAgentName(get().agentName, DEFAULT_AGENT_NAME);
        m.setTerminalMode(agent, mode);
      })
      .catch(() => {});
  },
  cycleApprovalMode: () => {
    const order = ["normal", "auto", "yolo"] as const;
    const cur = get().approvalMode;
    const i = Math.max(0, order.indexOf(cur as typeof order[number]));
    const next = order[(i + 1) % order.length]!;
    get().setApprovalMode(next);
    return next;
  },
  setTerminalApproval: (req) => set({ terminalApproval: req }),
  setOverlay: (overlay) => set({ overlay }),
  setSessionId: (sessionId) => {
    const s = get();
    const { cacheHistory } = loadCacheHistoryFromLedger(s.agentName, sessionId, s.model);
    set({ sessionId, cacheHistory, currentRoundUsage: { input: 0, output: 0 } });
    if (sessionId) {
      const an = resolveAgentName(get().agentName, DEFAULT_AGENT_NAME);
      try {
        saveLastSession(an, sessionId, process.cwd());
      } catch {
        /* 指针写失败不阻断 UI */
      }
    }
  },
  setProviderModel: (provider, model) =>
    set((s) => {
      // 换模 = 切到新桶镜像；旧 (agent,session,oldModel) 桶仍在 agent ledger
      const { cacheHistory } = loadCacheHistoryFromLedger(s.agentName, s.sessionId, model);
      return {
        provider,
        model,
        cacheHistory,
        currentRoundUsage: { input: 0, output: 0 },
      };
    }),
  pushUserMessage: (text) => set((s) => {
    const msg = {
      id: `u${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      role: "user" as const,
      content: text,
      ts: Date.now(),
      kind: "human_user" as const,
      source: "human",
      author: { type: "human" as const, id: "user", displayName: "user" },
    };
    // Grok：仅当本来就在最下面时贴底 + 让 user 顶到视口顶（bottomPad 动态算）
    const atBottom = s.autoFollow || s.chatScrollOffset <= 0;
    return {
      messages: [...s.messages, msg],
      streaming: true,
      currentRoundUsage: { input: 0, output: 0 },
      eventBlock: { mode: "thinking" as const, upTokens: 0, downTokens: 0, detail: undefined },
      ...(atBottom
        ? { chatScrollOffset: 0, autoFollow: true, chatHistoryStart: -1 as const }
        : {}),
    };
  }),
  clearMessages: () =>
    set({
      messages: [],
      systemEvents: [],
      currentAssistantId: null,
      rounds: [],
      cacheHistory: [],
      round: 0,
      sessionId: null,
      toast: null,
      streaming: false,
      aborting: false,
      chatScrollOffset: 0,
      maxChatScroll: 0,
      autoFollow: true,
    }),

  startNewSession: (opts) => {
    const clearScreen = opts?.clearScreen !== false;
    const toast = opts?.toast ?? "新会话";
    // 新种子 → 画廊换一张（同会话空态保持稳定）
    const gallerySeed = `new-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const agentName = resolveAgentName(get().agentName, DEFAULT_AGENT_NAME);
    // 落盘空会话 + 更新 last-session，避免下次启动 fallback 到旧 jsonl
    let sessionId: string | null = null;
    try {
      sessionId = persistEmptySession(agentName, process.cwd());
    } catch (e) {
      // 仍清空 UI，但提示落盘失败（否则用户以为已 /new，重启却回到旧会话）
      get().toastMsg(`新会话落盘失败: ${String(e).slice(0, 60)}`, "err");
      sessionId = newSessionId();
    }
    set((s) => ({
      messages: [],
      systemEvents: [],
      currentAssistantId: null,
      rounds: [],
      cacheHistory: [],
      round: 0,
      sessionId,
      streaming: false,
      aborting: false,
      chatScrollOffset: 0,
      maxChatScroll: 0,
      autoFollow: true,
      overlay: null,
      gallerySeed,
      eventBlock: { mode: "idle" as const, upTokens: 0, downTokens: 0 },
      currentRoundUsage: { input: 0, output: 0 },
      terminalApproval: null,
      // 清掉「按 agent 缓存」里当前 agent 的旧上下文（coding/maou 都清）
      agentSessionMap: {
        ...s.agentSessionMap,
        [agentName]: {
          sessionId,
          messages: [],
          systemEvents: [],
        },
        coding: {
          sessionId,
          messages: [],
          systemEvents: [],
        },
      },
    }));
    if (clearScreen) {
      void import("../lib/clear-screen.js").then((m) => m.clearTerminalScreen());
    }
    get().toastMsg(toast, "ok");
  },
  setStreaming: (streaming) => set({ streaming }),
  setAborting: (aborting) => set({ aborting }),
  toastMsg: (text, kind = "info") => {
    const t = (text ?? "").trim();
    // 空串 = 立即清除
    if (!t) {
      if (_toastTimer) {
        clearTimeout(_toastTimer);
        _toastTimer = null;
      }
      set({ toast: null });
      return;
    }
    set({ toast: { text: t.slice(0, TOAST_TEXT_MAX), kind } });
    // 自动消失：压缩/ok 短提示 1.2s · info 2.2s · warn 3s · err 4s
    if (_toastTimer) clearTimeout(_toastTimer);
    const gen = ++_toastGen;
    const isCompress = t.includes("上下文已压缩") || t.includes("已压缩");
    const ms =
      kind === "err" ? 4000
      : kind === "warn" ? 3000
      : isCompress || kind === "ok" ? 1200
      : 2200;
    _toastTimer = setTimeout(() => {
      // 仅清除仍是这一次 toast 的情况（中途又 toast 了则 gen 已变）
      if (gen !== _toastGen) return;
      set({ toast: null });
      _toastTimer = null;
    }, ms);
  },

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

  // 纯 UI 命令白名单：CliCommandSpec 注册表（local|both）；其余透传 runtime
  isLocalCommand: (id) => isLocalCommandId(id),

  /**
   * 执行本地指令 —— 由 CliCommandSpec.local 驱动，禁止再按 id 硬编码 switch。
   * 注意：打开 overlay 时不要再 set({ overlay: null })，否则立刻被关掉。
   */
  runCommand: (id) => {
    registerBuiltinCliCommands();
    const spec = getCommand(id);
    if (!spec?.local) return;

    const local = spec.local;
    if (local.kind === "overlay") {
      set({ overlay: local.overlay as OverlayKind });
      return;
    }

    switch (local.action) {
      case "switch_model":
        // 无参：开列表（带参路径走 cli-session dispatchSlash）
        set({ overlay: "model" });
        break;
      case "quit":
        get().requestExit();
        break;
      case "thinking_cycle": {
        const cur = get().thinkingLevel;
        get().setThinking((cur + 1) % 6);
        get().toastMsg(`思考级别: ${get().thinkingLevel}`, "info");
        set({ overlay: null });
        break;
      }
      case "screenshot": {
        void import("../lib/screen-dump.js").then(({ copyScreenDump }) => {
          const r = copyScreenDump();
          if (r.ok) {
            get().toastMsg(
              `已复制整屏 ${r.chars} 字（${r.lines} 行）· 可粘贴发给 AI`,
              "ok",
            );
          } else {
            get().toastMsg(r.message, "warn");
          }
        });
        set({ overlay: null });
        break;
      }
      case "new_session":
        get().startNewSession({ clearScreen: true, toast: "新会话" });
        break;
      case "clear_session":
        get().startNewSession({ clearScreen: true, toast: "已清空" });
        break;
      case "stop":
        // 中断由 cli-session.abort 处理；store 仅兜底 toast
        get().toastMsg("请用 Esc / 中断停止生成", "info");
        break;
      default:
        break;
    }
  },

  exitRequested: false,
  requestExit: () => set({ exitRequested: true }),

  mouseCursorCol: null,
  setMouseCursorCol: (col) => set({ mouseCursorCol: col }),
  mouseCursorLine: null,
  setMouseCursorLine: (line) => set({ mouseCursorLine: line }),
  mouseCapture: resolveMouseCaptureDefault(),
  setMouseCapture: (b) => {
    try {
      setPreferredMouseCapture(b);
    } catch {
      /* ignore */
    }
    set({ mouseCapture: b });
  },
  // Debug 性能条：env → ~/.maou/cli-ui.json → 默认；设置切换持久化
  perfHud: resolvePerfHudDefault(),
  setPerfHud: (on) => {
    setProcessStatsHudEnabled(on);
    try {
      setPreferredPerfHud(on);
    } catch {
      /* ignore disk errors */
    }
    set({ perfHud: on });
  },
  togglePerfHud: () => {
    const next = !get().perfHud;
    get().setPerfHud(next);
    return next;
  },
  bumpScreenEpoch: () =>
    set((s) => ({ screenEpoch: (s.screenEpoch ?? 0) + 1 })),
  // 行级平滑滚动（网页感）：marginTop={-(max-offset)} 上移内容。
  // offset 语义：0=看最新（底部），max=看最早（顶部）。
  // autoFollow=true 时新消息到达自动钉到底部（offset=0）；用户上滚后关闭，回到底部重启。
  chatScrollOffset: 0,
  maxChatScroll: 0,
  autoFollow: true,
  chatHistoryStart: -1,
  scrollActive: false,
  contentLayoutEpoch: 0,
  setChatHistoryStart: (n) => set({ chatHistoryStart: n }),
  bumpContentLayout: () =>
    set((s) => ({ contentLayoutEpoch: (s.contentLayoutEpoch ?? 0) + 1 })),
  markScrollActive: () => {
    markScrollActiveNow();
  },
  scrollChat: (dir, stepArg) => {
    enqueueChatScroll(dir, Math.max(1, stepArg ?? 1));
  },
  setChatScrollOffset: (n) => set((s) => ({ chatScrollOffset: Math.max(0, Math.min(s.maxChatScroll, n)) })),
  // maxChatScroll 回写：内容高度变化时由 ScrollHistory 调用。
  // followGrowth=true（流式内容增长）：!autoFollow 时 max 增大 Δ，offset 同步加 Δ 保持视口钉住。
  // 守卫：max 无变化时不 set（避免闪烁）。
  setMaxChatScroll: (n, mode = "pin-content") => set((s) => {
    const max = Math.max(0, n);
    if (max === s.maxChatScroll) return s;
    const delta = max - s.maxChatScroll;
    // 兼容旧 boolean：true → pin-content，false → pin-offset
    const m: "pin-content" | "pin-offset" =
      mode === true || mode === "pin-content"
        ? "pin-content"
        : mode === false || mode === "pin-offset"
          ? "pin-offset"
          : "pin-content";
    if (s.autoFollow) {
      return { maxChatScroll: max, chatScrollOffset: 0 };
    }
    if (m === "pin-offset") {
      // 测高修正：offset 不动 → 上方变高时视口内容不往「更早」跳
      return {
        maxChatScroll: max,
        chatScrollOffset: Math.max(0, Math.min(max, s.chatScrollOffset)),
      };
    }
    // pin-content：底部追加时保持 contentTopY
    const nextOffset = Math.max(0, Math.min(max, s.chatScrollOffset + delta));
    return { maxChatScroll: max, chatScrollOffset: nextOffset };
  }),
  setChatScrollLayout: (max, offset) => set((s) => {
    const m = Math.max(0, max);
    const o = Math.max(0, Math.min(m, offset));
    if (m === s.maxChatScroll && o === s.chatScrollOffset) return s;
    return {
      maxChatScroll: m,
      chatScrollOffset: o,
      autoFollow: o <= 0 ? true : false,
    };
  }),
  setAutoFollow: (b) => set({ autoFollow: b }),
  scrollToBottom: () =>
    set({
      chatScrollOffset: 0,
      autoFollow: true,
      // 回底：折叠到最近 HISTORY_BASE（由 ScrollHistory 根据 items.length 纠正起点）
      chatHistoryStart: -1, // -1 = 请求「收成贴底窗口」
    }),
  chatViewport: null,
  setChatViewport: (v) => set((s) => {
    if (!v && !s.chatViewport) return s;
    if (
      v && s.chatViewport &&
      v.top === s.chatViewport.top &&
      v.bottom === s.chatViewport.bottom &&
      v.height === s.chatViewport.height
    ) return s;
    return { chatViewport: v };
  }),

  inputLineCount: 1,
  setInputLineCount: (n) => set({ inputLineCount: n }),
  inputCursorShift: null,
  shiftInputCursor: (dir) => set((s) => ({ inputCursorShift: { dir, nonce: (s.inputCursorShift?.nonce ?? 0) + 1 } })),
  inputRect: null,
  setInputRect: (r) => set({ inputRect: r }),
  inputTextSel: null,
  setInputTextSel: (s) => set({ inputTextSel: s }),
  inputDraft: "",
  setInputDraft: (v) => set({ inputDraft: v }),
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

  // 补全菜单：输入 + 光标位置驱动
  completion: null,
  updateCompletion: (input, cursorIndex) => {
    const { items, prefix, range } = complete(input, cursorIndex);
    if (items.length === 0) {
      set({ completion: null });
      return;
    }
    set((s) => {
      let sel = 0;
      if (s.completion?.items?.length) {
        const prevVal = s.completion.items[s.completion.sel]?.value;
        if (prevVal) {
          const idx = items.findIndex((it) => it.value === prevVal);
          if (idx >= 0) sel = idx;
        }
        sel = Math.max(0, Math.min(sel, items.length - 1));
      }
      return { completion: { items, sel, prefix, range } };
    });
  },
  cycleCompletion: (dir) => set((s) => {
    if (!s.completion || s.completion.items.length === 0) return s;
    const n = s.completion.items.length;
    const next = dir === "up" ? (s.completion.sel - 1 + n) % n : (s.completion.sel + 1) % n;
    return { completion: { ...s.completion, sel: next } };
  }),
  /**
   * 接受补全：替换 completion.range，光标落到插入末尾。
   */
  acceptCompletion: (currentInput = "", cursorIndex?: number) => {
    let result: { text: string; cursorIndex: number } | null = null;
    set((s) => {
      if (!s.completion || s.completion.items.length === 0) {
        return { completion: null };
      }
      const sel = s.completion.items[s.completion.sel];
      if (!sel) return { completion: null };
      // 优先用打开菜单时的 range；若调用方传了新 cursor 且 range 失效则重算
      let range = s.completion.range;
      if (
        cursorIndex !== undefined &&
        (range.end !== cursorIndex || range.start > cursorIndex)
      ) {
        const again = complete(currentInput, cursorIndex);
        if (again.range) range = again.range;
      }
      result = applyCompletion(currentInput, sel, range);
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
    // 始终 bump 世代，让 ScrollHistory 用 Yoga 实测校正（预估 delta 可能不准）
    const epoch = (s.contentLayoutEpoch ?? 0) + 1;
    if (delta === 0) return { contentLayoutEpoch: epoch };
    // 贴底跟随：只重测，保持 offset=0，不要因 expand 关掉 autoFollow
    if (s.autoFollow || s.chatScrollOffset <= 0) {
      return {
        contentLayoutEpoch: epoch,
        autoFollow: true,
        chatScrollOffset: 0,
      };
    }
    const newMax = s.maxChatScroll + delta;
    return {
      contentLayoutEpoch: epoch,
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
      const s = get();
      const { cacheHistory } = loadCacheHistoryFromLedger(
        agentName,
        cached.sessionId,
        s.model,
      );
      set({
        sessionId: cached.sessionId,
        messages: cached.messages,
        systemEvents: cached.systemEvents,
        currentAssistantId: null,
        round: cached.messages.length,
        cacheHistory,
        currentRoundUsage: { input: 0, output: 0 },
      });
      return true;
    }
    return false;
  },
  setMessages: (messages, systemEvents = []) => set({
    messages, systemEvents, currentAssistantId: null, round: messages.length,
  }),

  onStream: (ev) => {
    // 高频 delta 节流：合并 ~64ms 内的 assistant_delta / thinking_delta，避免每个 token
    // 触发全树 React/Ink 重渲，导致流式中无法打字/滚轮（事件循环被渲染占满）。
    // 非 delta 事件先 flush 再处理，保证 tool_call 等顺序不错乱。
    applyStreamEvent(ev);
  },
}));

// ── 滚轮：合帧攒 delta + 限频 commit（ink≈paint≈25/s）──
let overscrollUp = 0;
let scrollIdleTimer: ReturnType<typeof setTimeout> | null = null;
let pendingScrollDelta = 0;
/** 合并窗内向上滚轮次数（顶缘过滚按「格」计，不是按合并后的行数） */
let pendingUpNotches = 0;
let scrollFlushTimer: ReturnType<typeof setTimeout> | null = null;
/** 上次真正 apply（触发 React）的时间 */
let lastScrollCommitAt = 0;

function markScrollActiveNow(): void {
  const s = useStore.getState();
  if (!s.scrollActive) {
    useStore.setState({ scrollActive: true });
    setScrollBusy(true);
  }
  if (scrollIdleTimer) clearTimeout(scrollIdleTimer);
  scrollIdleTimer = setTimeout(() => {
    scrollIdleTimer = null;
    // 静止前冲刷残余 delta
    flushPendingScroll();
    useStore.setState({ scrollActive: false });
    setScrollBusy(false);
    // 滚动结束后矩形已变：立刻作废 click 缓存，否则 hover 用旧坐标会「指着不亮」
    invalidateClickTargetCache();
  }, SCROLL_IDLE_MS);
}

function applyChatScrollDelta(delta: number, upNotches = 0): void {
  if (delta === 0 && upNotches === 0) return;
  noteUiPhase("scroll");
  useStore.setState((s) => {
    const max = s.maxChatScroll;
    const base = s.autoFollow ? 0 : s.chatScrollOffset;

    if (delta < 0) overscrollUp = 0;

    const next = Math.max(0, Math.min(max, base + delta));
    // 合并后一次跳多行：超出顶缘的 residual 才算过滚
    const residualUp = delta > 0 ? Math.max(0, base + delta - max) : 0;

    if (residualUp > 0 && max >= 0) {
      const notches =
        upNotches > 0
          ? base >= max
            ? upNotches
            : Math.max(1, Math.min(upNotches, residualUp))
          : residualUp;
      overscrollUp += notches;
      if (overscrollUp >= HISTORY_OVERSCROLL_NOTCHES) {
        overscrollUp = 0;
        const cur = s.chatHistoryStart;
        const nextStart =
          cur < 0
            ? cur - HISTORY_CHUNK_ROUNDS
            : Math.max(0, cur - HISTORY_CHUNK_ROUNDS);
        return {
          chatHistoryStart: nextStart,
          chatScrollOffset: max,
          autoFollow: false,
        };
      }
    }

    const atBottom = next <= 0;
    if (atBottom) overscrollUp = 0;
    if (next === s.chatScrollOffset && atBottom === s.autoFollow) return s;
    // 回到底部：autoFollow + start=-1 → ScrollHistory 收成最近 200
    if (atBottom) {
      return {
        chatScrollOffset: 0,
        autoFollow: true,
        chatHistoryStart: -1,
      };
    }
    return { chatScrollOffset: next, autoFollow: false };
  });
}

function flushPendingScroll(): void {
  if (scrollFlushTimer) {
    clearTimeout(scrollFlushTimer);
    scrollFlushTimer = null;
  }
  if (pendingScrollDelta === 0 && pendingUpNotches === 0) return;

  // 限频：未到最小间隔则推迟（delta 继续在 pending 里累加）
  const now = Date.now();
  const minGap = scrollCommitMinMs();
  const since = now - lastScrollCommitAt;
  if (lastScrollCommitAt > 0 && since < minGap) {
    scrollFlushTimer = setTimeout(() => {
      scrollFlushTimer = null;
      flushPendingScroll();
    }, minGap - since);
    return;
  }

  const d = pendingScrollDelta;
  const up = pendingUpNotches;
  pendingScrollDelta = 0;
  pendingUpNotches = 0;
  lastScrollCommitAt = now;
  applyChatScrollDelta(d, up);
}

function enqueueChatScroll(dir: "up" | "down", step: number): void {
  // step 保留兼容；实际步长由 scroll-pace 自适应
  void step;
  noteScrollWheel();
  const lines = scrollWheelLines();
  const line = dir === "up" ? lines : -lines;
  pendingScrollDelta += line;
  if (dir === "up") pendingUpNotches += 1;
  markScrollActiveNow();
  // 短窗合帧；真正 React commit 由 scrollCommitMinMs 限频
  if (!scrollFlushTimer) {
    const wait = scrollCoalesceMs(SCROLL_COALESCE_MS);
    scrollFlushTimer = setTimeout(() => {
      scrollFlushTimer = null;
      flushPendingScroll();
    }, wait);
  }
}

// ── 流式事件节流（模块级，单 store 实例）────────────────────────────────
const THROTTLE_TYPES = new Set(["assistant_delta", "thinking_delta"]);
let streamFlushTimer: ReturnType<typeof setTimeout> | null = null;
let pendingDeltas: StreamEvent[] = [];

function flushStreamDeltas(): void {
  if (streamFlushTimer) {
    clearTimeout(streamFlushTimer);
    streamFlushTimer = null;
  }
  const batch = pendingDeltas;
  pendingDeltas = [];
  if (batch.length === 0) return;
  perfInc("streamFlush");
  noteUiPhase("stream");
  useStore.setState((s) => {
    let cur: UIState = s;
    for (const ev of batch) {
      const patch = reduce(cur, ev);
      cur = { ...cur, ...patch };
    }
    return {
      ...cur,
      lastStreamNonce: (s.lastStreamNonce ?? 0) + 1,
    };
  });
}

function applyStreamEvent(ev: StreamEvent): void {
  if (THROTTLE_TYPES.has(ev.type)) {
    pendingDeltas.push(ev);
    if (!streamFlushTimer) {
      streamFlushTimer = setTimeout(() => flushStreamDeltas(), STREAM_THROTTLE_MS);
    }
    return;
  }

  // 关键事件先冲掉 pending delta，再同步 apply
  flushStreamDeltas();

  const checkSup = ev.type === "tool_result" || ev.type === "done";
  const prevToast = useStore.getState().toast;
  useStore.setState((s) => {
    const patch = reduce(s, ev);
    return {
      ...patch,
      lastStreamNonce: (s.lastStreamNonce ?? 0) + 1,
      ...(checkSup
        ? { supervisorCheckNonce: (s.supervisorCheckNonce ?? 0) + 1 }
        : {}),
    };
  });
  // reduce 直接写 toast 时不会走 toastMsg 计时器 → 必须在此补自动消失
  // （否则「上下文已压缩」会一直占位）
  const nextToast = useStore.getState().toast;
  if (
    nextToast &&
    nextToast.text &&
    (!prevToast ||
      prevToast.text !== nextToast.text ||
      prevToast.kind !== nextToast.kind)
  ) {
    useStore.getState().toastMsg(nextToast.text, nextToast.kind);
  }

  // displayEvents 通用分发（副作用，reducer 外）
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
}
