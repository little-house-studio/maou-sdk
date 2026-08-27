import { SlotCore } from "./core";
import type { SlotEntry, SlotRegisterOptions } from "./types";

export type SlotPlugin = {
  id: string;
  apply: (slots: SlotRegistry) => void | (() => void);
};

/**
 * Host-facing slot service: register + late-bind inject.
 * Plugin unload runs every disposer (entry + child tree collapse).
 */
export class SlotRegistry {
  readonly core: SlotCore;
  private disposers = new Set<() => void>();

  constructor(core = new SlotCore()) {
    this.core = core;
  }

  register(options: SlotRegisterOptions, component: unknown): () => void {
    const dispose = this.core.register(options, component);
    this.disposers.add(dispose);
    return () => {
      this.disposers.delete(dispose);
      dispose();
    };
  }

  /**
   * Wait until `name` is declared, then run `fn`.
   * If the declaration collapses, `fn`'s returned disposer runs;
   * a later re-declaration runs `fn` again.
   */
  inject(name: string, fn: () => void | (() => void)): () => void {
    let inner: (() => void) | undefined;
    const run = () => {
      inner?.();
      inner = undefined;
      if (!this.core.spec(name)) return;
      const d = fn();
      if (typeof d === "function") inner = d;
    };
    const unsub = this.core.subscribeDeclaration(name, run);
    if (this.core.spec(name)) run();
    const dispose = () => {
      unsub();
      inner?.();
      inner = undefined;
      this.disposers.delete(dispose);
    };
    this.disposers.add(dispose);
    return dispose;
  }

  applyPlugin(plugin: SlotPlugin): () => void {
    const extra = plugin.apply(this);
    if (typeof extra !== "function") return () => undefined;
    this.disposers.add(extra);
    return () => {
      this.disposers.delete(extra);
      extra();
    };
  }

  entriesOfSlot(name: string): readonly SlotEntry[] {
    return this.core.entriesOfSlot(name);
  }

  spec(name: string) {
    return this.core.spec(name);
  }

  subscribe(name: string, fn: () => void): () => void {
    return this.core.subscribe(name, fn);
  }

  getVersion(name: string): number {
    return this.core.getVersion(name);
  }

  snapshot(root?: string) {
    return this.core.snapshot(root);
  }

  dispose(): void {
    for (const d of [...this.disposers]) d();
    this.disposers.clear();
  }
}
