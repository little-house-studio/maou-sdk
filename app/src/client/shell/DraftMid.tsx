import { SlotOutlet } from "../slots";
import { useShellRegion } from "./focus";
import { LeftAside } from "./LeftAside";
import { RightAside } from "./RightAside";
import type { WireHostBag } from "./types";

/** Draft mid: exclusive mode switch (unmounts chat when leaving). */
export function DraftMid(bag: WireHostBag) {
  let mid;
  if (bag.mode === "settings") {
    mid = (
      <div className="wire-mid is-settings">
        <SlotOutlet name="shell.center" props={bag} slotKey="settings" />
      </div>
    );
  } else if (bag.mode === "project") {
    mid = (
      <div className="wire-mid is-project">
        <SlotOutlet name="shell.center" props={bag} slotKey="project" />
      </div>
    );
  } else if (bag.mode === "team") {
    mid = (
      <div className="wire-mid is-team">
        <SlotOutlet name="shell.center" props={bag} slotKey="team" />
      </div>
    );
  } else {
    mid = (
      <div className="wire-mid is-chat">
        <div className="wire-center">
          <SlotOutlet name="shell.center" props={bag} slotKey="chat" />
        </div>
      </div>
    );
  }
  return (
    <div className="wire-body">
      <LeftAside {...bag} />
      <div className="wire-body-main" {...useShellRegion("center")}>
        {mid}
      </div>
      <RightAside {...bag} />
    </div>
  );
}
