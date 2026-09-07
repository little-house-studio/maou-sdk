/**
 * 工具裁切后的原文落在会话目录，过期删除。
 */

import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ORIGINAL_RECORD_TTL_MS } from "./constants.js";
import { durableAtomicWriteJson } from "./durable-write.js";

export const SPILL_DIR_NAME = "spill";
export const ARCHIVE_DIR_NAME = "archive";

export function sessionSpillDir(sessionRoot: string): string {
  return join(sessionRoot, SPILL_DIR_NAME);
}

export function sessionArchiveDir(sessionRoot: string): string {
  return join(sessionRoot, ARCHIVE_DIR_NAME);
}

/** 删掉目录里超过 ttl 的普通文件。目录不存在则 0。 */
export function cleanupExpiredFiles(dir: string, ttlMs = ORIGINAL_RECORD_TTL_MS): number {
  if (!dir || !existsSync(dir)) return 0;
  const now = Date.now();
  let removed = 0;
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return 0;
  }
  for (const name of names) {
    const path = join(dir, name);
    try {
      const st = statSync(path);
      if (!st.isFile()) continue;
      if (now - st.mtimeMs <= ttlMs) continue;
      unlinkSync(path);
      removed++;
    } catch {
      /* 单个文件失败不影响其余 */
    }
  }
  return removed;
}

export function writeOriginalRecord(
  sessionRoot: string,
  sourceId: string,
  text: string,
): string | undefined {
  const root = sessionRoot.trim();
  if (!root || !text) return undefined;
  try {
    const dir = sessionSpillDir(root);
    mkdirSync(dir, { recursive: true });
    cleanupExpiredFiles(dir);
    const safeId = (sourceId || "out").replace(/[^\w.-]+/g, "_").slice(0, 80);
    const path = join(dir, `${safeId}-${Date.now()}.txt`);
    writeFileSync(path, text, "utf-8");
    return path;
  } catch {
    return undefined;
  }
}

export interface ArchiveLookupEntry {
  seq: number;
  category: string;
  stub: string;
  path?: string;
}

export interface ArchiveLookup {
  id: string;
  createdAt: string;
  seqRange: { start: number; end: number };
  summary: string;
  entries: ArchiveLookupEntry[];
}

export function writeArchiveLookup(sessionRoot: string, record: ArchiveLookup): string | undefined {
  const root = sessionRoot.trim();
  if (!root) return undefined;
  try {
    const dir = sessionArchiveDir(root);
    mkdirSync(dir, { recursive: true });
    cleanupExpiredFiles(dir);
    const path = join(dir, `${record.id}.json`);
    durableAtomicWriteJson(path, record);
    return path;
  } catch {
    return undefined;
  }
}
