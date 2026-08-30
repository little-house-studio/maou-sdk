import React, { useEffect, useRef, type ReactNode } from "react";
import { USER_MSG_CLIP_CLASS } from "./contract";
import {
  NESTED_WHEEL_GESTURE_MS,
  emptyNestedWheelLatch,
  endNestedClipWheel,
  resolveNestedClipWheel,
  scrollThreadByWheel,
} from "./nested-wheel";

/** 超长提问的可滚正文。滚到边先锁外层，下一轮手势才滚上下文。 */
export function UserMsgClip({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const latchRef = useRef(emptyNestedWheelLatch());
  const timerRef = useRef(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const kind = resolveNestedClipWheel(el, e.deltaY, latchRef.current);
      if (kind === "inner") {
        e.stopPropagation();
      } else {
        e.preventDefault();
        e.stopPropagation();
        if (kind === "outer") {
          scrollThreadByWheel(el, e.deltaY, e.deltaMode);
        }
      }
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        endNestedClipWheel(latchRef.current);
        timerRef.current = 0;
      }, NESTED_WHEEL_GESTURE_MS);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      window.clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={[className, USER_MSG_CLIP_CLASS].filter(Boolean).join(" ")}
    >
      {children}
    </div>
  );
}
