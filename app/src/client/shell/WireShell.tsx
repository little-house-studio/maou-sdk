import type { CSSProperties } from "react";
import { SlotOutlet } from "../slots";
import { SHELL_ACTIVITY } from "./metrics";
import type { WireHostBag } from "./types";

export function WireShell(bag: WireHostBag) {
  const live = bag.variant === "live";
  const chatRails = bag.mode === "chat";
  const rails = {
    ["--shell-left"]: `${chatRails && bag.showLeft ? bag.leftW : 0}px`,
    ["--shell-files"]: `${chatRails && bag.showFiles ? bag.railW : 0}px`,
    ["--shell-activity"]: `${SHELL_ACTIVITY.width}px`,
  } as CSSProperties;
  return (
    <div
      className={`wire-shell draft-shell${live ? " live-shell" : ""}${
        bag.mode === "settings" ? " has-settings" : ""
      }`}
      data-live-shell={live ? "true" : undefined}
      data-ui-mode={bag.mode}
      style={rails}
    >
      <SlotOutlet name="shell.topbar" props={bag} />
      <SlotOutlet name="shell.body" props={bag} />
      <SlotOutlet name="shell.bottom" props={bag} />
      <SlotOutlet name="shell.overlay" props={bag} />
    </div>
  );
}
