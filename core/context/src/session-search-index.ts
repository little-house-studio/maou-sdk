/**
 * 每个 SessionStore 根一份 search.sqlite：event_loc + FTS5 event_docs。
 * 派生索引，权威仍是 events.jsonl。
 */

import { createRequire } from "node:module";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { SessionLedgerEvent } from "@little-house-studio/types";
import { isMessageEventType } from "./session-ledger.js";
import {
  isMessageOffsetType,
  isOverlayType,
  isSearchableType,
  readNewJsonlLines,
} from "./jsonl-offset.js";

const require = createRequire(import.meta.url);

const SEARCH_TEXT_LIMIT = 8000;
export const SEARCH_DB_FILE = "search.sqlite";

export interface EventLocRow {
  sessionId: string;
  seq: number;
  absSeq: number;
  byteOffset: number;
  isMessage: boolean;
  messageId?: string;
  type: string;
}

export interface SearchHit {
  sessionId: string;
  seq: number;
  absSeq: number;
  type: string;
  messageId?: string;
  snippet: string;
  rank: number;
  hitCount?: number;
}

export interface SearchPage {
  items: SearchHit[];
  nextCursor?: string;
}

export interface IndexAppend {
  sessionId: string;
  seq: number;
  absSeq: number;
  byteOffset: number;
  type: string;
  messageId?: string;
  title?: string;
  text?: string;
  fileSize: number;
}

interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): {
    run: (...args: unknown[]) => { changes?: number };
    all: (...args: unknown[]) => Record<string, unknown>[];
    get: (...args: unknown[]) => Record<string, unknown> | undefined;
  };
  close(): void;
}

function tryOpenSqlite(path: string): SqliteDb | null {
  if (process.env.MAOU_SESSION_FTS === "0") return null;
  try {
    const mod = require("node:sqlite") as {
      DatabaseSync: new (p: string, opts?: { timeout?: number }) => SqliteDb;
    };
    const db = new mod.DatabaseSync(path);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
    return db;
  } catch {
    return null;
  }
}

function searchText(type: string, data: Record<string, unknown>, summary?: string): string {
  if (!isSearchableType(type)) return "";
  const content = typeof data.content === "string" ? data.content : "";
  const raw = content || (typeof summary === "string" ? summary : "");
  return raw.slice(0, SEARCH_TEXT_LIMIT);
}

function searchTitle(type: string, data: Record<string, unknown>): string {
  if (typeof data.title === "string") return data.title.slice(0, 200);
  if (type === "user/message" && typeof data.content === "string") {
    return data.content.slice(0, 80).replace(/\s+/g, " ");
  }
  return "";
}

function escapeFtsPhrase(q: string): string {
  return `"${q.replace(/"/g, '""')}"`;
}

export function parseSearchQuery(q: string): { phrases: string[]; tokens: string[] } {
  const phrases: string[] = [];
  const tokens: string[] = [];
  const re = /"([^"]+)"|([^\s,，。！？;；]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q))) {
    if (m[1] != null && m[1].trim()) phrases.push(m[1].trim());
    else if (m[2]?.trim()) tokens.push(m[2].trim());
  }
  return { phrases, tokens };
}

/** 标记命中为 `[hit]`。已被方括号包住的命中不再套一层（FTS snippet 已自带标记）。 */
export function highlightSnippet(text: string, needles: string[]): string {
  if (!text || needles.length === 0) return text;
  let out = text;
  for (const n of needles) {
    if (!n) continue;
    const re = new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    out = out.replace(re, (hit, at: number) => {
      const before = out[at - 1];
      const after = out[at + hit.length];
      if (before === "[" && after === "]") return hit;
      return `[${hit}]`;
    });
  }
  return out;
}

export function countQueryHits(text: string, needles: string[]): number {
  if (!text || needles.length === 0) return 0;
  const hay = text.toLowerCase();
  let n = 0;
  for (const needle of needles) {
    const q = needle.toLowerCase();
    if (!q) continue;
    let from = 0;
    while (from < hay.length) {
      const i = hay.indexOf(q, from);
      if (i < 0) break;
      n += 1;
      from = i + Math.max(q.length, 1);
    }
  }
  return n;
}

export function rankSearchHits<T extends { snippet: string; rank: number; hitCount?: number }>(
  items: T[],
): T[] {
  return [...items].sort((a, b) => {
    const ha = a.hitCount ?? 0;
    const hb = b.hitCount ?? 0;
    if (hb !== ha) return hb - ha;
    const la = a.snippet.length;
    const lb = b.snippet.length;
    if (la !== lb) return la - lb;
    return b.rank - a.rank;
  });
}

export class SessionSearchIndex {
  readonly available: boolean;
  private readonly db: SqliteDb | null;
  private generation = 1;

  constructor(sessionsDir: string) {
    const path = join(sessionsDir, SEARCH_DB_FILE);
    this.db = tryOpenSqlite(path);
    this.available = Boolean(this.db);
    if (this.db) {
      this.migrate();
      this.generation = this.readGeneration();
    }
  }

  private migrate(): void {
    const db = this.db;
    if (!db) return;
    db.exec(`
      CREATE TABLE IF NOT EXISTS event_loc (
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        abs_seq INTEGER NOT NULL,
        byte_offset INTEGER NOT NULL,
        is_message INTEGER NOT NULL,
        message_id TEXT,
        type TEXT NOT NULL,
        PRIMARY KEY (session_id, seq)
      );
      CREATE INDEX IF NOT EXISTS event_loc_abs ON event_loc (session_id, abs_seq);
      CREATE TABLE IF NOT EXISTS session_index (
        session_id TEXT PRIMARY KEY,
        next_byte_offset INTEGER NOT NULL,
        next_seq INTEGER NOT NULL,
        file_size INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS search_meta (
        k TEXT PRIMARY KEY,
        v TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS event_text (
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        abs_seq INTEGER NOT NULL,
        type TEXT NOT NULL,
        message_id TEXT,
        title TEXT,
        text TEXT NOT NULL,
        PRIMARY KEY (session_id, seq)
      );
    `);
    try {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS event_docs USING fts5(
          text,
          title,
          session_id UNINDEXED,
          seq UNINDEXED,
          abs_seq UNINDEXED,
          type UNINDEXED,
          message_id UNINDEXED,
          tokenize = 'trigram'
        );
      `);
    } catch {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS event_docs USING fts5(
          text,
          title,
          session_id UNINDEXED,
          seq UNINDEXED,
          abs_seq UNINDEXED,
          type UNINDEXED,
          message_id UNINDEXED,
          tokenize = 'unicode61'
        );
      `);
    }
    const row = db.prepare("SELECT v FROM search_meta WHERE k = 'generation'").get();
    if (!row) {
      db.prepare("INSERT INTO search_meta (k, v) VALUES ('generation', '1')").run();
    }
  }

  private readGeneration(): number {
    const row = this.db?.prepare("SELECT v FROM search_meta WHERE k = 'generation'").get();
    const n = Number(row?.v ?? 1);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  private bumpGeneration(): void {
    if (!this.db) return;
    this.generation += 1;
    this.db
      .prepare("INSERT OR REPLACE INTO search_meta (k, v) VALUES ('generation', ?)")
      .run(String(this.generation));
  }

  recordAppend(info: IndexAppend): void {
    if (!this.db) return;
    this.insertLoc(info);
    if (info.text) this.insertDoc(info);
    this.db
      .prepare(
        `INSERT INTO session_index (session_id, next_byte_offset, next_seq, file_size)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           next_byte_offset = excluded.next_byte_offset,
           next_seq = excluded.next_seq,
           file_size = excluded.file_size`,
      )
      .run(info.sessionId, info.fileSize, info.seq + 1, info.fileSize);
    this.bumpGeneration();
  }

  catchUp(sessionId: string, eventsPath: string, absSeqBase: number): void {
    if (!this.db || !existsSync(eventsPath)) return;
    const size = statSync(eventsPath).size;
    const row = this.db
      .prepare("SELECT next_byte_offset, next_seq FROM session_index WHERE session_id = ?")
      .get(sessionId);
    const start = typeof row?.next_byte_offset === "number" ? (row.next_byte_offset as number) : 0;
    if (size <= start) return;
    const { lines, nextOffset } = readNewJsonlLines(eventsPath, start);
    let nextSeq = typeof row?.next_seq === "number" ? (row.next_seq as number) : 1;
    let messageN = this.messageCount(sessionId);
    for (const { offset, line } of lines) {
      let rec: SessionLedgerEvent;
      try {
        rec = JSON.parse(line) as SessionLedgerEvent;
      } catch {
        continue;
      }
      const type = rec.type;
      const isMsg = isMessageEventType(type) && isMessageOffsetType(type);
      if (isMsg) messageN += 1;
      const fields = extractIndexFields(rec);
      const info: IndexAppend = {
        sessionId,
        seq: rec.seq,
        absSeq: absSeqBase + messageN,
        byteOffset: offset,
        type,
        messageId: fields.messageId,
        title: fields.title,
        text: fields.text,
        fileSize: nextOffset,
      };
      this.insertLoc(info);
      if (info.text) this.insertDoc(info);
      nextSeq = rec.seq + 1;
    }
    this.db
      .prepare(
        `INSERT INTO session_index (session_id, next_byte_offset, next_seq, file_size)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           next_byte_offset = excluded.next_byte_offset,
           next_seq = excluded.next_seq,
           file_size = excluded.file_size`,
      )
      .run(sessionId, nextOffset, nextSeq, size);
    if (lines.length) this.bumpGeneration();
  }

  rebuildSession(sessionId: string, eventsPath: string, absSeqBase: number): void {
    this.deleteSession(sessionId);
    this.catchUp(sessionId, eventsPath, absSeqBase);
  }

  deleteSession(sessionId: string): void {
    if (!this.db) return;
    this.db.prepare("DELETE FROM event_loc WHERE session_id = ?").run(sessionId);
    this.db.prepare("DELETE FROM event_docs WHERE session_id = ?").run(sessionId);
    this.db.prepare("DELETE FROM event_text WHERE session_id = ?").run(sessionId);
    this.db.prepare("DELETE FROM session_index WHERE session_id = ?").run(sessionId);
    this.bumpGeneration();
  }

  lastMessageId(sessionId: string): string | undefined {
    if (!this.db) return undefined;
    const row = this.db
      .prepare(
        `SELECT message_id FROM event_loc
         WHERE session_id = ? AND is_message = 1 AND message_id IS NOT NULL AND message_id != ''
         ORDER BY abs_seq DESC LIMIT 1`,
      )
      .get(sessionId);
    return typeof row?.message_id === "string" && row.message_id ? row.message_id : undefined;
  }

  locByMessageId(sessionId: string, messageId: string): EventLocRow | null {
    if (!this.db || !messageId) return null;
    const row = this.db
      .prepare(
        `SELECT session_id, seq, abs_seq, byte_offset, is_message, message_id, type
         FROM event_loc
         WHERE session_id = ? AND message_id = ? AND is_message = 1
         LIMIT 1`,
      )
      .get(sessionId, messageId);
    return row ? this.toLoc(row) : null;
  }

  locForAbsSeq(sessionId: string, absSeq: number): EventLocRow | null {
    if (!this.db) return null;
    const row = this.db
      .prepare(
        `SELECT session_id, seq, abs_seq, byte_offset, is_message, message_id, type
         FROM event_loc
         WHERE session_id = ? AND abs_seq = ? AND is_message = 1
         LIMIT 1`,
      )
      .get(sessionId, absSeq);
    return row ? this.toLoc(row) : null;
  }

  lastIndexedOffset(sessionId: string): number {
    if (!this.db) return 0;
    const row = this.db
      .prepare("SELECT next_byte_offset FROM session_index WHERE session_id = ?")
      .get(sessionId);
    return typeof row?.next_byte_offset === "number" ? (row.next_byte_offset as number) : 0;
  }

  overlayLocs(sessionId: string): { type: string; messageId?: string; byteOffset: number; seq: number }[] {
    if (!this.db) return [];
    return this.db
      .prepare(
        `SELECT seq, type, message_id, byte_offset FROM event_loc
         WHERE session_id = ? AND type IN ('message/pin','message/unpin','message/label')
         ORDER BY seq ASC`,
      )
      .all(sessionId)
      .map((row) => ({
        type: String(row.type ?? ""),
        messageId: typeof row.message_id === "string" && row.message_id ? row.message_id : undefined,
        byteOffset: Number(row.byte_offset ?? 0),
        seq: Number(row.seq ?? 0),
      }));
  }

  indexState(sessionId: string): { nextByteOffset: number; fileSize: number } | null {
    if (!this.db) return null;
    const row = this.db
      .prepare("SELECT next_byte_offset, file_size FROM session_index WHERE session_id = ?")
      .get(sessionId);
    if (!row) return null;
    return {
      nextByteOffset: Number(row.next_byte_offset ?? 0),
      fileSize: Number(row.file_size ?? 0),
    };
  }

  search(opts: {
    query: string;
    limit?: number;
    cursor?: string;
    sessionId?: string;
  }): SearchPage {
    if (!this.db) {
      throw new Error("会话搜索不可用：当前运行时没有 node:sqlite（需要 Node 22+）");
    }
    const query = opts.query.trim();
    if (!query) return { items: [] };
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
    const parsed = this.parseCursor(opts.cursor);
    if (parsed && parsed.generation !== this.generation) {
      return { items: [] };
    }
    const offset = parsed?.offset ?? 0;
    const sessionClause = opts.sessionId ? " AND session_id = ?" : "";
    const sessionArgs = opts.sessionId ? [opts.sessionId] : [];

    const parsedQ = parseSearchQuery(query);
    const needles = [...parsedQ.phrases, ...parsedQ.tokens];
    const attempts: string[] = [];
    if (parsedQ.phrases.length) {
      attempts.push(parsedQ.phrases.map(escapeFtsPhrase).join(" AND "));
    } else {
      attempts.push(escapeFtsPhrase(query));
      if (parsedQ.tokens.length > 1) {
        attempts.push(parsedQ.tokens.map(escapeFtsPhrase).join(" AND "));
      }
    }

    let rows: Record<string, unknown>[] = [];
    if (query.length >= 3) {
      for (const match of attempts) {
        try {
          rows = this.db
            .prepare(
              `SELECT session_id, seq, abs_seq, type, message_id,
                      snippet(event_docs, 0, '[', ']', ' … ', 32) AS snippet,
                      bm25(event_docs, 1.0, 2.0) AS rank
               FROM event_docs
               WHERE event_docs MATCH ?${sessionClause}
               ORDER BY rank ASC, abs_seq DESC
               LIMIT ? OFFSET ?`,
            )
            .all(match, ...sessionArgs, limit + 1, offset);
        } catch {
          rows = [];
        }
        if (rows.length) break;
      }
    }

    if (!rows.length) {
      const likeNeedle = parsedQ.phrases[0] ?? query;
      const like = `%${likeNeedle}%`;
      rows = this.db
        .prepare(
          `SELECT session_id, seq, abs_seq, type, message_id, text, title, 0 AS rank
           FROM event_text
           WHERE (text LIKE ? OR title LIKE ?)${sessionClause}
           ORDER BY abs_seq DESC
           LIMIT ? OFFSET ?`,
        )
        .all(like, like, ...sessionArgs, limit + 1, offset)
        .map((row) => ({
          ...row,
          snippet: likeSnippet(String(row.text ?? ""), likeNeedle, needles),
        }));
    }

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const items = rankSearchHits(
      page.map((row) => {
        const snippet = highlightSnippet(String(row.snippet ?? "").slice(0, 240), needles);
        return {
          sessionId: String(row.session_id ?? ""),
          seq: Number(row.seq ?? 0),
          absSeq: Number(row.abs_seq ?? 0),
          type: String(row.type ?? ""),
          messageId: typeof row.message_id === "string" ? row.message_id : undefined,
          snippet,
          rank: -Number(row.rank ?? 0),
          hitCount: countQueryHits(snippet, needles),
        };
      }),
    );
    return {
      items,
      nextCursor: hasMore
        ? this.encodeCursor({ generation: this.generation, offset: offset + limit })
        : undefined,
    };
  }

  private messageCount(sessionId: string): number {
    if (!this.db) return 0;
    const row = this.db
      .prepare(`SELECT COUNT(*) AS c FROM event_loc WHERE session_id = ? AND is_message = 1`)
      .get(sessionId);
    return typeof row?.c === "number" ? (row.c as number) : 0;
  }

  private insertLoc(info: IndexAppend): void {
    if (!this.db) return;
    const isMsg = isMessageEventType(info.type) && isMessageOffsetType(info.type) ? 1 : 0;
    this.db
      .prepare(
        `INSERT OR REPLACE INTO event_loc
         (session_id, seq, abs_seq, byte_offset, is_message, message_id, type)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        info.sessionId,
        info.seq,
        info.absSeq,
        info.byteOffset,
        isMsg,
        info.messageId ?? null,
        info.type,
      );
  }

  private insertDoc(info: IndexAppend): void {
    if (!this.db || !info.text) return;
    this.db
      .prepare(
        `INSERT OR REPLACE INTO event_text
         (session_id, seq, abs_seq, type, message_id, title, text)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        info.sessionId,
        info.seq,
        info.absSeq,
        info.type,
        info.messageId ?? "",
        info.title ?? "",
        info.text,
      );
    this.db
      .prepare("DELETE FROM event_docs WHERE session_id = ? AND seq = ?")
      .run(info.sessionId, info.seq);
    this.db
      .prepare(
        `INSERT INTO event_docs (text, title, session_id, seq, abs_seq, type, message_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        info.text,
        info.title ?? "",
        info.sessionId,
        info.seq,
        info.absSeq,
        info.type,
        info.messageId ?? "",
      );
  }

  private toLoc(row: Record<string, unknown>): EventLocRow {
    return {
      sessionId: String(row.session_id ?? ""),
      seq: Number(row.seq ?? 0),
      absSeq: Number(row.abs_seq ?? 0),
      byteOffset: Number(row.byte_offset ?? 0),
      isMessage: Number(row.is_message ?? 0) === 1,
      messageId: typeof row.message_id === "string" ? row.message_id : undefined,
      type: String(row.type ?? ""),
    };
  }

  private encodeCursor(c: { generation: number; offset: number }): string {
    return Buffer.from(JSON.stringify(c), "utf-8").toString("base64url");
  }

  private parseCursor(raw?: string): { generation: number; offset: number } | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf-8")) as {
        generation?: number;
        offset?: number;
      };
      if (typeof parsed.generation !== "number" || typeof parsed.offset !== "number") return null;
      return { generation: parsed.generation, offset: parsed.offset };
    } catch {
      return null;
    }
  }
}

function likeSnippet(text: string, q: string, needles?: string[]): string {
  const hay = text.toLowerCase();
  const needle = q.toLowerCase();
  const i = hay.indexOf(needle);
  if (i < 0) return highlightSnippet(text.slice(0, 120), needles ?? [q]);
  const start = Math.max(0, i - 40);
  const chunk = text.slice(start, start + 160);
  const raw = `${start > 0 ? "…" : ""}${chunk}${start + 160 < text.length ? "…" : ""}`;
  return highlightSnippet(raw, needles ?? [q]);
}

export function extractIndexFields(
  rec: SessionLedgerEvent,
): { messageId?: string; title: string; text: string } {
  const data = rec.data ?? {};
  const messageId =
    rec.messageId ??
    (typeof data.id === "string" ? data.id : undefined) ??
    (typeof data.entryId === "string" ? data.entryId : undefined);
  return {
    messageId,
    title: searchTitle(rec.type, data),
    text: searchText(rec.type, data, rec.summary),
  };
}

export function parseLedgerLine(line: string): SessionLedgerEvent | null {
  try {
    const rec = JSON.parse(line) as SessionLedgerEvent;
    if (typeof rec.seq !== "number" || typeof rec.type !== "string") return null;
    return rec;
  } catch {
    return null;
  }
}

export { isOverlayType };
