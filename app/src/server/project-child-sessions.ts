/**
 * 跨项目会话目录扫描：OPS 当前店看不到 project:<path>:coding 槽里的会话，
 * 把 parent 落在当前店的条目并进来。
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type ScannedSession = {
  id: string;
  title: string;
  updatedAt?: string;
  messageCount: number;
  userTurns: number;
  lastMsgAt?: string;
  parentSessionId?: string;
  switchId?: string;
};

export function projectSessionsDir(projectPath: string): string {
  return join(projectPath, ".maou", "sessions");
}

export function sessionExistsOnDisk(sessionDir: string, sessionId: string): boolean {
  const id = sessionId.trim();
  if (!id || id.includes("/") || id.includes("\\")) return false;
  return existsSync(join(sessionDir, id, "session.json"));
}

export function scanSessionsDir(sessionDir: string, switchId?: string): ScannedSession[] {
  if (!existsSync(sessionDir)) return [];
  let names: string[] = [];
  try {
    names = readdirSync(sessionDir);
  } catch {
    return [];
  }
  const out: ScannedSession[] = [];
  for (const name of names) {
    if (name === "list-cache.json") continue;
    const root = join(sessionDir, name);
    try {
      if (!statSync(root).isDirectory()) continue;
    } catch {
      continue;
    }
    const raw = readJson(join(root, "session.json"));
    if (!raw) continue;
    const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : name;
    const title = typeof raw.title === "string" && raw.title.trim() ? raw.title : "新对话";
    const updatedAt = typeof raw.updated_at === "string" ? raw.updated_at : undefined;
    const createdAt = typeof raw.created_at === "string" ? raw.created_at : undefined;
    const messageCount = typeof raw.message_count === "number" ? raw.message_count : 0;
    const userTurns =
      typeof raw.lifetime === "object" && raw.lifetime && typeof raw.lifetime.userTurns === "number"
        ? raw.lifetime.userTurns
        : 0;
    const parent =
      typeof raw.parent_session_id === "string" && raw.parent_session_id.trim()
        ? raw.parent_session_id.trim()
        : undefined;
    out.push({
      id,
      title,
      updatedAt,
      messageCount,
      userTurns,
      lastMsgAt: updatedAt || createdAt || "",
      ...(parent ? { parentSessionId: parent } : {}),
      ...(switchId ? { switchId } : {}),
    });
  }
  return out;
}

/** home 为当前店；extras 里 parent 落在 home（或刚并入的孩子）的才留下。 */
export function mergeChildSessions(
  home: ScannedSession[],
  extras: ScannedSession[],
): ScannedSession[] {
  const byId = new Map<string, ScannedSession>();
  for (const s of home) byId.set(s.id, s);
  let added = true;
  while (added) {
    added = false;
    for (const s of extras) {
      if (byId.has(s.id)) continue;
      const parent = s.parentSessionId?.trim();
      if (parent && byId.has(parent)) {
        byId.set(s.id, s);
        added = true;
      }
    }
  }
  return [...byId.values()];
}

export function runningHelperCount(
  sessions: ScannedSession[],
  rootId: string,
  running: ReadonlySet<string>,
): number {
  const kids = new Map<string, string[]>();
  for (const s of sessions) {
    const parent = s.parentSessionId?.trim();
    if (!parent) continue;
    const list = kids.get(parent);
    if (list) list.push(s.id);
    else kids.set(parent, [s.id]);
  }
  let n = 0;
  const walk = (id: string) => {
    for (const child of kids.get(id) ?? []) {
      if (running.has(child)) n += 1;
      walk(child);
    }
  };
  walk(rootId);
  return n;
}

function readJson(path: string): {
  id?: unknown;
  title?: unknown;
  updated_at?: unknown;
  created_at?: unknown;
  message_count?: unknown;
  parent_session_id?: unknown;
  lifetime?: { userTurns?: unknown };
} | null {
  try {
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as {
      id?: unknown;
      title?: unknown;
      updated_at?: unknown;
      created_at?: unknown;
      message_count?: unknown;
      parent_session_id?: unknown;
      lifetime?: { userTurns?: unknown };
    };
  } catch {
    return null;
  }
}
