import { ResizeHandle } from "../wire/chrome/ResizeHandle";
import { ASIDE_LEFT_PANE } from "../slots/map";
import { ActivityBar } from "./ActivityBar";
import { modeShowsLeftRail } from "./activity";
import { AsidePane, useAsideLatch } from "./AsidePane";
import { AsidePaneStack } from "./aside-tab";
import { useShellRegion } from "./focus";
import type { WireHostBag } from "./types";

/** Activity icons + the open left pane, below the topbar. */
export function LeftAside(bag: WireHostBag) {
  const open = modeShowsLeftRail(bag.mode) && bag.leftTab != null;
  const latch = useAsideLatch(open);
  return (
    <aside
      className="wire-aside is-left"
      data-panel={open ? "open" : "closed"}
      aria-label="左侧栏"
      {...useShellRegion("left")}
    >
      <ActivityBar
        edge="left"
        activeId={open ? bag.leftTab : null}
        onSelect={bag.onLeftTab}
      />
      <AsidePane open={open} width={bag.leftW}>
        <div className="wire-left">
          <AsidePaneStack
            name={ASIDE_LEFT_PANE}
            activeId={bag.leftTab}
            props={bag}
          />
        </div>
      </AsidePane>
      {latch ? (
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
