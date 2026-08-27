import { SlotOutlet } from "../slots";
import { ResizeHandle } from "../drafts/layout/ResizeHandle";
import { ActivityBar } from "./ActivityBar";
import type { WireHostBag } from "./types";

/** Activity icons + agents/sessions as one left unit, below the topbar. */
export function LeftAside(bag: WireHostBag) {
  const open = bag.mode === "chat" && bag.showLeft;
  return (
    <aside
      className="wire-aside is-left"
      data-panel={open ? "open" : "closed"}
      aria-label="左侧栏"
    >
      <ActivityBar {...bag.leftActivity} edge="left" />
      {open ? (
        <>
          <div className="wire-left" style={{ width: bag.leftW }}>
            <SlotOutlet name="shell.sidebar" props={bag} />
          </div>
          <ResizeHandle
            edge="right"
            size={bag.leftW}
            min={bag.leftMin}
            max={bag.leftMax}
            onResize={bag.onLeftResize}
            label="拖动调整左侧栏宽度"
          />
        </>
      ) : null}
    </aside>
  );
}
