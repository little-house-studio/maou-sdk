import React, { type KeyboardEvent, type ReactNode } from "react";
import { askAnchorProps, USER_STICK_CLASS } from "./contract";
import { scrollStickHome } from "./scroll-offset";
import {
  STICK_CHILD_INTERACTIVE,
  stickClickGoesHome,
  stickHasTextSelection,
} from "./stick-click";

/** Sticky user row. Click jumps the scroller to this row's in-flow top. */
export function UserStick({
  children,
  ask,
  className = "",
}: {
  children: ReactNode;
  ask?: { id: string; preview: string };
  className?: string;
}) {
  const goHome = (el: HTMLElement) => {
    scrollStickHome(el);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    goHome(e.currentTarget);
  };

  return (
    <div
      className={[USER_STICK_CLASS, className].filter(Boolean).join(" ")}
      role="button"
      tabIndex={0}
      aria-label="跳到这条提问"
      onClickCapture={(e) => {
        const t = e.target;
        const hit = t instanceof Element ? t.closest(STICK_CHILD_INTERACTIVE) : null;
        if (!stickClickGoesHome(hit, e.currentTarget)) return;
        if (stickHasTextSelection(e.currentTarget)) return;
        goHome(e.currentTarget);
      }}
      onKeyDown={onKeyDown}
      {...(ask ? askAnchorProps(ask.id, ask.preview) : {})}
    >
      {children}
    </div>
  );
}
