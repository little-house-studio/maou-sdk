import type { SlotPlugin, SlotRegistry } from "./registry";

const installed: SlotPlugin[] = [];

/** Side-effect install. Import the module before the host creates slots. */
export function registerSlotPlugin(plugin: SlotPlugin): () => void {
  if (installed.some((p) => p.id === plugin.id)) {
    throw new Error(`slot plugin "${plugin.id}" is already registered`);
  }
  installed.push(plugin);
  return () => {
    const i = installed.indexOf(plugin);
    if (i >= 0) installed.splice(i, 1);
  };
}

export function slotPlugins(): readonly SlotPlugin[] {
  return installed;
}

/** Product seats first, then installed modules, then the caller's list. */
export function applySlotPlugins(
  slots: SlotRegistry,
  extra: readonly SlotPlugin[] = [],
): void {
  for (const plugin of [...installed, ...extra]) {
    slots.applyPlugin(plugin);
  }
}
