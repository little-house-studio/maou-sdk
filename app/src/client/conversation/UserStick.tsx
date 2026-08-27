import React, { type ReactNode } from "react";
import { askAnchorProps, USER_STICK_CLASS } from "./contract";

/** Sticky user row. Optional ask payload marks the in-flow rail anchor. */
export function UserStick({
  children,
  ask,
}: {
  children: ReactNode;
  ask?: { id: string; preview: string };
}) {
  return (
    <div
      className={USER_STICK_CLASS}
      {...(ask ? askAnchorProps(ask.id, ask.preview) : {})}
    >
      {children}
    </div>
  );
}
