import type { AgentListProps } from "../drafts/panels/AgentList";
import type { SessionListProps } from "../drafts/panels/SessionList";
import type { FilesRailProps } from "../drafts/panels/FilesRail";
import type { BottomInfoBarProps } from "../drafts/panels/BottomInfoBar";
import type { WireTopbarProps } from "../drafts/layout/WireTopbar";
import type { ContextPanelProps } from "../drafts/panels/ContextPanel";
import type { DraftApiConfig, UiMode } from "../drafts/types";
import type { ChatPanelProps } from "../ChatPanel";
import type { LiveSettingsPanelProps } from "../live/LiveSettingsPanel";
import type { ActivityBarProps, LeftActivityId } from "./activity";

export type WireShellVariant = "draft" | "live";

export type LiveChatBag = ChatPanelProps & { remountKey: string };

export type DraftSettingsBag = {
  api: DraftApiConfig;
  onApiChange: (next: DraftApiConfig) => void;
  onClose: () => void;
};

export type ProjectBag = {
  projectLabel: string;
  projectPath: string;
};

/**
 * Root props bag. Seats pick the slice they render; extra keys are ignored.
 */
export type WireHostBag = {
  variant: WireShellVariant;
  mode: UiMode;
  showFiles: boolean;
  showLeft: boolean;
  leftPane: LeftActivityId;
  leftW: number;
  agentPct: number;
  railW: number;
  railMin: number;
  railMax: number;
  leftMin: number;
  leftMax: number;
  onLeftResize: (n: number) => void;
  onRailResize: (n: number) => void;
  onAgentSplitDrag: (clientY: number, rect: DOMRect) => void;
  sessionRailId: string;
  topbar: WireTopbarProps;
  leftActivity: ActivityBarProps;
  activity: ActivityBarProps;
  agentList: AgentListProps;
  sessionList?: SessionListProps;
  files?: FilesRailProps;
  dock: BottomInfoBarProps;
  chat?: LiveChatBag;
  liveSettings?: LiveSettingsPanelProps;
  draftSettings?: DraftSettingsBag;
  draftContext?: ContextPanelProps;
  project: ProjectBag;
};
