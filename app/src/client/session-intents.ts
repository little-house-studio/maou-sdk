export type SessionToolMetaMaps = {
  intents: Record<string, string>;
  durations: Record<string, number>;
};

type ToolishLine = {
  role: string;
  toolCallId?: string;
  toolDescription?: string;
  durationMs?: number;
};

export async function fetchSessionToolMeta(
  sessionId: string,
  projectRoot: string,
): Promise<SessionToolMetaMaps> {
  const q = new URLSearchParams({
    sessionId,
    root: projectRoot,
  });
  for (const path of ["/__maou/session-intents", "/api/session-intents"]) {
    try {
      const r = await fetch(`${path}?${q}`);
      if (!r.ok) continue;
      const j = (await r.json()) as Partial<SessionToolMetaMaps>;
      if (j && typeof j.intents === "object" && j.intents) {
        return {
          intents: j.intents,
          durations: j.durations && typeof j.durations === "object" ? j.durations : {},
        };
      }
    } catch {
      /* try next */
    }
  }
  return { intents: {}, durations: {} };
}

export function applySessionToolMeta<T extends ToolishLine>(
  lines: T[],
  extra: SessionToolMetaMaps,
): T[] {
  let changed = false;
  const next = lines.map((l) => {
    if (l.role !== "tool") return l;
    const id = (l.toolCallId || "").trim();
    const intent = l.toolDescription || (id ? extra.intents[id] : undefined);
    const durationMs = l.durationMs ?? (id ? extra.durations[id] : undefined);
    if (intent === l.toolDescription && durationMs === l.durationMs) return l;
    changed = true;
    return {
      ...l,
      ...(intent ? { toolDescription: intent } : {}),
      ...(durationMs != null ? { durationMs } : {}),
    };
  });
  return changed ? next : lines;
}
