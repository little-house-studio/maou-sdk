/** 从会话落盘记录里取出工具调用意图 / 耗时，给 WebUI 历史行用。 */

export function readToolIntent(raw: unknown): string {
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return "";
    if (t.startsWith("{") || t.startsWith("[")) {
      try {
        return readToolIntent(JSON.parse(t));
      } catch {
        return "";
      }
    }
    return "";
  }
  if (!raw || typeof raw !== "object") return "";
  const o = raw as Record<string, unknown>;
  if (typeof o.description === "string" && o.description.trim()) {
    return o.description.trim();
  }
  if (o.parameters != null) return readToolIntent(o.parameters);
  if (o.arguments != null) return readToolIntent(o.arguments);
  return "";
}

export function encodeToolArgs(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw !== "object") return "";
  try {
    const s = JSON.stringify(raw);
    return s === "{}" || s === "[]" ? "" : s;
  } catch {
    return "";
  }
}

export function collectToolCallArgs(
  msgs: Array<Record<string, unknown>>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of msgs) {
    const calls = m.toolCalls ?? m.tool_calls ?? m.native_tool_calls;
    if (!Array.isArray(calls)) continue;
    for (const tc of calls) {
      if (!tc || typeof tc !== "object") continue;
      const rec = tc as Record<string, unknown>;
      const fn =
        rec.function && typeof rec.function === "object"
          ? (rec.function as Record<string, unknown>)
          : undefined;
      const id = String(rec.id ?? fn?.id ?? "").trim();
      const args = encodeToolArgs(
        rec.arguments ?? rec.parameters ?? fn?.arguments ?? fn?.parameters,
      );
      if (id && args) map.set(id, args);
    }
  }
  return map;
}

export function collectToolCallIntents(
  msgs: Array<Record<string, unknown>>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of msgs) {
    const calls = m.toolCalls ?? m.tool_calls ?? m.native_tool_calls;
    if (!Array.isArray(calls)) continue;
    for (const tc of calls) {
      if (!tc || typeof tc !== "object") continue;
      const rec = tc as Record<string, unknown>;
      const fn =
        rec.function && typeof rec.function === "object"
          ? (rec.function as Record<string, unknown>)
          : undefined;
      const id = String(rec.id ?? fn?.id ?? "").trim();
      const intent = readToolIntent(
        rec.arguments ?? rec.parameters ?? fn?.arguments ?? fn?.parameters ?? rec,
      );
      if (id && intent) map.set(id, intent);
    }
  }
  return map;
}

export function readToolElapsed(m: Record<string, unknown>): number | undefined {
  const n = Number(m.elapsed ?? m.durationMs ?? m.duration_ms);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** 用户 / 助手行上的 durationMs（含 0）。linesFromMessages 读写。 */
export function readRoleDurationMs(m: Record<string, unknown>): number | undefined {
  const n = Number(m.durationMs ?? m.duration_ms ?? m.elapsed);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** 账本里「发出 → 终止」墙钟。runtime appendMessage / abort 写入。 */
export function readLoopDurationMs(m: Record<string, unknown>): number | undefined {
  const n = Number(m.loopDurationMs ?? m.loop_duration_ms);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** 把本 loop 最后一条 loopDurationMs 写到对应用户行。 */
export function backfillUserLoopDuration<
  T extends { role: string; durationMs?: number; loopDurationMs?: number },
>(lines: T[]): T[] {
  let user: T | undefined;
  let lastLoop: number | undefined;
  const apply = () => {
    if (!user || lastLoop == null || user.durationMs != null) return;
    user.durationMs = lastLoop;
  };
  for (const line of lines) {
    if (line.role === "user") {
      apply();
      user = line;
      lastLoop = line.loopDurationMs;
    } else if (line.loopDurationMs != null && Number.isFinite(line.loopDurationMs)) {
      lastLoop = line.loopDurationMs;
    }
  }
  apply();
  return lines;
}

export function slimAssistantToolCalls(
  m: Record<string, unknown>,
): Array<{ id: string; description: string }> {
  const intents = collectToolCallIntents([m]);
  return [...intents.entries()].map(([id, description]) => ({ id, description }));
}

export function readHistoryToolMeta(
  m: Record<string, unknown>,
  intents: Map<string, string>,
  argsByCall?: Map<string, string>,
): { toolDescription?: string; durationMs?: number; toolArgs?: string } {
  const toolCallId = String(m.toolCallId ?? m.tool_call_id ?? "").trim();
  const rawParams = m.tool_parameters ?? m.toolParameters ?? m.parameters;
  const fromParams = readToolIntent(rawParams);
  const fromCall = toolCallId ? intents.get(toolCallId) : undefined;
  const toolDescription = fromParams || fromCall || undefined;
  const toolArgs =
    encodeToolArgs(rawParams) ||
    (toolCallId ? argsByCall?.get(toolCallId) : undefined) ||
    undefined;
  const durationMs = readToolElapsed(m);
  return {
    ...(toolDescription ? { toolDescription } : {}),
    ...(toolArgs ? { toolArgs } : {}),
    ...(durationMs != null ? { durationMs } : {}),
  };
}
