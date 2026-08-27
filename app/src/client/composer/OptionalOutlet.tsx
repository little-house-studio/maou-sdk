import React, { type ReactNode } from "react";
import { SlotOutlet, useOptionalSlots } from "../slots";
import type { ComposerProps } from "./types";

export function OptionalOutlet({
  name,
  props,
  fallback,
  slotKey,
}: {
  name: string;
  props: ComposerProps;
  fallback: ReactNode;
  slotKey?: string;
}) {
  const slots = useOptionalSlots();
  if (!slots?.spec(name)) return fallback;
  return (
    <SlotOutlet name={name} props={props} slotKey={slotKey} fallback={fallback} />
  );
}
