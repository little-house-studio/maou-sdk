/**
 * UI 状态模型 —— reducer 与 store 共享的状态形状。
 *
 * 对齐 27 个 StreamEvent 的映射。重点陷阱：
 *  - error 后 runAgentCli 立即 return，reducer 收不到后续 done → error 分支也置 streaming:false
 *  - tool_call.tool 是对象 {id,name,parameters,...}；tool_result 的 toolCallId/name/content/ok 是顶层
 *  - model.usage 裸 {usage}；assistant.usage 含 max_context
 */

import type { CompletionItem } from "../overlay/Completer.js";

export interface ToolCardState {
  id: string;
  name: string;
  args: string;          // JSON.stringify(parameters)
  result?: string;       // 截断后
  isError?: boolean;
  done: boolean;
  callStartTs?: number;  // 调用开始时间戳
  callDuration?: number; // 返回耗时（ms）
}

export interface ThinkingBlock {
  id: string;
  content: string;
  streaming: boolean;
  startTs?: number;      // 开始时间戳
  duration?: number;     // 生成耗时（ms），streaming 结束时填
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
  doneTs?: number;       // 生成完成时间戳
  duration?: number;     // 生成耗时（ms）
  round?: number;        // 所属 loop 块编号
  agentType?: string;    // agent 类型（子 agent 时）
  agentName?: string;    // 子 agent 名字
}

/** 系统事件（压缩/中断/失败/权限/环境等，独立行渲染） */
export interface SystemEvent {
  id: string;
  kind: "compress" | "abort" | "retry_fail" | "hook" | "permission" | "env_error" | "other";
  content: string;
  ts: number;
  detail?: string;       // 点击展开看详细
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

/** 单轮缓存统计原始量（用于正确计算合并缓存率，避免 mean-of-rates 偏差） */
export interface CacheStat {
  cacheRead: number;
  input: number;
}

export type OverlayKind = null | "command" | "model" | "sessions" | "help" | "settings" | "agents";

/** 补全菜单状态（提升到 store，供 InputBar 与 app.tsx 全局按键共享） */
export interface CompletionState {
  items: CompletionItem[];
  sel: number;        // 当前选中索引
  prefix: string;     // 触发补全的前缀（/ 或 @path）
}

export interface UIState {
  messages: ChatMessage[];
  systemEvents: SystemEvent[];   // 系统事件行（压缩/中断/失败等）
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
  overlay: OverlayKind;
  mouseCursorCol: number | null;  // 鼠标点击输入框目标列
  inputRect: { left: number; top: number; width: number; height: number } | null;  // InputBar 屏幕矩形（hitTest 用）
  inputTextSel: { startIdx: number; endIdx: number } | null;  // 输入框文本选区（字符索引，退格删除用）
  inputSelectCmd: { col: number; line: number; phase: "start" | "extend"; nonce: number } | null;  // 鼠标→输入框选区指令
  // 会话按 agent 记忆：切 agent 时缓存当前会话，切回时恢复
  agentSessionMap: Record<string, { sessionId: string | null; messages: ChatMessage[]; systemEvents: SystemEvent[] }>;
  chatScrollOffset: number;       // 对话区滚动偏移
}
