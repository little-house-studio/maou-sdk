import { SlotOutlet } from "../slots";
import { LeftAside } from "./LeftAside";
import { RightAside } from "./RightAside";
import type { WireHostBag } from "./types";

/** Live body: chat stays mounted; settings/project/team are sibling mids. */
export function LiveMid(bag: WireHostBag) {
  const chatVisible = bag.mode === "chat";
  return (
    <div className="wire-body">
      <LeftAside {...bag} />
      <div className="wire-body-main">
        {bag.mode === "settings" ? (
          <div className="wire-mid is-settings" data-live-region="settings">
            <SlotOutlet name="shell.center" props={bag} slotKey="settings" />
          </div>
        ) : null}

        {bag.mode === "project" ? (
          <div className="wire-mid is-project" data-live-region="project">
            <SlotOutlet name="shell.center" props={bag} slotKey="project" />
          </div>
        ) : null}

        {bag.mode === "team" ? (
          <div className="wire-mid is-team" data-live-region="team">
            <SlotOutlet name="shell.center" props={bag} slotKey="team" />
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
