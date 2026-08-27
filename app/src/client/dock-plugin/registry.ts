/**
 * Pure dock plugin registration — unit-testable without React.
 */
import { DOCK_CARDS, type DockCardId } from "./ids";
import {
  DEFAULT_DOCK_BOARD_LAYOUT,
  getDefaultDockBoardLayout,
  type DockBoardLayout,
} from "./layout";
import type {
  DockContentKind,
  DockPluginRegistry,
  DockPluginSlot,
} from "./types";

/** Default content kinds for draft boards. */
export const DEFAULT_DOCK_CONTENT_KIND: Record<DockCardId, DockContentKind> = {
  logs: "canvas-ui",
  tasks: "html-canvas",
  /** Live shell mounts TerminalPanel as react face */
  terminal: "react",
  agent: "canvas-ui",
  /** Live shell mounts ProactiveHost as react face */
  proactive: "react",
};

export function createEmptyDockRegistry(): DockPluginRegistry {
  return { slots: [] };
}

/** Seed registry from DOCK_CARDS with default content kinds + layouts. */
export function createDefaultDockRegistry(): DockPluginRegistry {
  return {
    slots: DOCK_CARDS.map((c) => ({
      id: c.id,
      label: c.label,
      tone: c.tone,
      contentKind: DEFAULT_DOCK_CONTENT_KIND[c.id],
      layout: { ...DEFAULT_DOCK_BOARD_LAYOUT[c.id] },
      description: `dock board · ${c.id} · ${DEFAULT_DOCK_CONTENT_KIND[c.id]} · ${DEFAULT_DOCK_BOARD_LAYOUT[c.id].surface ?? "transparent"}`,
    })),
  };
}

/** Register or replace a slot by id (immutable). */
export function registerDockPlugin(
  reg: DockPluginRegistry,
  slot: DockPluginSlot,
): DockPluginRegistry {
  const rest = reg.slots.filter((s) => s.id !== slot.id);
  const full: DockPluginSlot = {
    ...slot,
    layout: slot.layout ?? getDefaultDockBoardLayout(slot.id),
  };
  return { slots: [...rest, full] };
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

/** Resolve layout for a card (registry override → defaults). */
export function resolveDockBoardLayout(
  reg: DockPluginRegistry | null | undefined,
  id: DockCardId,
): DockBoardLayout {
  const slot = reg ? getDockPlugin(reg, id) : null;
  return slot?.layout ?? getDefaultDockBoardLayout(id);
}
