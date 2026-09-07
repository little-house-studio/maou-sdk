/**
 * 密封旧段：活 events.jsonl 保持明文；超过阈值的前缀打成独立 gzip 档案。
 */

import { existsSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { durableAtomicWrite, durableAtomicWriteJson, fileSizeOrZero } from "./durable-write.js";
import {
  catchUpOffsetSidecar,
  lastOffsetRec,
  OFFSET_FILE,
  type OffsetRec,
  readOffsetRecs,
  rewriteOffsetRecs,
} from "./jsonl-offset.js";
import { EVENTS_FILE } from "./session-ledger.js";

export const SEAL_THRESHOLD_BYTES = 32 * 1024 * 1024;
export const LIVE_TAIL_KEEP_BYTES = 1024 * 1024;
export const MANIFEST_FILE = "events.sealed.json";

export interface SealedSegment {
  file: string;
  idx: string;
  fromSeq: number;
  toSeq: number;
  messageCount: number;
}

export interface SealManifest {
  segments: SealedSegment[];
}

export function manifestPath(sessionRoot: string): string {
  return join(sessionRoot, MANIFEST_FILE);
}

export function readSealManifest(sessionRoot: string): SealManifest {
  const p = manifestPath(sessionRoot);
  if (!existsSync(p)) return { segments: [] };
  try {
    const raw = JSON.parse(readFileSync(p, "utf-8")) as SealManifest;
    return { segments: Array.isArray(raw.segments) ? raw.segments : [] };
  } catch {
    return { segments: [] };
  }
}

export function listSealedSegments(sessionRoot: string): SealedSegment[] {
  return readSealManifest(sessionRoot).segments;
}

export function readSealedRecords(sessionRoot: string, seg: SealedSegment): { rec: OffsetRec; line: string }[] {
  const gzPath = join(sessionRoot, seg.file);
  if (!existsSync(gzPath)) return [];
  const text = gunzipSync(readFileSync(gzPath)).toString("utf-8");
  const lines = text.split("\n").filter((l) => l.trim());
  const idx = existsSync(join(sessionRoot, seg.idx))
    ? readFileSync(join(sessionRoot, seg.idx), "utf-8")
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as OffsetRec)
    : [];
  return lines.map((line, i) => ({
    rec: idx[i] ?? { seq: i + 1, off: 0, n: 0, t: "" },
    line,
  }));
}

export function readSealedLine(sessionRoot: string, seg: SealedSegment, off: number): string | null {
  const gzPath = join(sessionRoot, seg.file);
  if (!existsSync(gzPath)) return null;
  const text = gunzipSync(readFileSync(gzPath)).toString("utf-8");
  let pos = 0;
  for (const line of text.split("\n")) {
    if (pos === off) return line;
    pos += Buffer.byteLength(line, "utf-8") + 1;
  }
  return null;
}

/** 活文件超过阈值则把前缀封进 gzip，尾部继续明文。 */
export function sealLivePrefixIfNeeded(
  sessionRoot: string,
  opts?: { threshold?: number; keepTail?: number },
): SealedSegment | null {
  const eventsPath = join(sessionRoot, EVENTS_FILE);
  const threshold = opts?.threshold ?? SEAL_THRESHOLD_BYTES;
  const keepTail = opts?.keepTail ?? LIVE_TAIL_KEEP_BYTES;
  const size = fileSizeOrZero(eventsPath);
  if (size < threshold) return null;
  catchUpOffsetSidecar(sessionRoot, eventsPath);
  const recs = readOffsetRecs(sessionRoot);
  if (recs.length < 2) return null;
  const cutAt = size - keepTail;
  let cut = 0;
  for (let i = 0; i < recs.length; i++) {
    const end = recs[i]!.end ?? recs[i]!.off;
    if (end > cutAt && i > 0) {
      cut = i;
      break;
    }
    cut = i + 1;
  }
  if (cut < 1 || cut >= recs.length) return null;
  const prefix = recs.slice(0, cut);
  const tail = recs.slice(cut);
  const first = prefix[0]!;
  const last = prefix[prefix.length - 1]!;
  const raw = readFileSync(eventsPath);
  const prefixBytes = raw.subarray(0, last.end ?? last.off);
  const tailBytes = raw.subarray(last.end ?? last.off);
  const file = `${EVENTS_FILE.replace(".jsonl", "")}.${first.seq}-${last.seq}.jsonl.gz`;
  const idx = `${EVENTS_FILE.replace(".jsonl", "")}.${first.seq}-${last.seq}.idx.jsonl`;
  durableAtomicWrite(join(sessionRoot, file), gzipSync(prefixBytes));
  durableAtomicWrite(join(sessionRoot, idx), `${prefix.map((r) => JSON.stringify(r)).join("\n")}\n`);
  durableAtomicWrite(eventsPath, tailBytes);
  const rewritten: OffsetRec[] = [];
  let base = 0;
  const tailText = tailBytes.toString("utf-8");
  const tailLines = tailText.endsWith("\n") || tailText.length === 0
    ? tailText.split("\n").slice(0, -1)
    : tailText.split("\n").slice(0, -1);
  for (let i = 0; i < tail.length; i++) {
    const rec = tail[i]!;
    const line = tailLines[i] ?? "";
    const end = base + Buffer.byteLength(line, "utf-8") + 1;
    rewritten.push({ ...rec, off: base, end });
    base = end;
  }
  rewriteOffsetRecs(sessionRoot, rewritten);
  const seg: SealedSegment = {
    file,
    idx,
    fromSeq: first.seq,
    toSeq: last.seq,
    messageCount: last.n - (first.n > 0 && first.n === last.n ? first.n - 1 : Math.max(0, (prefix[0]?.n ?? 0) - (first.t ? 1 : 0))),
  };
  const manifest = readSealManifest(sessionRoot);
  manifest.segments.push({
    file: seg.file,
    idx: seg.idx,
    fromSeq: first.seq,
    toSeq: last.seq,
    messageCount: last.n,
  });
  durableAtomicWriteJson(manifestPath(sessionRoot), manifest);
  return seg;
}

export function cleanupOrphanSeals(sessionRoot: string): void {
  const known = new Set(listSealedSegments(sessionRoot).flatMap((s) => [s.file, s.idx]));
  if (!existsSync(sessionRoot)) return;
  for (const name of readdirSync(sessionRoot)) {
    if (!/^events\.\d+-\d+\.(jsonl\.gz|idx\.jsonl)$/.test(name)) continue;
    if (!known.has(name)) {
      try {
        unlinkSync(join(sessionRoot, name));
      } catch {
        /* ignore */
      }
    }
  }
}

export { OFFSET_FILE };
