import type {
  AssemblyHook,
  AssemblyHookMeta,
  AssemblyMessage,
  AssemblySlot,
} from "./ports.js";

function sortSlots<TCtx>(slots: AssemblySlot<TCtx>[]): AssemblySlot<TCtx>[] {
  return [...slots].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

function asMessages<TCtx>(
  raw: ReturnType<AssemblySlot<TCtx>["provide"]>,
  slot: AssemblySlot<TCtx>,
): AssemblyMessage[] {
  if (raw == null) return [];
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return [];
    return [{ role: slot.role ?? "system", content: text }];
  }
  if (Array.isArray(raw)) return raw.filter((m) => m && typeof m.role === "string");
  if (typeof raw === "object" && typeof raw.role === "string") return [raw];
  return [];
}

function isPrefix<TCtx>(slot: AssemblySlot<TCtx>): boolean {
  return slot.prefix ?? slot.order < 100;
}

export function defineSlot<TCtx>(slot: AssemblySlot<TCtx>): AssemblySlot<TCtx> {
  return slot;
}

export function defineHook<TCtx>(hook: AssemblyHook<TCtx>): AssemblyHook<TCtx> {
  return hook;
}

export interface Assembly<TCtx = unknown> {
  slots: AssemblySlot<TCtx>[];
  after: AssemblyHook<TCtx>[];
  insert(slot: AssemblySlot<TCtx>): Assembly<TCtx>;
  replace(name: string, slot: AssemblySlot<TCtx> | Partial<AssemblySlot<TCtx>>): Assembly<TCtx>;
  remove(name: string): Assembly<TCtx>;
  assemble(ctx: TCtx): AssemblyMessage[];
  assembleWithMeta(ctx: TCtx): { messages: AssemblyMessage[]; prefixCount: number };
}

export function createAssembly<TCtx = unknown>(spec?: {
  slots?: AssemblySlot<TCtx>[];
  after?: AssemblyHook<TCtx>[];
}): Assembly<TCtx> {
  const state: { slots: AssemblySlot<TCtx>[]; after: AssemblyHook<TCtx>[] } = {
    slots: sortSlots(spec?.slots ?? []),
    after: [...(spec?.after ?? [])],
  };

  const api: Assembly<TCtx> = {
    get slots() {
      return state.slots;
    },
    set slots(next) {
      state.slots = sortSlots(next);
    },
    get after() {
      return state.after;
    },
    set after(next) {
      state.after = [...next];
    },
    insert(slot) {
      const rest = state.slots.filter((s) => s.name !== slot.name);
      state.slots = sortSlots([...rest, slot]);
      return api;
    },
    replace(name, slot) {
      const idx = state.slots.findIndex((s) => s.name === name);
      if (idx < 0) {
        if ("name" in slot && "order" in slot && "provide" in slot) {
          return api.insert(slot as AssemblySlot<TCtx>);
        }
        throw new Error(`assembly slot 不存在: ${name}`);
      }
      const current = state.slots[idx]!;
      state.slots = sortSlots(
        state.slots.map((s, i) => (i === idx ? { ...current, ...slot, name } : s)),
      );
      return api;
    },
    remove(name) {
      state.slots = state.slots.filter((s) => s.name !== name);
      return api;
    },
    assemble(ctx) {
      return api.assembleWithMeta(ctx).messages;
    },
    assembleWithMeta(ctx) {
      const messages: AssemblyMessage[] = [];
      let prefixCount = 0;
      for (const slot of state.slots) {
        if (slot.enabled && !slot.enabled(ctx)) continue;
        const items = asMessages(slot.provide(ctx), slot);
        messages.push(...items);
        if (isPrefix(slot)) prefixCount += items.length;
      }
      const meta: AssemblyHookMeta = { prefixCount };
      let out = messages;
      for (const hook of state.after) {
        const next = hook.apply(out, ctx, meta);
        if (Array.isArray(next)) out = next;
      }
      return { messages: out, prefixCount };
    },
  };

  return api;
}

export function assemble<TCtx>(slots: AssemblySlot<TCtx>[], ctx: TCtx): AssemblyMessage[] {
  return createAssembly({ slots }).assemble(ctx);
}
