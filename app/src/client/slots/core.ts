import type {
  SlotChildren,
  SlotEntry,
  SlotRecord,
  SlotRegisterOptions,
  SlotSnapshotNode,
  SlotSpec,
} from "./types";

const NO_ENTRIES: readonly SlotEntry[] = Object.freeze([]);

/**
 * Pure slot ledger. `root` is the only a-priori hole. No React.
 */
export class SlotCore {
  private records = new Map<string, SlotRecord>();
  private mutateListeners = new Set<(key: string) => void>();
  private dirty = new Set<SlotRecord>();
  private flushScheduled = false;
  private abdicated = new WeakSet<SlotEntry>();

  constructor() {
    const root = this.record("root");
    root.spec = { kind: "single", scope: "root" };
    root.declaredBy = "(built-in)";
    root.declarationEpoch = 1;
  }

  register(options: SlotRegisterOptions, component: unknown): () => void {
    const rec = this.records.get(options.name);
    if (!rec?.spec) {
      throw new Error(
        `slot "${options.name}" is not declared (a parent entry's children table must declare it)`,
      );
    }
    const spec = rec.spec;
    const priority = options.priority ?? 0;
    const occupantHint = (occupant: SlotEntry) =>
      `at priority ${priority}${
        occupant.registrant != null
          ? ` (registered by ${occupant.registrant})`
          : ""
      } — register at a different priority to shadow it (lowest renders)`;

    switch (spec.kind) {
      case "single": {
        const occupant = rec.entries.find(
          (e) => (e.options.priority ?? 0) === priority,
        );
        if (occupant) {
          throw new Error(
            `single slot "${options.name}" already has a registration ${occupantHint(occupant)}`,
          );
        }
        break;
      }
      case "keyed": {
        if (options.key === undefined) {
          throw new Error(`keyed slot "${options.name}" requires options.key`);
        }
        const occupant = rec.entries.find(
          (e) =>
            e.options.key === options.key &&
            (e.options.priority ?? 0) === priority,
        );
        if (occupant) {
          throw new Error(
            `keyed slot "${options.name}" already has an entry for key "${options.key}" ${occupantHint(occupant)}`,
          );
        }
        break;
      }
      case "list": {
        if (options.id === undefined) {
          throw new Error(`list slot "${options.name}" requires options.id`);
        }
        const occupant = rec.entries.find(
          (e) =>
            e.options.id === options.id &&
            (e.options.priority ?? 0) === priority,
        );
        if (occupant) {
          throw new Error(
            `list slot "${options.name}" already has an entry with id "${options.id}" ${occupantHint(occupant)}`,
          );
        }
        break;
      }
      case "chain":
        if (options.select === undefined) {
          throw new Error(`chain slot "${options.name}" requires options.select`);
        }
        break;
    }

    if (options.children) {
      for (const childKey of Object.keys(options.children)) {
        const childRec = this.records.get(childKey);
        if (childRec?.spec) {
          throw new Error(
            `slot "${childKey}" is already declared (by ${childRec.declaredBy ?? "an unknown entry"})`,
          );
        }
      }
    }

    const entry: SlotEntry = {
      component,
      options: {
        ...(options.key !== undefined ? { key: options.key } : {}),
        ...(options.id !== undefined ? { id: options.id } : {}),
        ...(options.order !== undefined ? { order: options.order } : {}),
        ...(options.label !== undefined ? { label: options.label } : {}),
        ...(options.priority !== undefined ? { priority: options.priority } : {}),
      },
      ...(options.select !== undefined ? { select: options.select } : {}),
      ...(options.inject !== undefined ? { inject: options.inject } : {}),
      ...(options.children !== undefined ? { children: options.children } : {}),
      ...(options.registrant !== undefined
        ? { registrant: options.registrant }
        : {}),
    };

    const next = [...rec.entries, entry];
    next.sort(
      spec.kind === "list"
        ? (a, b) =>
            (a.options.priority ?? 0) - (b.options.priority ?? 0) ||
            (a.options.order ?? 0) - (b.options.order ?? 0)
        : (a, b) => (a.options.priority ?? 0) - (b.options.priority ?? 0),
    );
    rec.entries = next;
    this.markDirty(options.name, rec);

    if (options.children) {
      const declarations: Array<[string, SlotRecord]> = [];
      for (const [childKey, childSpec] of Object.entries(options.children)) {
        const childRec = this.record(childKey);
        childRec.spec = childSpec;
        childRec.declaredBy = `an entry in "${options.name}"${
          options.registrant ? ` (${options.registrant})` : ""
        }`;
        childRec.parent = options.name;
        childRec.declarationEpoch += 1;
        declarations.push([childKey, childRec]);
      }
      for (const [childKey, childRec] of declarations) {
        this.markDirty(childKey, childRec);
      }
      for (const [, childRec] of declarations) this.notifyDeclaration(childRec);
    }

    return () => {
      if (!rec.entries.includes(entry)) return;
      rec.entries = rec.entries.filter((e) => e !== entry);
      this.markDirty(options.name, rec);
      this.releaseEntry(entry);
    };
  }

  isLive(entry: SlotEntry): boolean {
    for (const rec of this.records.values()) {
      if (rec.entries.includes(entry)) return true;
    }
    return false;
  }

  entries(key: string): readonly SlotEntry[] {
    return this.records.get(key)?.entries ?? NO_ENTRIES;
  }

  entriesOfSlot(key: string): readonly SlotEntry[] {
    const rec = this.records.get(key);
    if (!rec?.spec) return NO_ENTRIES;
    if (rec.projected) return rec.projected;
    const kind = rec.spec.kind;
    if (kind === "chain") {
      rec.projected = rec.entries;
      return rec.entries;
    }
    const heads: SlotEntry[] = [];
    const seenCells = new Set<string | undefined>();
    for (const entry of rec.entries) {
      if (this.abdicated.has(entry)) continue;
      const cell =
        kind === "keyed"
          ? entry.options.key
          : kind === "list"
            ? entry.options.id
            : undefined;
      if (seenCells.has(cell)) continue;
      seenCells.add(cell);
      heads.push(entry);
    }
    rec.projected = heads;
    return heads;
  }

  spec(key: string): SlotSpec | undefined {
    return this.records.get(key)?.spec;
  }

  declarationEpoch(key: string): number {
    return this.records.get(key)?.declarationEpoch ?? 0;
  }

  getVersion(key: string): number {
    return this.records.get(key)?.version ?? 0;
  }

  subscribe(key: string, fn: () => void): () => void {
    const rec = this.record(key);
    rec.listeners.add(fn);
    return () => {
      rec.listeners.delete(fn);
    };
  }

  subscribeDeclaration(key: string, fn: () => void): () => void {
    const rec = this.record(key);
    rec.declarationListeners.add(fn);
    return () => {
      rec.declarationListeners.delete(fn);
    };
  }

  onMutate(fn: (key: string) => void): () => void {
    this.mutateListeners.add(fn);
    return () => {
      this.mutateListeners.delete(fn);
    };
  }

  reportEntryError(
    key: string,
    entry: SlotEntry,
    _error: unknown,
    info: { abdicate: boolean },
  ): void {
    if (info.abdicate) {
      if (this.abdicated.has(entry)) return;
      this.abdicated.add(entry);
      const rec = this.records.get(key);
      if (rec) this.markDirty(key, rec);
    }
  }

  snapshot(root?: string): SlotSnapshotNode[] {
    const build = (
      name: string,
      seen: Set<string>,
    ): SlotSnapshotNode | undefined => {
      const record = this.records.get(name);
      if (record?.spec === undefined || seen.has(name)) return undefined;
      const branch = new Set(seen);
      branch.add(name);
      const active = new Set(this.entriesOfSlot(name));
      const children = [...this.records.entries()]
        .filter(
          ([, candidate]) =>
            candidate.spec !== undefined && candidate.parent === name,
        )
        .flatMap(([child]) => {
          const node = build(child, branch);
          return node === undefined ? [] : [node];
        });
      return {
        name,
        kind: record.spec.kind,
        scope: record.spec.scope,
        ...(record.declaredBy === undefined
          ? {}
          : { declaredBy: record.declaredBy }),
        occupants: record.entries.map((entry) => ({
          ...(entry.registrant === undefined
            ? {}
            : { registrant: entry.registrant }),
          ...(entry.options.key === undefined ? {} : { key: entry.options.key }),
          ...(entry.options.id === undefined ? {} : { id: entry.options.id }),
          ...(entry.options.order === undefined
            ? {}
            : { order: entry.options.order }),
          priority: entry.options.priority ?? 0,
          active: active.has(entry),
        })),
        children,
      };
    };
    if (root !== undefined) {
      const node = build(root, new Set());
      return node === undefined ? [] : [node];
    }
    return [...this.records.entries()]
      .filter(
        ([, record]) =>
          record.spec !== undefined &&
          (record.parent === undefined ||
            this.records.get(record.parent)?.spec === undefined),
      )
      .flatMap(([name]) => {
        const node = build(name, new Set());
        return node === undefined ? [] : [node];
      });
  }

  private releaseEntry(entry: SlotEntry): void {
    if (!entry.children) return;
    for (const childKey of Object.keys(entry.children)) {
      const childRec = this.records.get(childKey);
      if (!childRec) continue;
      const doomed = childRec.entries;
      childRec.spec = undefined;
      childRec.declaredBy = undefined;
      childRec.parent = undefined;
      childRec.declarationEpoch += 1;
      childRec.entries = NO_ENTRIES;
      this.markDirty(childKey, childRec);
      this.notifyDeclaration(childRec);
      for (const dead of doomed) this.releaseEntry(dead);
    }
  }

  private record(key: string): SlotRecord {
    let rec = this.records.get(key);
    if (!rec) {
      rec = {
        spec: undefined,
        declaredBy: undefined,
        parent: undefined,
        declarationEpoch: 0,
        entries: NO_ENTRIES,
        projected: null,
        version: 0,
        listeners: new Set(),
        declarationListeners: new Set(),
      };
      this.records.set(key, rec);
    }
    return rec;
  }

  private markDirty(key: string, rec: SlotRecord): void {
    rec.projected = null;
    rec.version += 1;
    for (const fn of [...this.mutateListeners]) fn(key);
    this.dirty.add(rec);
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      queueMicrotask(() => this.flush());
    }
  }

  private notifyDeclaration(rec: SlotRecord): void {
    for (const fn of [...rec.declarationListeners]) fn();
  }

  private flush(): void {
    this.flushScheduled = false;
    const batch = [...this.dirty];
    this.dirty.clear();
    for (const rec of batch) {
      for (const fn of [...rec.listeners]) fn();
    }
  }
}

export type { SlotChildren };
