/**
 * Draft-only types for the wireframe shell.
 * Regions talk through props only — no live backend imports.
 */

/** Top-left: 界面模式 */
/** 顶栏模式：主动已迁到底栏 dock 卡片，不在此列 */
export type UiMode = "chat" | "project" | "team" | "settings";

export type MessageRole =
  | "user"
  | "assistant"
  | "system"
  | "tool"
  | "err"
  | "thinking";

/** 与 CLI agent-presence / agents overlay 对齐 */
export type AgentPresenceStatus =
  | "idle"
  | "running"
  | "done_unread"
  | "done_read"
  | "blocked"
  | "needs_reply";

/**
 * 扁平 agent 表（含 parent / group），展示时用 agent-tree 建成层级行。
 * 对齐 CLI AgentListEntry + listAgents。
 */
export type DraftAgent = {
  id: string;
  name: string;
  displayName?: string;
  role: string;
  status: AgentPresenceStatus;
  group: "system" | "project";
  /** 父 agent 的 name（子 agent 有值） */
  parent?: string;
  projectPath?: string;
  projectName?: string;
  overview?: string;
  stale?: boolean;
};

export type DraftSession = {
  id: string;
  title: string;
  agent: string;
  timeLabel: string;
  /** 用户发出条数，列表行用来辨认会话 */
  messageCount?: number;
  /** 子会话 / fork 的父会话，驱动顶部横向树 */
  parentSessionId?: string;
  lamp?:
    | "running"
    | "helpers"
    | "await_approval"
    | "plan_review"
    | "await_ask"
    | "done"
    | "idle";
  helperCount?: number;
};

/**
 * CLI-aligned tool card (ToolCardState / ProtoToolCard).
 * When present on role=tool, UI uses ToolCard fold/title/result logic.
 */
export type DraftToolCard = {
  name: string;
  /** JSON args or free-form input shown under ▸ 输入 */
  args?: string;
  /** Result dump; falls back to message.body when omitted */
  result?: string;
  done?: boolean;
  isError?: boolean;
  durationMs?: number;
  /** tool_call 参数 description：这一步在做什么 */
  description?: string;
};

/** CLI MessageRow head fields (ts / duration / usage / round / LIVE). */
export type DraftMessageMeta = {
  /** epoch ms — shows as HH:MM:SS */
  ts?: number;
  /** generation / tool duration */
  durationMs?: number;
  usageInput?: number;
  usageOutput?: number;
  /** loop mark ↺N */
  round?: number;
  streaming?: boolean;
  /** e.g. user / agent:coding */
  authorLabel?: string;
  /** e.g. human_user | queued_user | expanded */
  kind?: string;
  /** prompt 里命中缓存的部分（落盘账本回填） */
  cacheRead?: number;
  cacheWrite?: number;
  /** usage 是否报过 cache 字段；false → 命中率显示 “—” */
  cacheReported?: boolean;
  /** 落盘 entry id —— 调试面板据此拉本轮 POST */
  payloadId?: string;
  /** id 缺失时的定位口径：同类消息里的 0 基下标 */
  payloadIndex?: number;
  /** 该会话里的第几条（用户消息 / 助手轮），1 基 */
  ordinal?: number;
};

export type DraftThinkingMeta = {
  durationMs?: number;
  streaming?: boolean;
  /** default collapsed — body hidden until user expands */
  collapsed?: boolean;
  /** 思考输出 token（reasoning / completion 侧，有则展示） */
  outputTokens?: number;
  /** 思考开始时间（epoch ms，用于流式耗时） */
  startedAt?: number;
};

export type DraftMessage = {
  id: string;
  role: MessageRole;
  persisted?: boolean;
  body: string;
  /** Tool name shortcut (CLI tools[] / card name) */
  tag?: string;
  clickable?: boolean;
  /** Agent that owns this line (e.g. terminal attach) */
  agentName?: string;
  /** Structured tool card (preferred over raw body-only dumps) */
  tool?: DraftToolCard;
  /** Message head meta (duration / tokens / LIVE) */
  meta?: DraftMessageMeta;
  /** Thinking-line meta when role=thinking */
  thinking?: DraftThinkingMeta;
  images?: Array<{ mimeType: string; data: string; name?: string }>;
  toolCallId?: string;
  artifacts?: Array<{ path: string; delta: string }>;
};

export type DraftBgTask = {
  id: string;
  title: string;
  status: "running" | "done" | "queued";
  agent: string;
};

export type DraftMeta = {
  projectPath: string;
  projectLabel: string;
  agentName: string;
  sandboxMode: string;
  provider: string;
  model: string;
  offline?: boolean;
  /** token / usage 文案 */
  tokenLabel?: string;
};

export type DraftApproval = {
  id: string;
  summary: string;
  command: string;
  risk: "normal" | "high";
  agentName: string;
};

export type DraftScenarioFlags = {
  agentBusy: boolean;
  pendingApproval: DraftApproval | null;
  statusHint?: string;
  usageLabel?: string;
  /** 默认是否展开右侧文件栏 */
  showFiles?: boolean;
  /** 默认是否显示 diff 条 */
  showDiff?: boolean;
};

export type ScenarioId =
  | "normal"
  | "empty_thread"
  | "busy"
  | "pending_approval"
  | "mixed_roles"
  | "long_overflow"
  | "empty_sessions";

export type DraftScenario = {
  id: ScenarioId;
  label: string;
  description: string;
  sessions: DraftSession[];
  initialSessionId: string;
  messagesBySession: Record<string, DraftMessage[]>;
  meta: DraftMeta;
  flags: DraftScenarioFlags;
  fileTree: string[];
  termLines: string[];
  agents: DraftAgent[];
  initialAgentId: string;
  bgTasks: DraftBgTask[];
};

export type DraftShellProps = {
  /** @deprecated 独立草稿站不再使用；保留类型兼容 */
  onLeaveLab?: (next: "work" | "docs") => void;
  initialScenarioId?: ScenarioId;
  /** Test/dev: open settings surface on mount */
  initialSettingsOpen?: boolean;
};

/**
 * Aligns with core/llm APIPreset + CustomPreset connection + capability fields.
 * @see core/llm/src/adapters/types.ts APIPreset
 * @see core/llm/src/llm-config.ts CustomPreset
 */
export type DraftApiProtocol = "openai" | "anthropic" | "openai-responses";

export type DraftApiPreset = {
  name: string;
  url: string;
  key: string;
  model: string;
  protocol: DraftApiProtocol;
  /** Input context window (tokens) — compression / usage budget; not sent to vendor. */
  maxContext: number;
  /** Max output tokens per call (max_tokens / max_output_tokens). */
  maxTokens: number;
  /** Image attachments (guardrails supportsVision). */
  supportsVision: boolean;
  /** Thinking / reasoning (guardrails supportsReasoning). */
  supportsReasoning: boolean;
  /** Native tool schemas (guardrails nativeToolCalling). */
  nativeToolCalling: boolean;
};

/** Session-local API config (draft does not write ~/.maou/config.json). */
export type DraftApiConfig = {
  presets: DraftApiPreset[];
  defaultPreset: number;
};
