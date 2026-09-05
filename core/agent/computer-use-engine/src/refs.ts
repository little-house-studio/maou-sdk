import type { UiElement, UiLocator } from "./types.js";

export const MAX_SNAPSHOT_ELEMENTS = 80;

const INTERACTIVE_ROLES = new Set([
  "AXButton",
  "AXCheckBox",
  "AXRadioButton",
  "AXPopUpButton",
  "AXMenuButton",
  "AXMenuItem",
  "AXTextField",
  "AXTextArea",
  "AXComboBox",
  "AXSlider",
  "AXIncrementor",
  "AXLink",
  "AXTab",
  "AXDisclosureTriangle",
  "AXSwitch",
  "AXColorWell",
  "AXHandle",
  "AXSearchField",
  "AXScrollBar",
]);

/** `[3]` / `3` / 3 → 1-based ref。 */
export function parseElementRef(target: string | number | undefined | null): number | null {
  if (typeof target === "number" && Number.isInteger(target) && target >= 1) return target;
  if (typeof target !== "string") return null;
  const s = target.trim();
  const m = /^\[(\d+)\]$/.exec(s) ?? /^(\d+)$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

export function isInteractiveRole(role: string, actions?: string[]): boolean {
  if (INTERACTIVE_ROLES.has(role)) return true;
  return (actions ?? []).some((a) => /press|setvalue|showmenu|pick/i.test(a));
}

export function pruneInteractive(nodes: Array<Omit<UiElement, "ref">>): UiElement[] {
  const kept = nodes.filter((n) => isInteractiveRole(n.role, n.actions)).slice(0, MAX_SNAPSHOT_ELEMENTS);
  return assignRefs(kept);
}

export function assignRefs(nodes: Array<Omit<UiElement, "ref">>): UiElement[] {
  return nodes.map((n, i) => ({ ...n, ref: i + 1 }));
}

export function findElement(elements: UiElement[], ref: number): UiElement | undefined {
  return elements.find((el) => el.ref === ref);
}

export function toLocator(el: UiElement): UiLocator {
  return {
    ref: el.ref,
    role: el.role,
    ...(el.title ? { title: el.title } : {}),
    ...(el.value ? { value: el.value } : {}),
    ...(el.description ? { description: el.description } : {}),
    ...(el.frame ? { frame: el.frame } : {}),
  };
}

export function matchLocator(elements: UiElement[], locator: UiLocator): UiElement | undefined {
  const byRef = findElement(elements, locator.ref);
  if (byRef && sameIdentity(byRef, locator)) return byRef;
  return elements.find((el) => sameIdentity(el, locator));
}

function sameIdentity(el: UiElement, loc: UiLocator): boolean {
  if (el.role !== loc.role) return false;
  if ((el.title ?? "") !== (loc.title ?? "")) return false;
  if ((el.description ?? "") !== (loc.description ?? "")) return false;
  return true;
}
