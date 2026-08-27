import type { CSSProperties, ReactNode } from "react";
import { SlotOutlet } from "../slots";
import { SHELL_ACTIVITY } from "./metrics";
import { ShellFocusContext, useShellFocus, useShellRegion } from "./focus";
import type { WireHostBag } from "./types";

function ShellRegion({
  id,
  children,
}: {
  id: "topbar" | "bottom";
  children: ReactNode;
}) {
  return (
    <div className="wire-shell-region" {...useShellRegion(id)}>
      {children}
    </div>
  );
}

export function WireShell(bag: WireHostBag) {
  const live = bag.variant === "live";
  const chatRails = bag.mode === "chat";
  const focus = useShellFocus("center");
  const rails = {
    ["--shell-left"]: `${chatRails && bag.showLeft ? bag.leftW : 0}px`,
    ["--shell-files"]: `${chatRails && bag.showFiles ? bag.railW : 0}px`,
    ["--shell-activity"]: `${SHELL_ACTIVITY.width}px`,
  } as CSSProperties;
  return (
    <ShellFocusContext.Provider value={focus.region}>
      <div
        className={`wire-shell draft-shell${live ? " live-shell" : ""}${
          bag.mode === "settings" ? " has-settings" : ""
        }`}
        data-live-shell={live ? "true" : undefined}
        data-ui-mode={bag.mode}
        data-focus-region={focus.region}
        style={rails}
        onPointerDown={focus.onPointerDown}
        onFocusCapture={focus.onFocusIn}
      >
        <ShellRegion id="topbar">
          <SlotOutlet name="shell.topbar" props={bag} />
        </ShellRegion>
        <SlotOutlet name="shell.body" props={bag} />
        <ShellRegion id="bottom">
          <SlotOutlet name="shell.bottom" props={bag} />
        </ShellRegion>
        <SlotOutlet name="shell.overlay" props={bag} />
      </div>
    </ShellFocusContext.Provider>
  );
}
