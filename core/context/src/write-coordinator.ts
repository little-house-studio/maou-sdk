/**
 * 每会话写协调器：固定合并窗 + 紧急 flush。
 * 首条事件开窗，后续不重置；flush / 关会话立刻排空。
 */

import type { SessionLedgerEvent } from "@little-house-studio/types";

export const DEFAULT_WRITE_BATCH_MAX_DELAY_MS = 200;

export type LedgerFlushListener = (info: {
  sessionDir: string;
  sessionId: string;
  rec: SessionLedgerEvent;
  byteOffset: number;
  fileSize: number;
  n: number;
  isMessage: boolean;
}) => void;

export interface PendingLedgerWrite {
  rec: SessionLedgerEvent;
  line: string;
  byteOffset: number;
  fileSize: number;
  n: number;
  isMessage: boolean;
}

export interface SessionWriteBatch {
  sessionDir: string;
  sessionId: string;
  items: PendingLedgerWrite[];
  timer: ReturnType<typeof setTimeout> | null;
}

export function resolveBatchDelayMs(override?: number): number {
  if (typeof override === "number" && Number.isFinite(override)) {
    return Math.max(0, Math.min(override, 2_147_483_647));
  }
  const env = process.env.MAOU_LEDGER_BATCH_MS;
  if (env != null && env !== "") {
    const n = Number(env);
    if (Number.isFinite(n)) return Math.max(0, n);
  }
  if (process.env.VITEST) return 0;
  return DEFAULT_WRITE_BATCH_MAX_DELAY_MS;
}

const batches = new Map<string, SessionWriteBatch>();

export function writeBatchKey(sessionDir: string, sessionId: string): string {
  return `${sessionDir}\0${sessionId}`;
}

export function peekPendingWrites(sessionDir: string, sessionId: string): PendingLedgerWrite[] {
  return batches.get(writeBatchKey(sessionDir, sessionId))?.items.slice() ?? [];
}

export function pendingLastSeq(sessionDir: string, sessionId: string): number | null {
  const items = batches.get(writeBatchKey(sessionDir, sessionId))?.items;
  const last = items?.[items.length - 1];
  return last ? last.rec.seq : null;
}

export function pendingTailSize(sessionDir: string, sessionId: string): number | null {
  const items = batches.get(writeBatchKey(sessionDir, sessionId))?.items;
  const last = items?.[items.length - 1];
  return last ? last.fileSize : null;
}

export function enqueueWrite(
  sessionDir: string,
  sessionId: string,
  item: PendingLedgerWrite,
  flushNow: (batch: SessionWriteBatch) => void,
  delayMs?: number,
): void {
  const key = writeBatchKey(sessionDir, sessionId);
  let batch = batches.get(key);
  if (!batch) {
    batch = { sessionDir, sessionId, items: [], timer: null };
    batches.set(key, batch);
  }
  batch.items.push(item);
  const delay = resolveBatchDelayMs(delayMs);
  if (delay <= 0) {
    if (batch.timer) {
      clearTimeout(batch.timer);
      batch.timer = null;
    }
    flushNow(batch);
    if (batch.items.length === 0) batches.delete(key);
    return;
  }
  if (!batch.timer) {
    batch.timer = setTimeout(() => {
      batch!.timer = null;
      flushNow(batch!);
      if (batch!.items.length === 0) batches.delete(key);
    }, delay);
    batch.timer.unref?.();
  }
}

export function takeBatch(sessionDir: string, sessionId: string): SessionWriteBatch | null {
  const key = writeBatchKey(sessionDir, sessionId);
  const batch = batches.get(key);
  if (!batch) return null;
  if (batch.timer) {
    clearTimeout(batch.timer);
    batch.timer = null;
  }
  batches.delete(key);
  return batch;
}

export function listPendingBatchKeys(): string[] {
  return [...batches.keys()];
}

export function cancelBatchTimer(sessionDir: string, sessionId: string): SessionWriteBatch | null {
  const batch = batches.get(writeBatchKey(sessionDir, sessionId));
  if (!batch) return null;
  if (batch.timer) {
    clearTimeout(batch.timer);
    batch.timer = null;
  }
  return batch;
}

export function dropEmptyBatch(sessionDir: string, sessionId: string): void {
  const key = writeBatchKey(sessionDir, sessionId);
  const batch = batches.get(key);
  if (batch && batch.items.length === 0) batches.delete(key);
}
