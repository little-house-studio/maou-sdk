import {
  createContext,
  createElement,
  useContext,
  type ComponentType,
  type ReactNode,
  useSyncExternalStore,
} from "react";
import type { SlotRegistry } from "./registry";
import type { SlotEntry } from "./types";

export class StaleAuthorizationError extends Error {
  constructor(name: string) {
    super(`slot "${name}" render binding is stale`);
    this.name = "StaleAuthorizationError";
  }
}

export class SlotOwnershipError extends Error {
  constructor(name: string, child: string) {
    super(`slot "${name}" is not authorized to render "${child}"`);
    this.name = "SlotOwnershipError";
  }
}

const SlotsContext = createContext<SlotRegistry | null>(null);

export function SlotsProvider({
  slots,
  children,
}: {
  slots: SlotRegistry;
  children: ReactNode;
}) {
  return createElement(SlotsContext.Provider, { value: slots }, children);
}

export function useSlots(): SlotRegistry {
  const slots = useContext(SlotsContext);
  if (!slots) throw new Error("SlotsProvider missing");
  return slots;
}

export function useOptionalSlots(): SlotRegistry | null {
  return useContext(SlotsContext);
}

function useSlotVersion(slots: SlotRegistry, name: string): number {
  return useSyncExternalStore(
    (onStoreChange) => slots.subscribe(name, onStoreChange),
    () => slots.getVersion(name),
    () => slots.getVersion(name),
  );
}

export type RenderSlotOpts = {
  key?: string;
  owner?: string;
  fallback?: unknown;
};

/**
 * Render a declared slot. Components stay pure — they receive `props` only.
 */
export function renderSlot(
  slots: SlotRegistry,
  name: string,
  props: Record<string, unknown> = {},
  opts: RenderSlotOpts = {},
): unknown {
  const spec = slots.spec(name);
  if (!spec) return opts.fallback ?? null;
  const entries = slots.entriesOfSlot(name);
  if (entries.length === 0) return opts.fallback ?? null;

  if (spec.kind === "single") {
    const entry = entries[0];
    if (!entry || !slots.core.isLive(entry)) {
      throw new StaleAuthorizationError(name);
    }
    return createElement(
      entry.component as ComponentType<Record<string, unknown>>,
      { ...props, ...entry.inject?.(), renderSlot: makeChildRenderer(slots, entry) },
    );
  }

  if (spec.kind === "keyed") {
    const key = opts.key;
    const entry = entries.find((e) => e.options.key === key);
    if (!entry) return opts.fallback ?? null;
    return createElement(
      entry.component as ComponentType<Record<string, unknown>>,
      { ...props, ...entry.inject?.(), renderSlot: makeChildRenderer(slots, entry) },
    );
  }

  if (spec.kind === "list") {
    return entries.map((entry) =>
      createElement(
        entry.component as ComponentType<Record<string, unknown>>,
        {
          ...props,
          ...entry.inject?.(),
          key: entry.options.id,
          slotId: entry.options.id,
          renderSlot: makeChildRenderer(slots, entry),
        },
      ),
    );
  }

  for (const entry of entries) {
    const matched = entry.select?.(props) ?? null;
    if (matched != null) {
      return createElement(
        entry.component as ComponentType<Record<string, unknown>>,
        {
          ...props,
          matched,
          ...entry.inject?.(),
          renderSlot: makeChildRenderer(slots, entry),
        },
      );
    }
  }
  return opts.fallback ?? null;
}

function makeChildRenderer(slots: SlotRegistry, entry: SlotEntry) {
  return (child: string, childProps?: Record<string, unknown>, opts?: RenderSlotOpts) => {
    if (!entry.children || !(child in entry.children)) {
      throw new SlotOwnershipError(opts?.owner ?? "(entry)", child);
    }
    return renderSlot(slots, child, childProps ?? {}, opts);
  };
}

/** Render a declared slot when present; otherwise children. Safe without SlotsProvider. */
export function PassSlot({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}): ReactNode {
  const slots = useOptionalSlots();
  if (!slots?.spec(name)) return children;
  return createElement(SlotOutlet, {
    slots,
    name,
    props: { node: children },
    fallback: children,
  });
}

export function SlotOutlet({
  slots: slotsProp,
  name,
  props,
  slotKey,
  fallback = null,
}: {
  slots?: SlotRegistry;
  name: string;
  props?: object;
  slotKey?: string;
  fallback?: unknown;
}): ReactNode {
  const slots = slotsProp ?? useSlots();
  useSlotVersion(slots, name);
  return renderSlot(
    slots,
    name,
    (props ?? {}) as Record<string, unknown>,
    { key: slotKey, fallback },
  ) as ReactNode;
}
