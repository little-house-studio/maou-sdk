import { useEffect, useState } from "react";
import { SlotOutlet } from "../slots";
import { useShellRegion } from "./focus";
import { LeftAside } from "./LeftAside";
import { RightAside } from "./RightAside";
import type { WireHostBag } from "./types";

/** Live body: chat stays mounted; settings/project/plugins are sibling mids. */
export function LiveMid(bag: WireHostBag) {
  const chatVisible = bag.mode === "chat";
  const settingsVisible = bag.mode === "settings";
  const [settingsVisited, setSettingsVisited] = useState(settingsVisible);
  useEffect(() => { if (settingsVisible) setSettingsVisited(true); }, [settingsVisible]);
  return (
    <div className="wire-body">
      <LeftAside {...bag} />
      <div className="wire-body-main" {...useShellRegion("center")}>
        {settingsVisible || settingsVisited ? (
          <div className={`wire-mid is-settings${settingsVisible ? "" : " is-hidden-mode"}`} data-live-region="settings" hidden={!settingsVisible} inert={!settingsVisible ? true : undefined}>
            <SlotOutlet name="shell.center" props={bag} slotKey="settings" />
          </div>
        ) : null}

        {bag.mode === "project" ? (
          <div className="wire-mid is-project" data-live-region="project">
            <SlotOutlet name="shell.center" props={bag} slotKey="project" />
          </div>
        ) : null}

        {bag.mode === "plugins" ? (
          <div className="wire-mid is-plugins" data-live-region="plugins">
            <SlotOutlet name="shell.center" props={bag} slotKey="plugins" />
          </div>
        ) : null}

        <div
          className={`wire-mid is-chat${chatVisible ? "" : " is-hidden-mode"}`}
          data-live-region="chat"
          hidden={!chatVisible}
          aria-hidden={!chatVisible}
        >
          <div className="wire-center" data-live-region="thread">
            <SlotOutlet name="shell.center" props={bag} slotKey="chat" />
          </div>
        </div>
      </div>
      <RightAside {...bag} />
    </div>
  );
}
