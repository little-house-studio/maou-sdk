import { SlotOutlet } from "../slots";
import { SESSIONS_ACTIVITY_ID } from "./activity";
import type { WireHostBag } from "./types";

export function SidebarFrame(bag: WireHostBag) {
  const sessions = bag.leftPane === SESSIONS_ACTIVITY_ID;
  return (
    <div className="wire-left-stack">
      <div
        className="wire-left-agents"
        hidden={sessions}
        aria-hidden={sessions}
      >
        <SlotOutlet name="sidebar.agents" props={bag} />
      </div>
      <div
        className="wire-left-sessions"
        hidden={!sessions}
        aria-hidden={!sessions}
      >
        <SlotOutlet name="sidebar.sessions" props={bag} />
      </div>
    </div>
  );
}
