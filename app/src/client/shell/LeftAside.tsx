import { SlotOutlet } from "../slots";
import { ResizeHandle } from "../drafts/layout/ResizeHandle";
import { ActivityBar } from "./ActivityBar";
import { AsidePane } from "./AsidePane";
import { useShellRegion } from "./focus";
import type { WireHostBag } from "./types";

/** Activity icon + agents/sessions stack as one left unit, below the topbar. */
export function LeftAside(bag: WireHostBag) {
  const open = bag.mode === "chat" && bag.showLeft;
  return (
    <aside
      className="wire-aside is-left"
      data-panel={open ? "open" : "closed"}
      aria-label="左侧栏"
      {...useShellRegion("left")}
    >
      <ActivityBar {...bag.leftActivity} edge="left" />
      <AsidePane open={open} width={bag.leftW}>
        <div className="wire-left">
          <SlotOutlet name="shell.sidebar" props={bag} />
        </div>
      </AsidePane>
      {open ? (
        <ResizeHandle
          edge="right"
          size={bag.leftW}
          min={bag.leftMin}
          max={bag.leftMax}
          onResize={bag.onLeftResize}
          label="拖动调整左侧栏宽度"
        />
      ) : null}
    </aside>
  );
}
