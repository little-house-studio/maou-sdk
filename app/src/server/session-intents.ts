import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  collectToolCallIntents,
  readHistoryToolMeta,
} from "./tool-history.js";

export type SessionToolMetaMaps = {
  intents: Record<string, string>;
  durations: Record<string, number>;
};

export function findSessionJsonl(
  sessionId: string,
  projectRoot: string,
): string | null {
  const id = sessionId.trim();
  if (!id || id.includes("/") || id.includes("\\")) return null;
  const root = (projectRoot || "").trim();
  const candidates = [
    root ? join(root, ".maou", "sessions", `${id}.jsonl`) : "",
    join(homedir(), ".maou", "ops", ".maou", "sessions", `${id}.jsonl`),
    join(homedir(), ".maou", "sessions", `${id}.jsonl`),
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) ?? null;
}

export function parseSessionToolMeta(jsonl: string): SessionToolMetaMaps {
  const msgs: Array<Record<string, unknown>> = [];
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line) as Record<string, unknown>;
      if (ev.type === "message" || typeof ev.role === "string") {
        const { type: _t, ...rest } = ev;
        msgs.push(rest);
      }
    } catch {
      /* skip */
    }
  }
  const callIntents = collectToolCallIntents(msgs);
  const intents: Record<string, string> = {};
  const durations: Record<string, number> = {};
  for (const [id, d] of callIntents) intents[id] = d;
  for (const m of msgs) {
    if (String(m.role) !== "tool") continue;
    const id = String(m.toolCallId ?? m.tool_call_id ?? "").trim();
    const meta = readHistoryToolMeta(m, callIntents);
    if (id && meta.toolDescription) intents[id] = meta.toolDescription;
    if (id && meta.durationMs != null) durations[id] = meta.durationMs;
  }
  return { intents, durations };
}

export function loadSessionToolMeta(
  sessionId: string,
  projectRoot: string,
): SessionToolMetaMaps {
  const file = findSessionJsonl(sessionId, projectRoot);
  if (!file) return { intents: {}, durations: {} };
  try {
    return parseSessionToolMeta(readFileSync(file, "utf8"));
  } catch {
    return { intents: {}, durations: {} };
  }
}
