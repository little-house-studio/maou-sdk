import { SlotOutlet } from "../slots";
import { useLiveHostBag } from "./live-state";

export function LiveApp() {
  const bag = useLiveHostBag();
  return <SlotOutlet name="root" props={bag} />;
}
