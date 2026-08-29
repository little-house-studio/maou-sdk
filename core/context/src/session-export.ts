/**
 * 导出会话树：先 flush，再收集目录产物（不含渲染进程读 ZIP）。
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { flushLedger } from "./session-ledger.js";
import type { SessionStore } from "./session-store.js";
import { zipBuffers, type ZipEntry } from "./zip-archive.js";

const SKIP = new Set(["search.sqlite", "search.sqlite-wal", "search.sqlite-shm"]);

export type ExportPreflight = {
  sessionId: string;
  ok: boolean;
  error?: string;
  files: number;
  dependents: string[];
};

function walkFiles(root: string, out: string[]): void {
  if (!existsSync(root)) return;
  for (const name of readdirSync(root)) {
    if (SKIP.has(name) || name.endsWith(".tmp")) continue;
    const p = join(root, name);
    const st = statSync(p);
    if (st.isDirectory()) walkFiles(p, out);
    else out.push(p);
  }
}

export function listSessionExportPaths(store: SessionStore, sessionId: string): { sessionId: string; files: string[] }[] {
  const ids = [sessionId, ...store.listDependents(sessionId).map((d) => d.id)];
  return ids
    .filter((id) => store.exists(id))
    .map((id) => {
      const files: string[] = [];
      walkFiles(store.sessionRoot(id), files);
      return { sessionId: id, files };
    });
}

export function preflightSessionExport(store: SessionStore, sessionId: string): ExportPreflight {
  if (!store.exists(sessionId)) {
    return { sessionId, ok: false, error: "session not found", files: 0, dependents: [] };
  }
  const groups = listSessionExportPaths(store, sessionId);
  return {
    sessionId,
    ok: true,
    files: groups.reduce((n, g) => n + g.files.length, 0),
    dependents: groups.filter((g) => g.sessionId !== sessionId).map((g) => g.sessionId),
  };
}

export function collectSessionZipEntries(store: SessionStore, sessionId: string): ZipEntry[] {
  flushLedger(store.sessionDir, sessionId);
  for (const dep of store.listDependents(sessionId)) {
    flushLedger(store.sessionDir, dep.id);
  }
  const entries: ZipEntry[] = [];
  for (const group of listSessionExportPaths(store, sessionId)) {
    const prefix = group.sessionId === sessionId ? "" : `children/${group.sessionId}/`;
    const root = store.sessionRoot(group.sessionId);
    for (const abs of group.files) {
      const rel = relative(root, abs).replace(/\\/g, "/");
      entries.push({ name: `${prefix}${rel}`, data: readFileSync(abs) });
    }
  }
  return entries;
}

export function exportSessionZip(store: SessionStore, sessionId: string): Buffer {
  return zipBuffers(collectSessionZipEntries(store, sessionId));
}

export function sessionZipFilename(sessionId: string): string {
  return `maou-session-${sessionId.replace(/[^\w.-]+/g, "_")}.zip`;
}
