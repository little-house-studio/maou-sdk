import { SlotOutlet } from "../slots";
import type { WireHostBag } from "./types";

/**
 * 聊天左栏只放会话；项目左栏只放 agent 名册。
 * 两栏不再上下对切。
 */
export function SidebarFrame(bag: WireHostBag) {
  if (bag.mode === "project") {
    return (
      <div className="wire-left-stack is-agents-only">
        <div className="wire-left-agents">
          <SlotOutlet name="sidebar.agents" props={bag} />
        </div>
      </div>
    );
  }
  return (
    <div className="wire-left-stack is-sessions-only">
      <div className="wire-left-sessions">
        <SlotOutlet name="sidebar.sessions" props={bag} />
      </div>
    </div>
  );
}
