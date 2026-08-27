/**
 * Slot ledger kinds.
 * Parent `children` declaration is the only authorization to register.
 */
export type SlotKind = "single" | "keyed" | "list" | "chain";
export type SlotScope = "root" | "session" | "session-maybe";

export type SlotSpec = {
  kind: SlotKind;
  scope: SlotScope;
};

export type SlotChildren = Record<string, SlotSpec>;

export type ChainSelect<T = unknown> = (props: T) => unknown | null;

export type SlotRegisterOptions<TProps = unknown> = {
  name: string;
  registrant?: string;
  children?: SlotChildren;
  priority?: number;
  /** keyed */
  key?: string;
  /** list */
  id?: string;
  order?: number;
  label?: string | (() => string);
  /** chain */
  select?: ChainSelect<TProps>;
  inject?: (...args: unknown[]) => Record<string, unknown>;
};

export type SlotEntry<TProps = unknown> = {
  component: unknown;
  options: {
    key?: string;
    id?: string;
    order?: number;
    label?: string | (() => string);
    priority?: number;
  };
  select?: ChainSelect<TProps>;
  inject?: (...args: unknown[]) => Record<string, unknown>;
  children?: SlotChildren;
  registrant?: string;
};

export type SlotRecord = {
  spec?: SlotSpec;
  declaredBy?: string;
  parent?: string;
  declarationEpoch: number;
  entries: readonly SlotEntry[];
  /** Cached `entriesOfSlot` projection; cleared on mutate. */
  projected: readonly SlotEntry[] | null;
  version: number;
  listeners: Set<() => void>;
  declarationListeners: Set<() => void>;
};

export type SlotSnapshotNode = {
  name: string;
  kind: SlotKind;
  scope: SlotScope;
  declaredBy?: string;
  occupants: Array<{
    registrant?: string;
    key?: string;
    id?: string;
    order?: number;
    priority: number;
    active: boolean;
  }>;
  children: SlotSnapshotNode[];
};

export function resolveSlotLabel(
  label: string | (() => string) | undefined,
): string | undefined {
  if (label == null) return undefined;
  return typeof label === "function" ? label() : label;
}
