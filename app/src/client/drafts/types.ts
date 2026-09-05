/**
 * 草稿站专属类型（场景目录 / DraftShell props）。
 * 共享组件 prop 类型在 ../wire/types，此处再导出供草稿模块单点引入。
 */
import type {
  DraftAgent,
  DraftApproval,
  DraftBgTask,
  DraftMessage,
  DraftMeta,
  DraftSession,
} from "../wire/types";

export type * from "../wire/types";

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
