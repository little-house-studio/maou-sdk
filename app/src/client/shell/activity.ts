export type ActivityIconName = "files" | "bot" | "sessions";

export type ActivityTab = {
  id: string;
  label: string;
  icon: ActivityIconName;
};

export type ActivityBarProps = {
  tabs: readonly ActivityTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  edge?: "left" | "right";
};

export const FILES_ACTIVITY_ID = "files";
export const AGENTS_ACTIVITY_ID = "agents";
export const SESSIONS_ACTIVITY_ID = "sessions";

export const RIGHT_ACTIVITY_TABS: ActivityTab[] = [
  { id: FILES_ACTIVITY_ID, label: "文件", icon: "files" },
];

export const LEFT_ACTIVITY_TABS: ActivityTab[] = [
  { id: AGENTS_ACTIVITY_ID, label: "智能体", icon: "bot" },
  { id: SESSIONS_ACTIVITY_ID, label: "会话", icon: "sessions" },
];

export const DEFAULT_ACTIVITY_TABS = RIGHT_ACTIVITY_TABS;

export type LeftActivityId =
  | typeof AGENTS_ACTIVITY_ID
  | typeof SESSIONS_ACTIVITY_ID;
