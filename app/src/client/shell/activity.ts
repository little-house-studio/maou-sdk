export type ActivityIconName = "files" | "bot";

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
export const SIDEBAR_ACTIVITY_ID = "sidebar";

export const RIGHT_ACTIVITY_TABS: ActivityTab[] = [
  { id: FILES_ACTIVITY_ID, label: "文件", icon: "files" },
];

export const LEFT_ACTIVITY_TABS: ActivityTab[] = [
  { id: SIDEBAR_ACTIVITY_ID, label: "侧栏", icon: "bot" },
];

export const DEFAULT_ACTIVITY_TABS = RIGHT_ACTIVITY_TABS;
