import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
} from "react";

export const SHELL_FOCUS_REGIONS = [
  "topbar",
  "left",
  "center",
  "right",
  "bottom",
] as const;

export type ShellFocusRegion = (typeof SHELL_FOCUS_REGIONS)[number];

export const SHELL_FOCUS_ATTR = "data-shell-region";
export const SHELL_FOCUS_ON_ATTR = "data-shell-focus";

export function isShellFocusRegion(id: string | null): id is ShellFocusRegion {
  return (
    id === "topbar" ||
    id === "left" ||
    id === "center" ||
    id === "right" ||
    id === "bottom"
  );
}

/** Ignore composer autofocus that follows a click in another region. */
export const SHELL_FOCUS_STEAL_MS = 400;

export function shouldAcceptFocusMove(
  lastPointer: { region: ShellFocusRegion; at: number } | null,
  next: ShellFocusRegion,
  now: number,
  stealMs = SHELL_FOCUS_STEAL_MS,
): boolean {
  if (!lastPointer) return true;
  if (now - lastPointer.at >= stealMs) return true;
  return lastPointer.region === next;
}

export function closestShellRegion(
  target: EventTarget | null,
): ShellFocusRegion | null {
  if (!target || typeof target !== "object") return null;
  const node = target as {
    closest?: (sel: string) => { getAttribute: (name: string) => string | null } | null;
  };
  if (typeof node.closest !== "function") return null;
  const host = node.closest(`[${SHELL_FOCUS_ATTR}]`);
  const id = host?.getAttribute(SHELL_FOCUS_ATTR) ?? null;
  return isShellFocusRegion(id) ? id : null;
}

export const ShellFocusContext = createContext<ShellFocusRegion>("center");

export function useShellFocus(initial: ShellFocusRegion = "center") {
  const [region, setRegion] = useState<ShellFocusRegion>(initial);
  const lastPointer = useRef<{ region: ShellFocusRegion; at: number } | null>(
    null,
  );
  const onPointerDown = useCallback((e: PointerEvent<Element>) => {
    const next = closestShellRegion(e.target);
    if (!next) return;
    lastPointer.current = { region: next, at: Date.now() };
    setRegion((cur) => (cur === next ? cur : next));
  }, []);
  const onFocusIn = useCallback((e: FocusEvent<Element>) => {
    const next = closestShellRegion(e.target);
    if (!next) return;
    if (!shouldAcceptFocusMove(lastPointer.current, next, Date.now())) return;
    setRegion((cur) => (cur === next ? cur : next));
  }, []);
  return { region, onPointerDown, onFocusIn };
}

export function useShellRegion(id: ShellFocusRegion) {
  const current = useContext(ShellFocusContext);
  return {
    [SHELL_FOCUS_ATTR]: id,
    ...(current === id ? { [SHELL_FOCUS_ON_ATTR]: "" } : {}),
  };
}
