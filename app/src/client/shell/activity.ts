export const FILES_ACTIVITY_ID = "files";
export const SIDEBAR_ACTIVITY_ID = "sidebar";

/** 聊天（会话）与项目（agent 名册）共用左栏；设置 / 插件不占。 */
export function modeShowsLeftRail(mode: string): boolean {
  return mode === "chat" || mode === "project";
}

export type ActivityBarProps = {
  activeId: string | null;
  onSelect: (id: string) => void;
  edge?: "left" | "right";
};

/** Same tab again closes the pane; any other id opens it. */
export function toggleAsideTab(
  current: string | null,
  id: string,
): string | null {
  return current === id ? null : id;
}
