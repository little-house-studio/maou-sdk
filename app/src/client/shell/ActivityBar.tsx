import React from "react";
import { Bot, FolderTree, type LucideIcon } from "lucide-react";
import type { ActivityBarProps, ActivityIconName } from "./activity";

const ICONS: Record<ActivityIconName, LucideIcon> = {
  files: FolderTree,
  bot: Bot,
};

/** Slim icon strip. Tabs are data; host owns which panel is open. */
export function ActivityBar({
  tabs,
  activeId,
  onSelect,
  edge = "right",
}: ActivityBarProps) {
  return (
    <nav
      className={`wire-activity is-${edge}`}
      aria-label={edge === "left" ? "左侧页签" : "右侧页签"}
    >
      {tabs.map((tab) => {
        const on = tab.id === activeId;
        const Icon = ICONS[tab.icon];
        return (
          <button
            key={tab.id}
            type="button"
            className={`wire-activity-tab${on ? " is-on" : ""}`}
            aria-pressed={on}
            aria-label={tab.label}
            title={tab.label}
            onClick={() => onSelect(tab.id)}
          >
            <Icon
              className="wire-activity-icon"
              size={18}
              strokeWidth={1.5}
              absoluteStrokeWidth
              strokeLinecap="square"
              strokeLinejoin="miter"
              aria-hidden
            />
          </button>
        );
      })}
    </nav>
  );
}
