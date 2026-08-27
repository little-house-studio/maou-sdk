import React, { useCallback, type ReactNode, type Ref } from "react";

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) return;
  if (typeof ref === "function") ref(value);
  else (ref as React.MutableRefObject<T | null>).current = value;
}

/** Scrollport only. Rail sits on the stage, not inside this host. */
export function ThreadBoard({
  children,
  scrollRef,
  empty = false,
  className = "",
}: {
  children: ReactNode;
  scrollRef?: Ref<HTMLDivElement>;
  empty?: boolean;
  className?: string;
}) {
  const setScroll = useCallback(
    (el: HTMLDivElement | null) => {
      assignRef(scrollRef, el);
    },
    [scrollRef],
  );

  return (
    <div className="wire-thread-rail-host">
      <div
        ref={setScroll}
        className={`wire-context-scroll chat-log codex-log${empty ? " is-empty" : ""} ${className}`.trim()}
        data-thread-scroll=""
        role="log"
      >
        {children}
      </div>
    </div>
  );
}
