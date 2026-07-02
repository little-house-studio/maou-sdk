/**
 * UI 状态模型 —— reducer 与 store 共享的状态形状。
 *
 * 对齐 27 个 StreamEvent 的映射。重点陷阱：
 *  - error 后 runAgentCli 立即 return，reducer 收不到后续 done → error 分支也置 streaming:false
 *  - tool_call.tool 是对象 {id,name,parameters,...}；tool_result 的 toolCallId/name/content/ok 是顶层
 *  - model.usage 裸 {usage}；assistant.usage 含 max_context
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
}

export interface RoundUsage {
  input: number;
  output: number;
  total?: number;
  cacheRead?: number;
}

export type OverlayKind = null | "command" | "model" | "sessions" | "help";

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
  overlay: OverlayKind;
  mouseCursorCol: number | null;  // 鼠标点击输入框目标列
  chatScrollOffset: number;       // 对话区滚动偏移
}
