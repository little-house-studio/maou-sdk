import type { AgentListProps } from "../wire/sidebar/AgentList";
import type { SessionListProps } from "../wire/sidebar/SessionList";
import type { FilesRailProps } from "../wire/sidebar/FilesRail";
import type { BottomInfoBarProps } from "../wire/dock/BottomInfoBar";
import type { WireTopbarProps } from "../wire/chrome/WireTopbar";
import type { ContextPanelProps } from "../wire/chat/ContextPanel";
import type { DraftApiConfig, UiMode } from "../wire/types";
import type { ChatPanelProps } from "../ChatPanel";
import type { LiveSettingsPanelProps } from "../live/LiveSettingsPanel";
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
  leftTab: string | null;
  rightTab: string | null;
  onLeftTab: (id: string) => void;
  onRightTab: (id: string) => void;
  showFiles: boolean;
  showLeft: boolean;
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
