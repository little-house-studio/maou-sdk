/**
 * events.jsonl 的 seq → byte_offset 旁路。
 * 只追加；给尾读分页用，不依赖 sqlite。
 */

import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { crc32of, durableAppend, durableAtomicWrite } from "./durable-write.js";

export const OFFSET_FILE = "events.offset.jsonl";

export const jsonlIoStats = {
  bytesRead: 0,
  eventsBytesRead: 0,
  reset(): void {
    jsonlIoStats.bytesRead = 0;
    jsonlIoStats.eventsBytesRead = 0;
  },
};

function trackRead(filePath: string, n: number): void {
  jsonlIoStats.bytesRead += n;
  if (filePath.endsWith("events.jsonl")) jsonlIoStats.eventsBytesRead += n;
}

export interface OffsetRec {
  seq: number;
  off: number;
  n: number;
  t: string;
  end?: number;
  crc?: number;
}

export function offsetPath(sessionRoot: string): string {
  return join(sessionRoot, OFFSET_FILE);
}

export function appendOffsetRec(sessionRoot: string, rec: OffsetRec): void {
  durableAppend(offsetPath(sessionRoot), `${JSON.stringify(rec)}\n`);
}

export function appendOffsetRecs(sessionRoot: string, recs: OffsetRec[]): void {
  if (recs.length === 0) return;
  durableAppend(offsetPath(sessionRoot), `${recs.map((r) => JSON.stringify(r)).join("\n")}\n`);
}

export function rewriteOffsetRecs(sessionRoot: string, recs: OffsetRec[]): void {
  const body = recs.length ? `${recs.map((r) => JSON.stringify(r)).join("\n")}\n` : "";
  durableAtomicWrite(offsetPath(sessionRoot), body);
}

function parseOffsetLine(line: string): OffsetRec | null {
  try {
    const rec = JSON.parse(line) as Partial<OffsetRec>;
    if (typeof rec.seq !== "number" || typeof rec.off !== "number") return null;
    return {
      seq: rec.seq,
      off: rec.off,
      n: typeof rec.n === "number" ? rec.n : 0,
      t: typeof rec.t === "string" ? rec.t : "",
      ...(typeof rec.end === "number" ? { end: rec.end } : {}),
      ...(typeof rec.crc === "number" ? { crc: rec.crc } : {}),
    };
  } catch {
    return null;
  }
}

/** 只读文件尾一块，取最后一条 offset。 */
export function lastOffsetRec(sessionRoot: string): OffsetRec | null {
  const file = offsetPath(sessionRoot);
  if (!existsSync(file)) return null;
  const chunk = readFileTail(file, 4096);
  const lines = chunk.split("\n").filter((l) => l.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    const rec = parseOffsetLine(lines[i]!);
    if (rec) return rec;
  }
  return null;
}

export function readOffsetRecs(sessionRoot: string): OffsetRec[] {
  const file = offsetPath(sessionRoot);
  if (!existsSync(file)) return [];
  const raw = readWholeTracked(file);
  const out: OffsetRec[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const rec = parseOffsetLine(line);
    if (rec) out.push(rec);
  }
  return out;
}

/** 旁路里 type 为 `t` 的条数。列表兜底数用户发出时用。 */
export function countOffsetType(sessionRoot: string, type: string): number {
  let n = 0;
  for (const rec of readOffsetRecs(sessionRoot)) {
    if (rec.t === type) n += 1;
  }
  return n;
}

/** 从旁路尾往回找 seq<=throughSeq 的最后一条。 */
export function offsetRecAtOrBefore(sessionRoot: string, throughSeq: number): OffsetRec | null {
  const { recs } = scanOffsetsReverse(sessionRoot, {
    limit: 1,
    pred: (rec) => rec.seq <= throughSeq,
  });
  return recs[0] ?? null;
}

/** 该文件里 seq<=throughSeq 时的累计消息数。 */
export function messageCountThrough(sessionRoot: string, throughSeq: number): number {
  return offsetRecAtOrBefore(sessionRoot, throughSeq)?.n ?? 0;
}

export function listMessageOffsets(
  sessionRoot: string,
  maxSeq?: number,
): OffsetRec[] {
  return readOffsetRecs(sessionRoot).filter((rec) => {
    if (typeof maxSeq === "number" && rec.seq > maxSeq) return false;
    return rec.n > 0 && isMessageOffsetType(rec.t);
  });
}

export function scanMessageOffsetsReverse(
  sessionRoot: string,
  opts: { maxSeq?: number; beforeN?: number; limit: number; file?: string },
): { recs: OffsetRec[]; hasOlder: boolean } {
  const maxSeq = opts.maxSeq ?? Number.POSITIVE_INFINITY;
  const beforeN = opts.beforeN ?? Number.POSITIVE_INFINITY;
  return scanOffsetsReverse(sessionRoot, {
    limit: opts.limit,
    file: opts.file,
    pred: (rec) =>
      rec.seq <= maxSeq && rec.n < beforeN && rec.n > 0 && isMessageOffsetType(rec.t),
  });
}

export function scanOffsetsReverse(
  sessionRoot: string,
  opts: { limit: number; pred?: (rec: OffsetRec) => boolean; file?: string },
): { recs: OffsetRec[]; hasOlder: boolean } {
  const file = opts.file ?? offsetPath(sessionRoot);
  if (!existsSync(file)) return { recs: [], hasOlder: false };
  const size = statSync(file).size;
  if (size <= 0) return { recs: [], hasOlder: false };
  const limit = Math.max(1, opts.limit);
  const collected: OffsetRec[] = [];
  let pos = size;
  let carry = "";
  const fd = openSync(file, "r");
  try {
    while (pos > 0 && collected.length < limit + 1) {
      const chunkSize = Math.min(8192, pos);
      pos -= chunkSize;
      const buf = Buffer.alloc(chunkSize);
      const n = readSync(fd, buf, 0, chunkSize, pos);
      trackRead(file, n);
      const text = buf.subarray(0, n).toString("utf-8") + carry;
      const lines = text.split("\n");
      if (pos > 0) {
        carry = lines.shift() ?? "";
      } else {
        carry = "";
      }
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (!line?.trim()) continue;
        const rec = parseOffsetLine(line);
        if (!rec) continue;
        if (opts.pred && !opts.pred(rec)) continue;
        if (collected.length < limit) collected.push(rec);
        else return { recs: collected, hasOlder: true };
      }
    }
  } finally {
    closeSync(fd);
  }
  return { recs: collected, hasOlder: false };
}

export function catchUpOffsetSidecar(sessionRoot: string, eventsPath: string): void {
  if (!existsSync(eventsPath)) return;
  const size = statSync(eventsPath).size;
  const last = lastOffsetRec(sessionRoot);
  if (!last) {
    if (size > 0) rebuildOffsetSidecar(sessionRoot, eventsPath);
    return;
  }
  if (typeof last.end === "number" && last.end >= size) return;
  const start = typeof last.end === "number" ? last.end : last.off;
  const { lines } = readNewJsonlLines(eventsPath, start);
  let n = last.n;
  for (const { offset, line } of lines) {
    let ev: { seq?: unknown; type?: unknown; data?: Record<string, unknown> };
    try {
      ev = JSON.parse(line) as { seq?: unknown; type?: unknown; data?: Record<string, unknown> };
    } catch {
      continue;
    }
    if (typeof ev.seq !== "number" || typeof ev.type !== "string") continue;
    if (typeof last.end !== "number" && ev.seq <= last.seq) continue;
    if (isMessageOffsetType(ev.type)) n += 1;
    const end = offset + Buffer.byteLength(line, "utf-8") + 1;
    appendOffsetRec(sessionRoot, {
      seq: ev.seq,
      off: offset,
      n,
      t: ev.type,
      end,
      crc: crc32of(line),
    });
  }
}

export function rebuildOffsetSidecar(sessionRoot: string, eventsPath: string): void {
  const { lines, nextOffset } = readNewJsonlLines(eventsPath, 0);
  const recs: OffsetRec[] = [];
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    const { offset, line } = lines[i]!;
    let ev: { seq?: unknown; type?: unknown };
    try {
      ev = JSON.parse(line) as { seq?: unknown; type?: unknown };
    } catch {
      continue;
    }
    if (typeof ev.seq !== "number" || typeof ev.type !== "string") continue;
    if (isMessageOffsetType(ev.type)) n += 1;
    const end = i + 1 < lines.length ? lines[i + 1]!.offset : nextOffset;
    recs.push({ seq: ev.seq, off: offset, n, t: ev.type, end, crc: crc32of(line) });
  }
  rewriteOffsetRecs(sessionRoot, recs);
}

export function isMessageOffsetType(type: string): boolean {
  return (
    type === "user/message" ||
    type === "user/queued" ||
    type === "assistant/message" ||
    type === "tool/result" ||
    type === "tool/async" ||
    type === "system/notice" ||
    type === "runtime/control" ||
    type === "agent/message" ||
    type === "session/custom"
  );
}

export function isOverlayType(type: string): boolean {
  return type === "message/pin" || type === "message/unpin" || type === "message/label";
}

export function isSearchableType(type: string): boolean {
  return (
    type === "user/message" ||
    type === "assistant/message" ||
    type === "tool/result" ||
    type === "system/notice" ||
    type === "session/custom"
  );
}

export function lineCrcMatches(line: string, crc?: number): boolean {
  if (typeof crc !== "number") return true;
  return crc32of(line) === crc;
}

export function readLineAt(filePath: string, offset: number): string | null {
  if (!existsSync(filePath)) return null;
  const fd = openSync(filePath, "r");
  try {
    const chunks: Buffer[] = [];
    let pos = offset;
    const buf = Buffer.alloc(4096);
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, pos);
      if (n <= 0) break;
      trackRead(filePath, n);
      const slice = buf.subarray(0, n);
      const nl = slice.indexOf(0x0a);
      if (nl >= 0) {
        chunks.push(Buffer.from(slice.subarray(0, nl)));
        break;
      }
      chunks.push(Buffer.from(slice));
      pos += n;
    }
    if (chunks.length === 0) return null;
    return Buffer.concat(chunks).toString("utf-8");
  } finally {
    closeSync(fd);
  }
}

export function readFileTail(filePath: string, maxBytes: number): string {
  if (!existsSync(filePath)) return "";
  const size = statSync(filePath).size;
  const start = Math.max(0, size - maxBytes);
  const fd = openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(size - start);
    const n = readSync(fd, buf, 0, buf.length, start);
    trackRead(filePath, n);
    return buf.subarray(0, n).toString("utf-8");
  } finally {
    closeSync(fd);
  }
}

function readWholeTracked(filePath: string): string {
  const size = existsSync(filePath) ? statSync(filePath).size : 0;
  if (size === 0) return "";
  const fd = openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(size);
    const n = readSync(fd, buf, 0, buf.length, 0);
    trackRead(filePath, n);
    return buf.subarray(0, n).toString("utf-8");
  } finally {
    closeSync(fd);
  }
}

/** 从 offset 起读增量字节，按完整行切开。半行留给下次。 */
export function readNewJsonlLines(
  filePath: string,
  startOffset: number,
): { lines: { offset: number; line: string }[]; nextOffset: number } {
  if (!existsSync(filePath)) return { lines: [], nextOffset: startOffset };
  const size = statSync(filePath).size;
  if (size <= startOffset) return { lines: [], nextOffset: startOffset };
  const fd = openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(size - startOffset);
    const n = readSync(fd, buf, 0, buf.length, startOffset);
    trackRead(filePath, n);
    const text = buf.subarray(0, n).toString("utf-8");
    const rawLines = text.split("\n");
    const complete = text.endsWith("\n") ? rawLines.slice(0, -1) : rawLines.slice(0, -1);
    const lines: { offset: number; line: string }[] = [];
    let pos = startOffset;
    for (const line of complete) {
      if (line.trim()) lines.push({ offset: pos, line });
      pos += Buffer.byteLength(line, "utf-8") + 1;
    }
    return { lines, nextOffset: pos };
  } finally {
    closeSync(fd);
  }
}

/** 从文件尾按块往回扫完整行（重建 / 无旁路时用）。 */
export function scanJsonlReverse(
  filePath: string,
  opts?: { maxBytes?: number; stopOffset?: number },
): { offset: number; line: string }[] {
  if (!existsSync(filePath)) return [];
  const size = statSync(filePath).size;
  const stop = opts?.stopOffset ?? 0;
  const budget = opts?.maxBytes ?? size;
  const start = Math.max(stop, size - budget);
  const fd = openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(size - start);
    const n = readSync(fd, buf, 0, buf.length, start);
    trackRead(filePath, n);
    const text = buf.subarray(0, n).toString("utf-8");
    const raw = text.split("\n");
    const out: { offset: number; line: string }[] = [];
    let pos = start;
    for (const line of raw) {
      if (line.trim()) out.push({ offset: pos, line });
      pos += Buffer.byteLength(line, "utf-8") + 1;
    }
    return out;
  } finally {
    closeSync(fd);
  }
}
