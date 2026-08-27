import { SlotOutlet } from "../slots";
import { ResizeHandle } from "../drafts/layout/ResizeHandle";
import type { WireHostBag } from "./types";

/** Files rail + activity tabs as one right unit, below the topbar. */
export function RightAside(bag: WireHostBag) {
  const filesOpen = bag.mode === "chat" && bag.showFiles;
  return (
    <aside
      className="wire-aside"
      data-files={filesOpen ? "open" : "closed"}
      aria-label="右侧栏"
    >
      {filesOpen ? (
        <>
          <ResizeHandle
            edge="left"
            size={bag.railW}
            min={bag.railMin}
            max={bag.railMax}
            onResize={bag.onRailResize}
            label="拖动调整文件栏宽度"
          />
          <div
            className={`wire-right${bag.variant === "live" ? " live-files-rail" : ""}`}
            style={{ width: bag.railW }}
            data-live-region={bag.variant === "live" ? "files" : undefined}
          >
            <SlotOutlet name="shell.files" props={bag} />
          </div>
        </>
      ) : null}
      <SlotOutlet name="shell.activity" props={bag} />
    </aside>
  );
}
