import { randomBytes } from "node:crypto";
import type { Snapshot } from "./types.js";

const cache = new Map<string, Snapshot>();

export function newSnapshotId(): string {
  return `cu1_${randomBytes(16).toString("hex")}`;
}

export function rememberSnapshot(snapshot: Snapshot): Snapshot {
  cache.set(snapshot.snapshotId, snapshot);
  if (cache.size > 32) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
  return snapshot;
}

export function recallSnapshot(id: string | undefined): Snapshot | undefined {
  if (!id) return undefined;
  return cache.get(id);
}

export function resetSnapshotsForTest(): void {
  cache.clear();
}
