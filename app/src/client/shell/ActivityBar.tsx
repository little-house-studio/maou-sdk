import React from "react";
import { SlotOutlet } from "../slots";
import { ASIDE_LEFT_TAB, ASIDE_RIGHT_TAB } from "../slots/map";
import type { ActivityBarProps } from "./activity";

/** Slim icon strip. Tabs come from aside.*.tab; host owns the open id. */
export function ActivityBar({
  activeId,
  onSelect,
  edge = "right",
}: ActivityBarProps) {
  const name = edge === "left" ? ASIDE_LEFT_TAB : ASIDE_RIGHT_TAB;
  return (
    <nav
      className={`wire-activity is-${edge}`}
      aria-label={edge === "left" ? "左侧页签" : "右侧页签"}
    >
      <SlotOutlet name={name} props={{ activeId, onSelect, edge }} />
    </nav>
  );
}
