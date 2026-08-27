import React, { type ReactNode, type Ref } from "react";
import { PassSlot } from "../slots";
import { ThreadBoard } from "./ThreadBoard";

export function ConversationPane({
  trail,
  jumpPrev,
  messages,
  jumpBottom,
  permit,
  composer,
  scrollRef,
  empty,
  rail,
}: {
  trail?: ReactNode;
  jumpPrev?: ReactNode;
  messages: ReactNode;
  jumpBottom?: ReactNode;
  permit?: ReactNode;
  composer: ReactNode;
  scrollRef?: Ref<HTMLDivElement>;
  empty?: boolean;
  rail?: ReactNode;
}) {
  return (
    <>
      {trail != null ? (
        <PassSlot name="conversation.trail">{trail}</PassSlot>
      ) : null}
      <div className="wire-thread-stage">
        {jumpPrev ? (
          <div className="wire-thread-jump">{jumpPrev}</div>
        ) : null}
        <div className="codex-thread-scroll wire-thread-scroll">
          <ThreadBoard scrollRef={scrollRef} empty={empty}>
            <PassSlot name="conversation.messages">{messages}</PassSlot>
          </ThreadBoard>
        </div>
        {empty ? null : rail}
        {jumpBottom ? (
          <div className="wire-jump-bottom-dock">{jumpBottom}</div>
        ) : null}
      </div>
      <div className="wire-composer-frame wire-float-bottom">
        {permit != null ? (
          <PassSlot name="conversation.permit">{permit}</PassSlot>
        ) : null}
        {composer}
      </div>
    </>
  );
}
