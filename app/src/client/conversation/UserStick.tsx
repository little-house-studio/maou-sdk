import React, { type KeyboardEvent, type ReactNode } from "react";
import { askAnchorProps, USER_MSG_CLIP_CLASS, USER_STICK_CLASS } from "./contract";
import { scrollStickHome } from "./scroll-offset";

/** Sticky user row. Click jumps the scroller to this row's in-flow top. */
export function UserStick({
  children,
  ask,
}: {
  children: ReactNode;
  ask?: { id: string; preview: string };
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
      className={USER_STICK_CLASS}
      role="button"
      tabIndex={0}
      aria-label="跳到这条提问"
      onClickCapture={(e) => {
        // 行内交互件（链接 / 编号方块等按钮）自己处理点击，不抢成“跳回提问”
        const t = e.target;
        if (
          t instanceof Element &&
          t.closest(`a, button, [role="button"], .${USER_MSG_CLIP_CLASS}`)
        ) {
          return;
        }
        goHome(e.currentTarget);
      }}
      onKeyDown={onKeyDown}
      {...(ask ? askAnchorProps(ask.id, ask.preview) : {})}
    >
      {children}
    </div>
  );
}
