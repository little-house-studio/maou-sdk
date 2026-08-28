import React, {
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from "react";
import { SlotOutlet, useOptionalSlots } from "../slots";
import type { SlotChildren, SlotRegistry } from "../slots";
import {
  ASIDE_LEFT_PANE,
  ASIDE_LEFT_TAB,
  ASIDE_RIGHT_PANE,
  ASIDE_RIGHT_TAB,
} from "../slots/map";
import type { ActivityBarProps } from "./activity";

export type AsideEdge = "left" | "right";

export type AsideTabIcon = ComponentType<{
  className?: string;
  size?: number | string;
  strokeWidth?: number | string;
  absoluteStrokeWidth?: boolean;
  strokeLinecap?: "inherit" | "round" | "butt" | "square";
  strokeLinejoin?: "inherit" | "miter" | "round" | "bevel";
  "aria-hidden"?: boolean;
}>;

export type RegisterAsideTabSpec<P extends object = object> = {
  edge: AsideEdge;
  id: string;
  label: string;
  icon: AsideTabIcon;
  pane: ComponentType<P>;
  order?: number;
  registrant?: string;
  paneChildren?: SlotChildren;
};

export type AsideTabClickProps = ActivityBarProps & { slotId?: string };

function tabSeatName(edge: AsideEdge): string {
  return edge === "left" ? ASIDE_LEFT_TAB : ASIDE_RIGHT_TAB;
}

function paneSeatName(edge: AsideEdge): string {
  return edge === "left" ? ASIDE_LEFT_PANE : ASIDE_RIGHT_PANE;
}

function makeTabSeat<P extends object>(spec: RegisterAsideTabSpec<P>) {
  return function AsideTabSeat(props: AsideTabClickProps) {
    const id = props.slotId ?? spec.id;
    const on = id === props.activeId;
    const Icon = spec.icon;
    return (
      <button
        type="button"
        className={`wire-activity-tab${on ? " is-on" : ""}`}
        aria-pressed={on}
        aria-label={spec.label}
        title={spec.label}
        onClick={() => props.onSelect(id)}
      >
        <Icon
          className="wire-activity-icon"
          size={18}
          strokeWidth={1.5}
          absoluteStrokeWidth
          strokeLinecap="square"
          strokeLinejoin="miter"
          aria-hidden
        />
      </button>
    );
  };
}

/** Tab button + pane, same id. Waits until the edge seats exist. Unload runs both. */
export function registerAsideTab<P extends object>(
  slots: SlotRegistry,
  spec: RegisterAsideTabSpec<P>,
): () => void {
  return slots.inject(tabSeatName(spec.edge), () => {
    const offTab = slots.register(
      {
        name: tabSeatName(spec.edge),
        id: spec.id,
        order: spec.order ?? 0,
        label: spec.label,
        registrant: spec.registrant ?? spec.id,
      },
      makeTabSeat(spec),
    );
    const offPane = slots.register(
      {
        name: paneSeatName(spec.edge),
        key: spec.id,
        registrant: spec.registrant ?? spec.id,
        ...(spec.paneChildren ? { children: spec.paneChildren } : {}),
      },
      spec.pane,
    );
    return () => {
      offTab();
      offPane();
    };
  });
}

function useOptionalSlotVersion(name: string): number {
  const slots = useOptionalSlots();
  return useSyncExternalStore(
    (cb) => (slots ? slots.subscribe(name, cb) : () => undefined),
    () => slots?.getVersion(name) ?? 0,
    () => slots?.getVersion(name) ?? 0,
  );
}

/** Every registered pane stays mounted; only `activeId` is shown. */
export function AsidePaneStack({
  name,
  activeId,
  props,
}: {
  name: string;
  activeId: string | null;
  props: object;
}): ReactNode {
  const slots = useOptionalSlots();
  useOptionalSlotVersion(name);
  const keys = (slots?.entriesOfSlot(name) ?? [])
    .map((e) => e.options.key)
    .filter((k): k is string => Boolean(k));
  return keys.map((id) => (
    <div key={id} hidden={id !== activeId} data-aside-pane={id}>
      <SlotOutlet name={name} props={props} slotKey={id} />
    </div>
  ));
}
