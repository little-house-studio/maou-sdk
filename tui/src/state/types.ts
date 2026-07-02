/**
 * UI 状态模型 —— reducer 与 app 共享的状态形状。
 *
 * 对齐 27 个 StreamEvent 的映射。重点陷阱（已在 reducer 处理）：
 *  - error 后 runAgentCli 立即 return，reducer 收不到后续 done → error 分支也置 streaming:false
 *  - tool_call.tool 是对象 {id,name,parameters,...}；tool_result 的 toolCallId/name/content/ok 是顶层
 *  - model.usage 裸 {usage}；assistant.usage 含 max_context
 *  - log（带 level）vs info（无 level）分流
 *  - session 是 Session 对象，取 .id
 *
 * 与 cli/src/state/types.ts 对齐，但剥离 React/overlay/mouse 字段（Pi TUI 无鼠标）。
 * 改用纯 state 对象 + tui.requestRender() 驱动渲染，故无 store action。
 */

export interface ToolCardState {
  id: string;
  name: string;
  args: string;          // JSON.stringify(parameters)
  result?: string;       // 截断后
  isError?: boolean;
  done: boolean;
}

export interface ThinkingBlock {
  id: string;
  content: string;
  streaming: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  ts: number;
  streaming?: boolean;
  toolCalls?: ToolCardState[];
  thinkingBlocks?: ThinkingBlock[];
  usage?: { input: number; output: number; maxContext?: number };
}

export type EventMode = "idle" | "thinking" | "generating" | "tool_pending" | "error";

export interface EventBlock {
  mode: EventMode;
  upTokens: number;      // 本轮上传
  downTokens: number;    // 本轮下传
  detail?: string;       // 状态文本/工具名
}

export interface Toast {
  text: string;
  kind: "ok" | "err" | "info" | "warn";
  /** 过期时间戳（ms），app 渲染时据此清除已过期 toast */
  expiresAt: number;
}

export interface RoundUsage {
  input: number;
  output: number;
  total?: number;
  cacheRead?: number;
}

export interface UIState {
  messages: ChatMessage[];
  currentAssistantId: string | null;
  streaming: boolean;
  aborting: boolean;
  sessionId: string | null;
  agentName: string;
  provider: string;
  model: string;
  maxContext: number;
  round: number;
  thinkingLevel: number;
  rounds: RoundUsage[];          // 每轮 token（sparkline 用，最近 20）
  cacheHistory: number[];        // 最近 20 轮缓存率
  currentRoundUsage: RoundUsage; // 本轮累计
  eventBlock: EventBlock;
  toast: Toast | null;
  /** 退出请求（app 主循环监听后调 tui.stop + process.exit） */
  exitRequested: boolean;
}

/** 初始状态 —— agentMeta（name/provider/model/maxContext）由 agent.ts 启动时注入。 */
export function initialState(): UIState {
  return {
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
    exitRequested: false,
  };
}
