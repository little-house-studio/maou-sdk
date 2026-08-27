import { useEffect, useRef, useState, type ReactNode } from "react";
import { SHELL_ASIDE_ANIM_MS } from "./metrics";

export function AsidePane({
  open,
  width,
  stick = "start",
  children,
}: {
  open: boolean;
  width: number;
  stick?: "start" | "end";
  children: ReactNode;
}) {
  const prev = useRef(open);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    if (prev.current === open) return;
    prev.current = open;
    setAnimating(true);
    const t = window.setTimeout(() => setAnimating(false), SHELL_ASIDE_ANIM_MS);
    return () => window.clearTimeout(t);
  }, [open]);

  return (
    <div
      className={`wire-aside-pane${stick === "end" ? " is-stick-end" : ""}${
        animating ? " is-animating" : ""
      }`}
      style={{ width: open ? width : 0 }}
      aria-hidden={!open}
      inert={!open}
    >
      <div className="wire-aside-pane-inner" style={{ width }}>
        {children}
      </div>
    </div>
  );
}
