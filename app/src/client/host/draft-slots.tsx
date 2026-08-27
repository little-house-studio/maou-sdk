import { WireTopbar } from "../drafts/layout/WireTopbar";
import { AgentList } from "../drafts/panels/AgentList";
import { SessionList } from "../drafts/panels/SessionList";
import { ContextPanel } from "../drafts/panels/ContextPanel";
import { FilesRail } from "../drafts/panels/FilesRail";
import { ProjectWorkbench } from "../drafts/panels/ProjectWorkbench";
import { SettingsPanel } from "../drafts/panels/SettingsPanel";
import { TeamBoard } from "../drafts/panels/TeamBoard";
import { BottomInfoBar } from "../drafts/panels/BottomInfoBar";
import { SlotRegistry } from "../slots";
import {
  ApprovalToolSeat,
  ComposerBarSeat,
  ComposerFooterSeat,
  ComposerSeat,
  ConversationNodeSeat,
  ImageAttachSeat,
  ModelToolSeat,
  MoreToolsSeat,
  QueueDockSeat,
  SlashSeat,
  UsageToolSeat,
} from "../composer/seats";
import {
  BODY_CHILDREN,
  BOTTOM_CHILDREN,
  COMPOSER_BAR_CHILDREN,
  COMPOSER_CHILDREN,
  CONVERSATION_CHILDREN,
  SHELL_CHILDREN,
  SIDEBAR_CHILDREN,
} from "../slots/map";
import { ActivityBar } from "../shell/ActivityBar";
import { DraftMid } from "../shell/DraftMid";
import { SidebarFrame } from "../shell/SidebarFrame";
import { WireShell } from "../shell/WireShell";
import type { WireHostBag } from "../shell/types";

function TopbarSeat(bag: WireHostBag) {
  return <WireTopbar {...bag.topbar} />;
}

function ActivitySeat(bag: WireHostBag) {
  return <ActivityBar {...bag.activity} edge="right" />;
}

function AgentsSeat(bag: WireHostBag) {
  return <AgentList {...bag.agentList} />;
}

function SessionsSeat(bag: WireHostBag) {
  if (!bag.sessionList) return null;
  return <SessionList {...bag.sessionList} />;
}

function DraftChatSeat(bag: WireHostBag) {
  if (!bag.draftContext) return null;
  return <ContextPanel {...bag.draftContext} />;
}

function DraftSettingsSeat(bag: WireHostBag) {
  if (!bag.draftSettings) return null;
  return (
    <SettingsPanel
      api={bag.draftSettings.api}
      onApiChange={bag.draftSettings.onApiChange}
      presentation="page"
      onClose={bag.draftSettings.onClose}
    />
  );
}

function DraftProjectSeat(bag: WireHostBag) {
  return (
    <ProjectWorkbench
      projectLabel={bag.project.projectLabel}
      projectPath={bag.project.projectPath}
    />
  );
}

function TeamSeat(bag: WireHostBag) {
  return (
    <TeamBoard
      agents={bag.agentList.agents}
      activeId={bag.agentList.activeId}
      onSelectAgent={bag.agentList.onSelect}
      onOpenChat={() => bag.topbar.onModeChange("chat")}
    />
  );
}

function DraftFilesSeat(bag: WireHostBag) {
  if (!bag.files) return null;
  return <FilesRail {...bag.files} />;
}

function BottomSeat(bag: WireHostBag) {
  return <BottomInfoBar {...bag.dock} />;
}

export function createDraftHostSlots(): SlotRegistry {
  const slots = new SlotRegistry();
  slots.register(
    { name: "root", registrant: "wire-shell", children: SHELL_CHILDREN },
    WireShell,
  );
  slots.register({ name: "shell.topbar", registrant: "topbar" }, TopbarSeat);
  slots.register(
    { name: "shell.body", registrant: "draft-body", children: BODY_CHILDREN },
    DraftMid,
  );
  slots.register(
    {
      name: "shell.sidebar",
      registrant: "sidebar",
      children: SIDEBAR_CHILDREN,
    },
    SidebarFrame,
  );
  slots.register({ name: "sidebar.agents", registrant: "agents" }, AgentsSeat);
  slots.register(
    { name: "sidebar.sessions", registrant: "sessions" },
    SessionsSeat,
  );
  slots.register(
    {
      name: "shell.center",
      key: "chat",
      registrant: "chat",
      children: CONVERSATION_CHILDREN,
    },
    DraftChatSeat,
  );
  slots.register(
    { name: "conversation.trail", registrant: "trail" },
    ConversationNodeSeat,
  );
  slots.register(
    { name: "conversation.messages", registrant: "messages" },
    ConversationNodeSeat,
  );
  slots.register(
    { name: "conversation.permit", registrant: "permit" },
    ConversationNodeSeat,
  );
  slots.register(
    {
      name: "conversation.composer",
      registrant: "composer",
      children: COMPOSER_CHILDREN,
      select: (props) => props,
    },
    ComposerSeat,
  );
  slots.register(
    { name: "composer.queue", id: "queue", registrant: "queue" },
    QueueDockSeat,
  );
  slots.register(
    { name: "composer.footer", id: "hints", registrant: "hints" },
    ComposerFooterSeat,
  );
  slots.register(
    {
      name: "composer.bar",
      registrant: "composer-bar",
      children: COMPOSER_BAR_CHILDREN,
    },
    ComposerBarSeat,
  );
  slots.register(
    { name: "composer.overlay", id: "slash", registrant: "slash" },
    SlashSeat,
  );
  slots.register(
    { name: "composer.model", registrant: "model" },
    ModelToolSeat,
  );
  slots.register(
    { name: "composer.approval-mode", registrant: "approval-mode" },
    ApprovalToolSeat,
  );
  slots.register(
    { name: "composer.usage", registrant: "usage" },
    UsageToolSeat,
  );
  slots.register(
    { name: "composer.left", id: "image", registrant: "image" },
    ImageAttachSeat,
  );
  slots.register(
    { name: "composer.left", id: "more", registrant: "more" },
    MoreToolsSeat,
  );
  slots.register(
    { name: "shell.center", key: "project", registrant: "project" },
    DraftProjectSeat,
  );
  slots.register(
    { name: "shell.center", key: "team", registrant: "team" },
    TeamSeat,
  );
  slots.register(
    { name: "shell.center", key: "settings", registrant: "settings" },
    DraftSettingsSeat,
  );
  slots.register({ name: "shell.files", registrant: "files" }, DraftFilesSeat);
  slots.register(
    { name: "shell.activity", registrant: "activity" },
    ActivitySeat,
  );
  slots.register(
    { name: "shell.bottom", registrant: "bottom", children: BOTTOM_CHILDREN },
    BottomSeat,
  );
  return slots;
}
