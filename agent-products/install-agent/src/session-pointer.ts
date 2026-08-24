import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { MAOU_DIR_NAME } from "@little-house-studio/types";
import type { SessionStore } from "@little-house-studio/context";

export function lastSessionPath(dataRoot: string): string {
  return join(dataRoot, MAOU_DIR_NAME, "last-session.json");
}

export function loadLastSessionId(dataRoot: string, store: SessionStore): string | null {
  try {
    const raw = JSON.parse(readFileSync(lastSessionPath(dataRoot), "utf-8")) as {
      sessionId?: string;
    };
    if (raw.sessionId && store.load(raw.sessionId)) return raw.sessionId;
  } catch {
    /* fall through */
  }
  const listed = store.list();
  if (!listed.length) return null;
  listed.sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
  return listed[0]?.id ?? null;
}

export function saveLastSessionId(dataRoot: string, sessionId: string): void {
  const p = lastSessionPath(dataRoot);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({ sessionId }, null, 2), "utf-8");
}

