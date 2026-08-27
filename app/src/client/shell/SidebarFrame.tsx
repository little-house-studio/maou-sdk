import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { SlotOutlet } from "../slots";
import { setResizeCursor } from "../drafts/layout/resize-cursor";
import type { WireHostBag } from "./types";

export function SidebarFrame(bag: WireHostBag) {
  const stackRef = useRef<HTMLDivElement>(null);
  const onDrag = bag.onAgentSplitDrag;

  const onSplitDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const stack = stackRef.current;
      if (!stack) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      setResizeCursor("row");
      const drag = (ev: PointerEvent) => {
        onDrag(ev.clientY, stack.getBoundingClientRect());
      };
      const up = () => {
        setResizeCursor(null);
        window.removeEventListener("pointermove", drag);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
      };
      window.addEventListener("pointermove", drag);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
      onDrag(e.clientY, stack.getBoundingClientRect());
    },
    [onDrag],
  );

  return (
    <div className="wire-left-stack" ref={stackRef}>
      <div
        className="wire-left-agents"
        style={{ flex: `0 0 ${bag.agentPct}%` }}
      >
        <SlotOutlet name="sidebar.agents" props={bag} />
      </div>
      <div
        className="wire-v-split"
        role="separator"
        aria-orientation="horizontal"
        aria-label="拖动调整智能体与会话分栏"
        aria-valuenow={Math.round(bag.agentPct)}
        aria-valuemin={20}
        aria-valuemax={75}
        onPointerDown={onSplitDown}
      />
      <div className="wire-left-sessions">
        <SlotOutlet name="sidebar.sessions" props={bag} />
      </div>
    </div>
  );
}
