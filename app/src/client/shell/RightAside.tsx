import { ResizeHandle } from "../drafts/layout/ResizeHandle";
import { ASIDE_RIGHT_PANE } from "../slots/map";
import { ActivityBar } from "./ActivityBar";
import { AsidePane } from "./AsidePane";
import { AsidePaneStack } from "./aside-tab";
import { useShellRegion } from "./focus";
import type { WireHostBag } from "./types";

/** Activity icons + the open right pane, below the topbar. */
export function RightAside(bag: WireHostBag) {
  const open = bag.mode === "chat" && bag.rightTab != null;
  return (
    <aside
      className="wire-aside"
      data-files={open ? "open" : "closed"}
      aria-label="右侧栏"
      {...useShellRegion("right")}
    >
      {open ? (
        <ResizeHandle
          edge="left"
          size={bag.railW}
          min={bag.railMin}
          max={bag.railMax}
          onResize={bag.onRailResize}
          label="拖动调整文件栏宽度"
        />
      ) : null}
      <AsidePane open={open} width={bag.railW} stick="end">
        <div
          className={`wire-right${bag.variant === "live" ? " live-files-rail" : ""}`}
          data-live-region={bag.variant === "live" ? "files" : undefined}
        >
          <AsidePaneStack
            name={ASIDE_RIGHT_PANE}
            activeId={bag.rightTab}
            props={bag}
          />
        </div>
      </AsidePane>
      <ActivityBar
        edge="right"
        activeId={open ? bag.rightTab : null}
        onSelect={bag.onRightTab}
      />
    </aside>
  );
}
