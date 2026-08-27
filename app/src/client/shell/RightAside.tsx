import { SlotOutlet } from "../slots";
import { ResizeHandle } from "../drafts/layout/ResizeHandle";
import { AsidePane } from "./AsidePane";
import { useShellRegion } from "./focus";
import type { WireHostBag } from "./types";

/** Files rail + activity icon as one right unit, below the topbar. */
export function RightAside(bag: WireHostBag) {
  const filesOpen = bag.mode === "chat" && bag.showFiles;
  return (
    <aside
      className="wire-aside"
      data-files={filesOpen ? "open" : "closed"}
      aria-label="右侧栏"
      {...useShellRegion("right")}
    >
      {filesOpen ? (
        <ResizeHandle
          edge="left"
          size={bag.railW}
          min={bag.railMin}
          max={bag.railMax}
          onResize={bag.onRailResize}
          label="拖动调整文件栏宽度"
        />
      ) : null}
      <AsidePane open={filesOpen} width={bag.railW} stick="end">
        <div
          className={`wire-right${bag.variant === "live" ? " live-files-rail" : ""}`}
          data-live-region={bag.variant === "live" ? "files" : undefined}
        >
          <SlotOutlet name="shell.files" props={bag} />
        </div>
      </AsidePane>
      <SlotOutlet name="shell.activity" props={bag} />
    </aside>
  );
}
