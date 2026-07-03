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

/**
 * 对话内容块 —— 有序数组，按事件到达顺序穿插（text/thinking/tool）。
 * 模仿 oh-my-pi 的 content: Block[] 模型，替代 content+toolCalls+thinkingBlocks 三字段分离。
 */
export type Block =
  | { type: "text"; content: string }
  | { type: "thinking"; id: string; content: string; streaming: boolean }
  | { type: "tool"; id: string; name: string; args: string; result?: string; isError?: boolean; done: boolean };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  /** 有序内容块（text/thinking/tool 按时序穿插）。user 消息通常单个 text block。 */
  blocks: Block[];
  ts: number;
  streaming?: boolean;
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

/** 单轮缓存统计原始量（用于正确计算合并缓存率，避免 mean-of-rates 偏差） */
export interface CacheStat {
  cacheRead: number;
  input: number;
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
  cacheHistory: CacheStat[];     // 最近 20 轮缓存统计（cacheRead/input，合并算平均率）
  currentRoundUsage: RoundUsage; // 本轮累计
  eventBlock: EventBlock;
  toast: Toast | null;
  /** 工具卡片展开状态（ctrl+o toggle，默认折叠） */
  toolsExpanded: boolean;
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
    toolsExpanded: false,
    exitRequested: false,
  };
}
