import { lazy, Suspense } from "react";
import { ChatPanel } from "../ChatPanel";
import { WireTopbar } from "../drafts/layout/WireTopbar";
import { AgentList } from "../drafts/panels/AgentList";
import { BottomInfoBar } from "../drafts/panels/BottomInfoBar";
import { TeamBoard } from "../drafts/panels/TeamBoard";
import { LiveFilesRail } from "../live/LiveFilesRail";
import { LiveSettingsPanel } from "../live/LiveSettingsPanel";
import { applySlotPlugins, SlotRegistry, type SlotPlugin } from "../slots";
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
import { Bot, FolderTree } from "lucide-react";
import { registerAsideTab } from "../shell/aside-tab";
import {
  FILES_ACTIVITY_ID,
  SIDEBAR_ACTIVITY_ID,
} from "../shell/activity";
import { LiveMid } from "../shell/LiveMid";
import { SidebarFrame } from "../shell/SidebarFrame";
import { WireShell } from "../shell/WireShell";
import type { WireHostBag } from "../shell/types";
import { LIVE_SESSION_RAIL_ID } from "./live-state";

const LiveProjectHostLazy = lazy(() =>
  import("../live/LiveProjectHost").then((m) => ({
    default: m.LiveProjectHost,
  })),
);

function TopbarSeat(bag: WireHostBag) {
  return <WireTopbar {...bag.topbar} />;
}

function AgentsSeat(bag: WireHostBag) {
  return <AgentList {...bag.agentList} />;
}

function LiveSessionRailSeat(bag: WireHostBag) {
  return (
    <div
      id={bag.sessionRailId || LIVE_SESSION_RAIL_ID}
      className="live-session-rail-host"
      data-live-session-rail="true"
    />
  );
}

function LiveChatSeat(bag: WireHostBag) {
  const chat = bag.chat;
  if (!chat) return null;
  const { remountKey, ...props } = chat;
  return <ChatPanel key={remountKey} {...props} />;
}

function LiveSettingsSeat(bag: WireHostBag) {
  if (!bag.liveSettings) return null;
  return <LiveSettingsPanel {...bag.liveSettings} />;
}

function LiveProjectSeat(bag: WireHostBag) {
  return (
    <Suspense
      fallback={
        <div className="live-project-host is-loading">
          <div className="live-project-bar">
            <span className="live-project-hint">加载项目界面…</span>
          </div>
        </div>
      }
    >
      <LiveProjectHostLazy
        projectLabel={bag.project.projectLabel}
        projectPath={bag.project.projectPath}
      />
    </Suspense>
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

function LiveFilesSeat() {
  return <LiveFilesRail />;
}

function BottomSeat(bag: WireHostBag) {
  return <BottomInfoBar {...bag.dock} />;
}

export function createLiveHostSlots(
  plugins?: readonly SlotPlugin[],
): SlotRegistry {
  const slots = new SlotRegistry();
  slots.register(
    { name: "root", registrant: "wire-shell", children: SHELL_CHILDREN },
    WireShell,
  );
  slots.register({ name: "shell.topbar", registrant: "topbar" }, TopbarSeat);
  slots.register(
    { name: "shell.body", registrant: "live-body", children: BODY_CHILDREN },
    LiveMid,
  );
  registerAsideTab(slots, {
    edge: "left",
    id: SIDEBAR_ACTIVITY_ID,
    label: "侧栏",
    icon: Bot,
    order: 10,
    registrant: "sidebar",
    pane: SidebarFrame,
    paneChildren: SIDEBAR_CHILDREN,
  });
  slots.register({ name: "sidebar.agents", registrant: "agents" }, AgentsSeat);
  slots.register(
    { name: "sidebar.sessions", registrant: "sessions" },
    LiveSessionRailSeat,
  );
  slots.register(
    {
      name: "shell.center",
      key: "chat",
      registrant: "chat",
      children: CONVERSATION_CHILDREN,
    },
    LiveChatSeat,
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
    LiveProjectSeat,
  );
  slots.register(
    { name: "shell.center", key: "team", registrant: "team" },
    TeamSeat,
  );
  slots.register(
    { name: "shell.center", key: "settings", registrant: "settings" },
    LiveSettingsSeat,
  );
  registerAsideTab(slots, {
    edge: "right",
    id: FILES_ACTIVITY_ID,
    label: "文件",
    icon: FolderTree,
    order: 10,
    registrant: "files",
    pane: LiveFilesSeat,
  });
  slots.register(
    { name: "shell.bottom", registrant: "bottom", children: BOTTOM_CHILDREN },
    BottomSeat,
  );
  applySlotPlugins(slots, plugins);
  return slots;
}
