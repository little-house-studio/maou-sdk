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

/** 与 context SessionEventKind 对齐（CLI 本地副本） */
export type SessionEventKind =
  | "human_user"
  | "queued_user"
  | "agent_message"
  | "runtime_control"
  | "system_notice"
  | "tool_call"
  | "tool_result"
  | "tool_async_notify"
  | "assistant_turn"
  | "compact"
  | "unknown";

/** 发言人身份（与 context MessageAuthor 对齐） */
export type MessageAuthorType = "human" | "agent" | "system" | "tool";
export interface MessageAuthor {
  type: MessageAuthorType;
  id?: string;
  displayName?: string;
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
  /** 会话事件语义（非 human 的 user wire 不应画用户气泡） */
  kind?: SessionEventKind;
  source?: string;
  /** 发言人：user / agent:xxx / system:xxx / tool:xxx */
  author?: MessageAuthor;
}

/** 系统事件（压缩/中断/失败/权限/环境等，独立行渲染） */
export interface SystemEvent {
  id: string;
  kind:
    | "compress"
    | "abort"
    | "retry_fail"
    | "hook"
    | "permission"
    | "env_error"
    | "other"
    | "agent_message"
    | "runtime_control"
    | "system_notice"
    | "session_inject";
  content: string;
  ts: number;
  detail?: string;       // 点击展开看详细
}

export type EventMode =
  | "idle"
  | "thinking"
  | "generating"
  | "tool_pending"
  | "retrying"
  | "error";


/** 审核模式（对应工具层 sandboxMode） */
export type ApprovalMode = "normal" | "auto" | "yolo";

export const APPROVAL_MODES: readonly ApprovalMode[] = ["normal", "auto", "yolo"] as const;

export const APPROVAL_LABELS: Record<ApprovalMode, { short: string; full: string; hint: string }> = {
  normal: { short: "询问", full: "Normal", hint: "每次询问" },
  auto: { short: "自动", full: "Auto", hint: "小模型审核自动放行" },
  yolo: { short: "全放", full: "Yolo", hint: "全部执行不问" },
};

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
  /** 本轮是否计入 cacheHistory（主模型且模型支持 cache 上报） */
  cacheEligible?: boolean;
}

/** 单轮缓存统计原始量（用于正确计算合并缓存率，避免 mean-of-rates 偏差）
 *  仅主 agent 当前主模型、且模型支持 prompt-cache 上报时写入。
 */
export interface CacheStat {
  cacheRead: number;
  input: number;
  /** 产生该样本时的主模型 id（换模后历史作废） */
  model?: string;
}

export type OverlayKind =
  | null
  | "command"
  | "model"
  | "sessions"
  | "help"
  | "settings"
  | "agents"
  | "prompt"
  | "theme";

/** 终端命令交互审批请求（normal 模式阻塞 agent 直至用户选择） */
export interface TerminalApprovalState {
  id: string;
  command: string;
  agentName: string;
  cwd?: string;
  /** @deprecated 用 summary；兼容旧字段 */
  hint?: string;
  /** low=普通确认(黄) high=危险确认(红底) */
  risk?: "low" | "high";
  /** 一句人话：这条命令在干什么 */
  summary?: string;
  /** 短标签：安装依赖 / 删除文件 … */
  label?: string;
  /** 安全规则 id */
  ruleId?: string;
  /** 安全层原因 */
  reason?: string;
}

/** 补全菜单状态（提升到 store，供 InputBar 与 app.tsx 全局按键共享） */
export interface CompletionState {
  items: CompletionItem[];
  sel: number;        // 当前选中索引
  prefix: string;     // 触发补全的前缀（如 "/s"、"@src/"）
  /** 在完整输入串中要替换的区间 [start, end)（end 通常=光标） */
  range: { start: number; end: number };
}

/** goal 监督状态（从 SDK SUPERVISOR_MANAGER 查询，done event meta 触发） */
export interface SupervisorState {
  active: boolean;
  mainSessionId: string | null;
  supervisorSessionId: string | null;
  state: "planning" | "confirming_plan" | "started" | "confirming" | "ended";
  plan?: string;
  verifyRounds?: number;
  lastVerdict?: "pass" | "fail" | "loop";
}

export interface UIState {
  messages: ChatMessage[];
  systemEvents: SystemEvent[];   // 系统事件行（压缩/中断/失败等）
  currentAssistantId: string | null;
  streaming: boolean;
  aborting: boolean;
  sessionId: string | null;
  /**
   * 空会话画廊种子（/new 时刷新，同会话内稳定，避免每帧换画）。
   * 有消息后画廊隐藏，直到再次 new/clear。
   */
  gallerySeed: string;
  agentName: string;
  provider: string;
  model: string;
  maxContext: number;
  round: number;
  thinkingLevel: number;
  /**
   * 审核/审批模式（= runtime sandboxMode）
   * normal 每次询问 · auto 小模型审核 · yolo 全放行
   */
  approvalMode: ApprovalMode;
  /** 当前待用户确认的终端命令；非 null 时底部显示审批条 */
  terminalApproval: TerminalApprovalState | null;
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
  overlayScrollCmd: { dir: "up" | "down"; nonce: number } | null;  // 滚轮→overlay 菜单滚动指令
  // goal 监督状态（done event supervisorMode 触发，SUPERVISOR_MANAGER 查询更新）
  supervisor: SupervisorState | null;
  // supervisor 的输出（计划/评语/验收）独立数组，不进主对话区 messages，避免混乱
  supervisorMessages: ChatMessage[];
  // EventBlock 展开模式（supervisor 输出可滚动查看）
  eventBlockExpanded: boolean;
  supervisorScrollCmd: { dir: "up" | "down"; nonce: number } | null;  // 滚轮→EventBlock 展开滚动指令
  lastStreamNonce: number;  // 每次 onStream 递增，驱动事件驱动型 hook 重查
  supervisorCheckNonce: number;  // 只在 tool_result/done 递增，驱动 useSupervisorState（避免 delta 高频）
  // 通用发送桥接：组件（GoalPanel 等）设文本，app.tsx 监听后 send 给 runtime
  pendingSend: string | null;
  // 会话按 agent 记忆：切 agent 时缓存当前会话，切回时恢复
  agentSessionMap: Record<string, { sessionId: string | null; messages: ChatMessage[]; systemEvents: SystemEvent[] }>;
  chatScrollOffset: number;       // 对话区滚动偏移（fromBottom）
  maxChatScroll: number;          // 可滚最大 fromBottom
  autoFollow: boolean;            // 贴底跟随新消息
  /**
   * 右上角 Debug 性能条（PerfHud）。
   * 默认开；`MAOU_PERF_HUD=0` 关；设置里切换会写入 ~/.maou/cli-ui.json 持久化。
   */
  perfHud: boolean;
  /** SGR 鼠标捕获；持久化见 ~/.maou/cli-ui.json mouseCapture */
  mouseCapture: boolean;
  /**
   * 屏幕世代：/new 清屏、强制刷新时递增。
   * Ratatui bridge 检测变化后发 full_paint，避免 Node CSI 清屏打乱双缓冲。
   */
  screenEpoch: number;
  /** 历史窗口起点；-1=请求收成贴底 200 条 */
  chatHistoryStart: number;
  /** 滚轮滚动中（降 paint / hover） */
  scrollActive: boolean;
  /**
   * 对话内容几何世代：MD/ToolCard 展开收起时递增，
   * 驱动 ScrollHistory 重测 contentH（否则贴底裁切、展开不改变最底）。
   */
  contentLayoutEpoch: number;
}
