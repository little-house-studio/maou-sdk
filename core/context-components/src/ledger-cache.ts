/**
 * 账本解析缓存（进程内）。
 *
 * events.jsonl 只追加：同一文件变大就只解析新增的完整行；换了文件（封存改写 / 截断 / 被替换）
 * 或头部对不上就整读。按源文件字节数做 LRU，内存紧的机器上不囤大账本。
 *
 * 缓存的是每一行 JSON 对象（不挑 seq/type，旧格式行也在），由调用方自己筛。
 * 返回的行对象在多次调用间共享 —— 只读。`MAOU_LEDGER_CACHE_FREEZE=1` 会深冻结缓存对象，
 * 测试用它把任何就地改写变成异常。
 */

import { closeSync, openSync, readFileSync, readSync, statSync, type Stats } from "node:fs";

export type LedgerRow = Record<string, unknown>;

/** 超出后淘汰最久没用的；最近用的一个总保留。 */
const DEFAULT_BUDGET_BYTES = 48 * 1024 * 1024;
const HEAD_BYTES = 256;
const NL = 0x0a;

interface Entry {
  dev: number;
  ino: number;
  /** 上次看到的文件大小 / mtime：都没变就直接命中。 */
  fileSize: number;
  mtimeMs: number;
  /** 已解析到的字节（最后一个换行之后）；半行不吃，等写完再解析。 */
  consumed: number;
  head: string;
  rows: LedgerRow[];
}

const entries = new Map<string, Entry>();
let budgetBytes = DEFAULT_BUDGET_BYTES;
let freeze = process.env.MAOU_LEDGER_CACHE_FREEZE === "1";

export interface LedgerCacheStats {
  hits: number;
  appends: number;
  fullReads: number;
}
const stats: LedgerCacheStats = { hits: 0, appends: 0, fullReads: 0 };

export function ledgerCacheStats(): LedgerCacheStats {
  return { ...stats };
}

/** 测试 / 调参用。 */
export function configureLedgerCache(opts: { budgetBytes?: number; freeze?: boolean }): void {
  if (opts.budgetBytes != null) budgetBytes = Math.max(0, opts.budgetBytes);
  if (opts.freeze != null) freeze = opts.freeze;
}

export function clearLedgerCache(filePath?: string): void {
  if (filePath) entries.delete(filePath);
  else entries.clear();
  stats.hits = stats.appends = stats.fullReads = 0;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

function parseLines(buf: Buffer, into: LedgerRow[]): void {
  for (const line of buf.toString("utf-8").split("\n")) {
    if (!line.trim()) continue;
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    into.push(freeze ? deepFreeze(row as LedgerRow) : (row as LedgerRow));
  }
}

function readRange(filePath: string, start: number, end: number): Buffer {
  const len = Math.max(0, end - start);
  const buf = Buffer.alloc(len);
  if (len === 0) return buf;
  const fd = openSync(filePath, "r");
  try {
    let off = 0;
    while (off < len) {
      const n = readSync(fd, buf, off, len - off, start + off);
      if (n <= 0) break;
      off += n;
    }
    return off === len ? buf : buf.subarray(0, off);
  } finally {
    closeSync(fd);
  }
}

function headOf(buf: Buffer): string {
  return buf.subarray(0, HEAD_BYTES).toString("latin1");
}

function touch(filePath: string, entry: Entry): void {
  entries.delete(filePath);
  entries.set(filePath, entry);
}

function evict(): void {
  let total = 0;
  for (const e of entries.values()) total += e.consumed;
  for (const [key, e] of entries) {
    if (total <= budgetBytes || entries.size <= 1) break;
    entries.delete(key);
    total -= e.consumed;
  }
}

function fullRead(filePath: string, st: Stats): Entry {
  stats.fullReads += 1;
  const buf = readFileSync(filePath);
  const consumed = buf.lastIndexOf(NL) + 1;
  const rows: LedgerRow[] = [];
  parseLines(buf.subarray(0, consumed), rows);
  return {
    dev: st.dev,
    ino: st.ino,
    fileSize: buf.length,
    mtimeMs: st.mtimeMs,
    consumed,
    head: headOf(buf),
    rows,
  };
}

/**
 * 读并解析整份 jsonl（不含待写队列）。文件不存在返回空数组。
 * 结果数组是缓存本体：只追加时原地变长、换文件时换新数组 —— 调用方要改数组先 slice。
 */
export function readLedgerFileCached(filePath: string): readonly LedgerRow[] {
  let st: Stats;
  try {
    st = statSync(filePath);
  } catch {
    entries.delete(filePath);
    return [];
  }
  const hit = entries.get(filePath);
  if (hit && hit.dev === st.dev && hit.ino === st.ino) {
    if (st.size === hit.fileSize && st.mtimeMs === hit.mtimeMs) {
      stats.hits += 1;
      touch(filePath, hit);
      return hit.rows;
    }
    if (st.size >= hit.consumed && appendOnly(filePath, hit)) {
      stats.appends += 1;
      const tail = readRange(filePath, hit.consumed, st.size);
      const lastNl = tail.lastIndexOf(NL);
      if (lastNl >= 0) {
        parseLines(tail.subarray(0, lastNl + 1), hit.rows);
        hit.consumed += lastNl + 1;
      }
      hit.fileSize = st.size;
      hit.mtimeMs = st.mtimeMs;
      touch(filePath, hit);
      evict();
      return hit.rows;
    }
  }
  const entry = fullRead(filePath, st);
  touch(filePath, entry);
  evict();
  return entry.rows;
}

/** 还是同一份只追加的文件：头部没变，且上次读到的末尾仍是换行。 */
function appendOnly(filePath: string, hit: Entry): boolean {
  if (hit.consumed === 0) return hit.head === "";
  const probe = readRange(filePath, 0, Math.max(hit.head.length, 0));
  if (headOf(probe) !== hit.head) return false;
  const edge = readRange(filePath, hit.consumed - 1, hit.consumed);
  return edge.length === 1 && edge[0] === NL;
}
