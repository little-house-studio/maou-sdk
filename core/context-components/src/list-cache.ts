/**
 * 会话列表投影。list() 只读这份，不碰 last_raw_response。
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { durableAtomicWriteJson } from "./durable-write.js";

export const LIST_CACHE_FILE = "list-cache.json";
export const LIST_CACHE_VER = 2;

export interface ListCacheItem {
  id: string;
  title: string;
  updatedAt?: string;
  messageCount: number;
  /** 用户发出条数（user/message），列表展示用 */
  userTurns: number;
  lastMsgAt: string;
  parentSessionId?: string;
  agentName?: string;
  oneshot?: boolean;
  leafSeq?: number;
}

export interface ListCacheSnap {
  ver: number;
  items: ListCacheItem[];
}

export function listCachePath(storeDir: string): string {
  return join(storeDir, LIST_CACHE_FILE);
}

export function readListCache(storeDir: string): ListCacheSnap | null {
  const p = listCachePath(storeDir);
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, "utf-8")) as ListCacheSnap;
    if (raw.ver !== LIST_CACHE_VER || !Array.isArray(raw.items)) return null;
    return raw;
  } catch {
    return null;
  }
}

export function writeListCache(storeDir: string, items: ListCacheItem[]): void {
  durableAtomicWriteJson(listCachePath(storeDir), { ver: LIST_CACHE_VER, items });
}

export function upsertListCacheItem(storeDir: string, item: ListCacheItem): ListCacheItem[] {
  const prev = readListCache(storeDir)?.items ?? [];
  const next = prev.filter((row) => row.id !== item.id);
  next.push(item);
  next.sort((a, b) => (b.lastMsgAt || "").localeCompare(a.lastMsgAt || ""));
  writeListCache(storeDir, next);
  return next;
}

export function removeListCacheItem(storeDir: string, sessionId: string): void {
  const prev = readListCache(storeDir)?.items ?? [];
  writeListCache(
    storeDir,
    prev.filter((row) => row.id !== sessionId),
  );
}

/** 列表读头时丢掉会撑爆 parse 的字段。 */
export function stripHeavySessionMetaText(text: string): string {
  return text.replace(
    /"(last_prompt|last_raw_response)"\s*:\s*"(?:\\.|[^"\\])*"/g,
    '"$1":""',
  );
}
