/**
 * Pure dock plugin registration — unit-testable without React.
 */
import { DOCK_CARDS, type DockCardId } from "../drafts/bottom-dock";
import type {
  DockContentKind,
  DockPluginRegistry,
  DockPluginSlot,
} from "./types";

/** Default content kinds for draft boards. */
export const DEFAULT_DOCK_CONTENT_KIND: Record<DockCardId, DockContentKind> = {
  logs: "canvas-ui",
  tasks: "html-canvas",
  terminal: "canvas-ui",
  agent: "canvas-ui",
};

export function createEmptyDockRegistry(): DockPluginRegistry {
  return { slots: [] };
}

/** Seed registry from DOCK_CARDS with default content kinds. */
export function createDefaultDockRegistry(): DockPluginRegistry {
  return {
    slots: DOCK_CARDS.map((c) => ({
      id: c.id,
      label: c.label,
      tone: c.tone,
      contentKind: DEFAULT_DOCK_CONTENT_KIND[c.id],
      description: `draft board · ${c.id} · ${DEFAULT_DOCK_CONTENT_KIND[c.id]}`,
    })),
  };
}

/** Register or replace a slot by id (immutable). */
export function registerDockPlugin(
  reg: DockPluginRegistry,
  slot: DockPluginSlot,
): DockPluginRegistry {
  const rest = reg.slots.filter((s) => s.id !== slot.id);
  return { slots: [...rest, slot] };
}

export function listDockPlugins(
  reg: DockPluginRegistry,
): readonly DockPluginSlot[] {
  return reg.slots;
}

export function getDockPlugin(
  reg: DockPluginRegistry,
  id: DockCardId,
): DockPluginSlot | null {
  return reg.slots.find((s) => s.id === id) ?? null;
}

export function dockPluginIds(reg: DockPluginRegistry): DockCardId[] {
  return reg.slots.map((s) => s.id);
}
