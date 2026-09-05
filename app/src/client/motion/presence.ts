import { useLayoutEffect, useState } from "react";

export const MOTION_DUR_FAST_MS = 120;
export const MOTION_DUR_MS = 200;
export const MOTION_DUR_SLOW_MS = 240;

export type PresencePhase = "enter" | "open" | "leave";

export type PresenceSnap = {
  shown: boolean;
  phase: PresencePhase;
};

export function emptyPresence(): PresenceSnap {
  return { shown: false, phase: "leave" };
}

export function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function presenceHoldMs(
  open: boolean,
  reduced: boolean,
  ms = MOTION_DUR_MS,
): number {
  if (open || reduced) return 0;
  return ms;
}

/**
 * Open is shown immediately. Close stays mounted on leave until the hold tick.
 * `tick` is the scheduled follow-up after enter (promote) or leave (unmount).
 */
export function nextPresence(
  prev: PresenceSnap,
  open: boolean,
  reduced: boolean,
  tick: "input" | "enter" | "leave" = "input",
): PresenceSnap {
  if (open) {
    if (!prev.shown) {
      return { shown: true, phase: reduced ? "open" : "enter" };
    }
    if (tick === "enter" && prev.phase === "enter") {
      return { shown: true, phase: "open" };
    }
    if (prev.phase === "leave") {
      return { shown: true, phase: reduced ? "open" : "enter" };
    }
    return { shown: true, phase: "open" };
  }
  if (!prev.shown) return { shown: false, phase: "leave" };
  if (reduced || tick === "leave") return { shown: false, phase: "leave" };
  return { shown: true, phase: "leave" };
}

export function presenceProps(
  snap: PresenceSnap,
): { "data-presence": PresencePhase } | Record<string, never> {
  if (!snap.shown) return {};
  return { "data-presence": snap.phase };
}

/** Keep the node mounted through the leave ease, then drop it. */
export function usePresence(
  open: boolean,
  ms = MOTION_DUR_MS,
): PresenceSnap {
  const [snap, setSnap] = useState<PresenceSnap>(() =>
    open ? { shown: true, phase: "open" } : emptyPresence(),
  );

  useLayoutEffect(() => {
    const reduced = prefersReducedMotion();
    setSnap((prev) => nextPresence(prev, open, reduced, "input"));
    if (open) {
      if (reduced) return;
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => {
          setSnap((prev) => nextPresence(prev, true, false, "enter"));
        });
      });
      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
      };
    }
    const hold = presenceHoldMs(false, reduced, ms);
    if (hold <= 0) {
      setSnap((prev) => nextPresence(prev, false, true, "leave"));
      return;
    }
    const t = window.setTimeout(() => {
      setSnap((prev) => nextPresence(prev, false, false, "leave"));
    }, hold);
    return () => window.clearTimeout(t);
  }, [open, ms]);

  return snap;
}
