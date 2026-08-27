/**
 * Dock card identities — plugin layer owns the closed set.
 * Physics (`bottom-dock.ts`) imports ids from here.
 */
export type DockCardId = "logs" | "tasks" | "terminal" | "agent" | "proactive";

export type DockCardTone =
  | "logs"
  | "tasks"
  | "terminal"
  | "agent"
  | "proactive";

export type DockCardDef = {
  id: DockCardId;
  label: string;
  tone: DockCardTone;
};

/** Split of former top TASKS + ops surface into bottom folder boards. */
export const DOCK_CARDS: readonly DockCardDef[] = [
  { id: "logs", label: "日志", tone: "logs" },
  { id: "tasks", label: "任务", tone: "tasks" },
  { id: "terminal", label: "终端", tone: "terminal" },
  { id: "agent", label: "agent", tone: "agent" },
  { id: "proactive", label: "主动", tone: "proactive" },
] as const;

export function defaultDockOrder(): DockCardId[] {
  return DOCK_CARDS.map((c) => c.id);
}

export function dockCardById(id: DockCardId): DockCardDef {
  const c = DOCK_CARDS.find((x) => x.id === id);
  if (!c) throw new Error(`unknown dock card ${id}`);
  return c;
}

export function isDockCardId(v: string): v is DockCardId {
  return DOCK_CARDS.some((c) => c.id === v);
}
