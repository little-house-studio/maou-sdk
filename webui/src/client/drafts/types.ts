/**
 * Draft-only types for the wireframe shell.
 * Regions talk through props only — no live backend imports.
 */

/** Top-left: 界面模式 */
export type UiMode = "chat" | "project" | "team";

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
};

export type DraftMessage = {
  id: string;
  role: MessageRole;
  body: string;
  tag?: string;
  clickable?: boolean;
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
};
