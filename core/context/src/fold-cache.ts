/**
 * 人看到的当前枝折叠缓存。错了就整段重折，不当真相。
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { durableAtomicWriteJson } from "./durable-write.js";

export const FOLD_CACHE_FILE = "fold.json";
export const FOLD_CACHE_VER = 1;

export interface FoldCacheSnap {
  ver: number;
  lastSeq: number;
  tailFingerprint: string;
  replaceGeneration: number;
  messages: Array<Record<string, unknown>>;
  traces: Array<Record<string, unknown>>;
}

export function foldCachePath(sessionRoot: string): string {
  return join(sessionRoot, FOLD_CACHE_FILE);
}

export function messageFingerprint(msg: Record<string, unknown> | undefined): string {
  if (!msg || typeof msg !== "object") return "";
  const role = String(msg.role ?? "");
  const id = String(msg.id ?? "");
  const content = String(msg.content ?? "").slice(0, 120);
  return `${role}|${id}|${content}`;
}

export function readFoldCache(sessionRoot: string): FoldCacheSnap | null {
  const p = foldCachePath(sessionRoot);
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, "utf-8")) as FoldCacheSnap;
    if (raw.ver !== FOLD_CACHE_VER) return null;
    if (typeof raw.lastSeq !== "number" || !Array.isArray(raw.messages)) return null;
    return raw;
  } catch {
    return null;
  }
}

export function writeFoldCache(sessionRoot: string, snap: FoldCacheSnap): void {
  durableAtomicWriteJson(foldCachePath(sessionRoot), snap);
}

export function foldCacheUsable(
  snap: FoldCacheSnap | null,
  lastSeq: number,
  tailFingerprint: string,
  replaceGeneration: number,
): boolean {
  if (!snap) return false;
  if (snap.replaceGeneration !== replaceGeneration) return false;
  if (snap.lastSeq > lastSeq) return false;
  if (snap.lastSeq === lastSeq) return snap.tailFingerprint === tailFingerprint;
  return true;
}
