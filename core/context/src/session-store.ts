/**
 * 会话存储 v1 —— 每会话一个目录，events.jsonl 只追加。
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import type { SessionLedgerEvent } from "@little-house-studio/types";
import { resolveAnonFeedbackId } from "@little-house-studio/types";
import type { ContextAssertRecord } from "./context-assert.js";
import type { MaouMessage } from "./types/message.js";
import {
  maouToSessionMessage,
  sessionToMaouMessage,
} from "./types/message.js";
import {
  filterLlmVisible,
  newEntryId,
  selectBranch,
  type SessionVisibility,
} from "./session-tree.js";
import { patchPendingToolInterrupts } from "./tool-result.js";
import {
  appendLedgerEvent,
  flushLedger,
  isMessageEventType,
  KIND_TO_LEDGER_TYPE,
  ledgerPath as ledgerFilePath,
  readLedgerRecords,
  setLedgerAppendListener,
  type LedgerAppendInfo,
} from "./session-ledger.js";
import { resolveSessionEventKind } from "./session-event.js";
import {
  catchUpOffsetSidecar,
  isOverlayType,
  lastOffsetRec,
  lineCrcMatches,
  offsetRecAtOrBefore,
  readLineAt,
  readOffsetRecs,
  rebuildOffsetSidecar,
  scanMessageOffsetsReverse,
} from "./jsonl-offset.js";
import {
  extractIndexFields,
  parseLedgerLine,
  SessionSearchIndex,
  type SearchHit,
  type SearchPage,
} from "./session-search-index.js";
import { durableAtomicWrite, durableAtomicWriteJson, durableAppend } from "./durable-write.js";
import { peekPendingWrites, pendingLastSeq } from "./write-coordinator.js";
import { listSealedSegments, readSealedLine, sealLivePrefixIfNeeded } from "./events-archive.js";
import {
  foldCacheUsable,
  messageFingerprint,
  readFoldCache,
  writeFoldCache,
} from "./fold-cache.js";
import { classifyOpenTurn, classifyUnclosedTools } from "./tool-recovery.js";
import { draftTitleFromText, type TitleSource } from "./session-title.js";
import {
  LIST_CACHE_FILE,
  readListCache,
  removeListCacheItem,
  stripHeavySessionMetaText,
  upsertListCacheItem,
  writeListCache,
  type ListCacheItem,
} from "./list-cache.js";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const SESSION_FORMAT = "maou.session.v1";
export const SESSION_JSON = "session.json";
export const DEFAULT_RECENT_LIMIT = 80;

export interface SessionPrefixRef {
  sessionId: string;
  throughSeq: number;
}

export interface SessionMeta {
  format?: string;
  id: string;
  title: string;
  agent_name: string;
  created_at: string;
  updated_at: string;
  parent_session_id?: string;
  fork_boundary_id?: string;
  prefix_ref?: SessionPrefixRef;
  leaf_id?: string;
  leaf_seq?: number;
  message_count?: number;
  last_prompt?: string;
  last_raw_response?: string;
  title_source?: TitleSource;
  replace_generation?: number;
  /** MAOU_CONTEXT_ASSERT=1 时上一轮的稳定前缀结构 */
  context_assert?: ContextAssertRecord;
  lifetime?: SessionLifetime;
  [key: string]: unknown;
}

export interface SessionLifetime {
  userTurns: number;
  assistantTurns: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  modelMs: number;
  toolMs: number;
  ttftMs: number;
}

export interface SessionData {
  id: string;
  title: string;
  agentName: string;
  messages: SessionMessage[];
  maouMessages?: MaouMessage[];
  trace: SessionTrace[];
  createdAt: string;
  updatedAt: string;
  lastPrompt: string;
  lastRawResponse: string;
  parentSessionId?: string;
  leafId?: string;
  raw_data: { rounds: unknown[] };
}

export interface SessionMessage {
  role: string;
  content: string;
  createdAt: string;
  pinned?: boolean;
  source?: string;
  toolCallId?: string;
  toolCalls?: Array<{
    id: string;
    type: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  tool_name?: string;
  reasoningContent?: string;
  id?: string;
  parentId?: string | null;
  visibility?: SessionVisibility;
  customType?: string;
  label?: string;
  images?: Array<{ mimeType: string; data?: string; hash?: string; name?: string }>;
  _maouMeta?: unknown;
  seq?: number;
  [key: string]: unknown;
}

export interface SessionTrace {
  [key: string]: unknown;
}

export interface SessionListItem {
  id: string;
  title: string;
  updatedAt?: string;
  messageCount: number;
  lastMsgAt: string;
  parentSessionId?: string;
  agentName?: string;
  oneshot?: boolean;
  leafSeq?: number;
}

export interface LoadRecentPage {
  messages: SessionMessage[];
  oldestSeq: number | null;
  newestSeq: number | null;
  hasMore: boolean;
  sessionId: string;
}

export interface DeletePreview {
  sessionId: string;
  dependents: SessionListItem[];
  warning?: string;
}

export interface DeleteResult {
  deleted: boolean;
  materialized: string[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function atomicWriteJson(filePath: string, data: unknown): void {
  durableAtomicWriteJson(filePath, data);
}

function atomicWriteText(filePath: string, text: string): void {
  durableAtomicWrite(filePath, text);
}

function emptyLifetime(): SessionLifetime {
  return {
    userTurns: 0,
    assistantTurns: 0,
    toolCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    modelMs: 0,
    toolMs: 0,
    ttftMs: 0,
  };
}

function tryReadJson(filePath: string): unknown {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function asPrefixRef(value: unknown): SessionPrefixRef | undefined {
  if (!value || typeof value !== "object") return undefined;
  const rec = value as Record<string, unknown>;
  if (typeof rec.sessionId !== "string" || !rec.sessionId) return undefined;
  if (typeof rec.throughSeq !== "number" || !Number.isFinite(rec.throughSeq)) return undefined;
  return { sessionId: rec.sessionId, throughSeq: rec.throughSeq };
}

export class SessionStore {
  readonly sessionDir: string;
  readonly searchIndex: SessionSearchIndex;
  private agentNameCache = new Map<string, string>();
  private liveIds = new Set<string>();

  constructor(sessionDir: string) {
    this.sessionDir = sessionDir;
    mkdirSync(sessionDir, { recursive: true });
    this.searchIndex = new SessionSearchIndex(sessionDir);
    setLedgerAppendListener(sessionDir, (info) => this.handleLedgerAppend(info));
  }

  markLive(sessionId: string): void {
    this.liveIds.add(sessionId);
  }

  markCold(sessionId: string): void {
    this.liveIds.delete(sessionId);
  }

  isLive(sessionId: string): boolean {
    return this.liveIds.has(sessionId);
  }

  flush(sessionId: string): void {
    flushLedger(this.sessionDir, sessionId);
    try {
      sealLivePrefixIfNeeded(this.sessionRoot(sessionId));
    } catch {
      /* 密封失败不影响活日志 */
    }
  }

  search(opts: {
    query: string;
    limit?: number;
    cursor?: string;
    sessionId?: string;
  }): SearchPage {
    if (!this.searchIndex.available) {
      const reason =
        process.env.MAOU_SESSION_FTS === "0"
          ? "会话搜索已关闭（MAOU_SESSION_FTS=0）"
          : "会话搜索不可用：当前运行时没有 node:sqlite（需要 Node 22+）";
      throw new Error(reason);
    }
    if (opts.sessionId) this.ensureIndexed(opts.sessionId);
    else {
      for (const item of this.list()) this.ensureIndexed(item.id);
    }
    const page = this.searchIndex.search(opts);
    return this.mergeLiveSearch(page, opts);
  }

  sessionRoot(sessionId: string): string {
    return join(this.sessionDir, sessionId);
  }

  jsonlPath(sessionId: string): string {
    return ledgerFilePath(this.sessionDir, sessionId);
  }

  ledgerPath(sessionId: string): string {
    return ledgerFilePath(this.sessionDir, sessionId);
  }

  metaPath(sessionId: string): string {
    return join(this.sessionRoot(sessionId), SESSION_JSON);
  }

  private rawPath(sessionId: string): string {
    const dir = this.sessionRoot(sessionId);
    mkdirSync(dir, { recursive: true });
    return join(dir, "raw.jsonl");
  }

  private getAgentName(sessionId: string): string {
    const cached = this.agentNameCache.get(sessionId);
    if (cached !== undefined) return cached;
    const meta = this.readMeta(sessionId);
    const name = meta?.agent_name || "main";
    this.agentNameCache.set(sessionId, name);
    return name;
  }

  readMeta(sessionId: string): SessionMeta | null {
    return this.parseMetaFile(this.metaPath(sessionId), false);
  }

  /** 列表用：丢掉 last_prompt / last_raw_response 再 parse。 */
  readMetaSlim(sessionId: string): SessionMeta | null {
    return this.parseMetaFile(this.metaPath(sessionId), true);
  }

  private parseMetaFile(filePath: string, slim: boolean): SessionMeta | null {
    try {
      if (!existsSync(filePath)) return null;
      const text = readFileSync(filePath, "utf-8");
      const raw = JSON.parse(slim ? stripHeavySessionMetaText(text) : text);
      if (!raw || typeof raw !== "object") return null;
      const meta = raw as SessionMeta;
      if (!meta.id) return null;
      if (meta.format && meta.format !== SESSION_FORMAT) return null;
      if (meta.prefix_ref) {
        const ref = asPrefixRef(meta.prefix_ref);
        if (ref) meta.prefix_ref = ref;
        else delete meta.prefix_ref;
      }
      if (slim) {
        delete meta.last_prompt;
        delete meta.last_raw_response;
      }
      return meta;
    } catch {
      return null;
    }
  }

  private writeMeta(sessionId: string, meta: SessionMeta): void {
    meta.format = SESSION_FORMAT;
    meta.id = sessionId;
    meta.updated_at = nowIso();
    atomicWriteJson(this.metaPath(sessionId), meta);
    this.touchListCache(sessionId, meta);
  }

  private patchMeta(sessionId: string, patch: Partial<SessionMeta>): SessionMeta | null {
    const meta = this.readMeta(sessionId);
    if (!meta) return null;
    Object.assign(meta, patch);
    this.writeMeta(sessionId, meta);
    return meta;
  }

  create(
    titleOrOpts?: string | {
      title?: string;
      agentName?: string;
      sessionId?: string;
      parentSessionId?: string;
      permissionPreset?: string;
      sendMode?: string;
    },
    agentName?: string,
    sessionId?: string,
  ): SessionData {
    let title: string | undefined;
    let parentSessionId: string | undefined;
    let permissionPreset: string | undefined;
    let sendMode: string | undefined;
    if (typeof titleOrOpts === "object" && titleOrOpts !== null) {
      title = titleOrOpts.title;
      agentName = titleOrOpts.agentName;
      sessionId = titleOrOpts.sessionId;
      parentSessionId = titleOrOpts.parentSessionId;
      permissionPreset = titleOrOpts.permissionPreset;
      sendMode = titleOrOpts.sendMode;
    } else {
      title = titleOrOpts;
    }
    if (!sessionId) {
      const now = new Date();
      const ts = now.toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
      const rand = Math.random().toString(36).slice(2, 10);
      sessionId = `${ts}-${rand}`;
    }
    const ts = nowIso();
    mkdirSync(this.sessionRoot(sessionId), { recursive: true });
    if (!existsSync(this.jsonlPath(sessionId))) {
      durableAtomicWrite(this.jsonlPath(sessionId), "");
    }
    const meta: SessionMeta = {
      format: SESSION_FORMAT,
      id: sessionId,
      title: title ?? "新对话",
      agent_name: agentName ?? "main",
      created_at: ts,
      updated_at: ts,
      message_count: 0,
      title_source: "draft",
      replace_generation: 0,
      lifetime: emptyLifetime(),
      ...(parentSessionId ? { parent_session_id: parentSessionId } : {}),
      ...(permissionPreset ? { permission_preset: permissionPreset } : {}),
      ...(sendMode ? { send_mode: sendMode } : {}),
    };
    this.writeMeta(sessionId, meta);
    this.agentNameCache.set(sessionId, meta.agent_name);
    try {
      appendLedgerEvent(this.sessionDir, sessionId, "session/created", {
        title: meta.title,
        agentName: meta.agent_name,
        parentSessionId: parentSessionId ?? null,
      });
      this.flush(sessionId);
    } catch {
      /* 建会话不受账本影响 */
    }
    return this.sessionFromMeta(meta, [], []);
  }

  setSendMode(sessionId: string, mode: string): boolean {
    return this.patchMeta(sessionId, { send_mode: mode }) != null;
  }

  setPermissionPreset(sessionId: string, preset: string): boolean {
    return this.patchMeta(sessionId, { permission_preset: preset }) != null;
  }

  noteFeedback(
    sessionId: string,
    messageId: string,
    vote: "up" | "down",
    opts?: { note?: string },
  ): { conflict: boolean } {
    const meta = this.readMeta(sessionId);
    if (!meta) return { conflict: false };
    const prevMap =
      meta.feedback && typeof meta.feedback === "object" && !Array.isArray(meta.feedback)
        ? (meta.feedback as Record<string, unknown>)
        : {};
    const prev = prevMap[messageId];
    const conflict = typeof prev === "string" && prev !== vote;
    this.patchMeta(sessionId, { feedback: { ...prevMap, [messageId]: vote } });
    const note = (opts?.note ?? "").trim().slice(0, 500);
    appendLedgerEvent(this.sessionDir, sessionId, "message/feedback", {
      messageId,
      vote,
      note: note || undefined,
      conflict: conflict || undefined,
      anonFeedbackId: resolveAnonFeedbackId(),
    });
    return { conflict };
  }

  bumpReplaceGeneration(sessionId: string): number {
    const meta = this.readMeta(sessionId);
    const next = (typeof meta?.replace_generation === "number" ? meta.replace_generation : 0) + 1;
    this.patchMeta(sessionId, { replace_generation: next });
    return next;
  }

  setAgentName(sessionId: string, name: string): void {
    this.patchMeta(sessionId, { agent_name: name });
    this.agentNameCache.set(sessionId, name);
  }

  setTitle(sessionId: string, title: string, source: TitleSource = "user"): boolean {
    const meta = this.readMeta(sessionId);
    if (!meta) return false;
    const t = title.trim().slice(0, 80);
    if (!t) return false;
    if (source !== "user" && meta.title_source === "user") return true;
    appendLedgerEvent(this.sessionDir, sessionId, "session/title", { title: t, source });
    this.flush(sessionId);
    this.patchMeta(sessionId, { title: t, title_source: source });
    return true;
  }

  ensure(sessionId?: string | null, agentName?: string): SessionData {
    if (sessionId) {
      const existing = this.load(sessionId);
      if (existing) return existing;
      return this.create({ sessionId, agentName });
    }
    return this.create({ agentName });
  }

  exists(sessionId: string): boolean {
    return this.readMetaSlim(sessionId) != null;
  }

  load(sessionId: string): SessionData | null {
    this.flush(sessionId);
    if (!this.isLive(sessionId)) this.recoverCold(sessionId);
    const folded = this.foldBranch(sessionId);
    if (!folded) return null;
    return folded;
  }

  /** 冷打开补账：未闭合工具 + 半截轮次。热着不写。 */
  recoverCold(sessionId: string): void {
    if (this.isLive(sessionId) || !this.exists(sessionId)) return;
    this.recoverColdTools(sessionId);
    this.recoverColdTurn(sessionId);
  }

  list(): SessionListItem[] {
    if (!existsSync(this.sessionDir)) return [];
    const ids = this.sessionDirIds();
    const cached = readListCache(this.sessionDir);
    if (cached && this.listCacheCovers(cached.items, ids)) {
      return cached.items
        .filter((row) => ids.has(row.id))
        .sort((a, b) => (b.lastMsgAt || "").localeCompare(a.lastMsgAt || ""));
    }
    const sessions: SessionListItem[] = [];
    for (const name of ids) {
      const item = this.listItemFromMeta(name);
      if (item) sessions.push(item);
    }
    sessions.sort((a, b) => (b.lastMsgAt || "").localeCompare(a.lastMsgAt || ""));
    writeListCache(this.sessionDir, sessions);
    return sessions;
  }

  /** 磁盘上的子孙（含间接），不必 load 整只 Agent。 */
  listDescendents(rootId: string): SessionListItem[] {
    const all = this.list();
    const children = new Map<string, SessionListItem[]>();
    for (const item of all) {
      const parent = item.parentSessionId;
      if (!parent) continue;
      const list = children.get(parent);
      if (list) list.push(item);
      else children.set(parent, [item]);
    }
    const out: SessionListItem[] = [];
    const seen = new Set<string>();
    const walk = (id: string) => {
      for (const child of children.get(id) ?? []) {
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        out.push(child);
        walk(child.id);
      }
    };
    walk(rootId);
    return out;
  }

  forkSession(
    sourceSessionId: string,
    newTitle?: string,
    targetSessionId?: string,
  ): SessionData {
    const source = this.readMeta(sourceSessionId);
    if (!source) throw new Error(`源会话不存在: ${sourceSessionId}`);
    if (targetSessionId && this.exists(targetSessionId)) {
      const existing = this.load(targetSessionId);
      if (existing) return existing;
    }
    const throughSeq = this.lastEventSeq(sourceSessionId);
    const leafId = source.leaf_id;
    const created = this.create({
      title: newTitle ?? `${source.title} (副本)`,
      agentName: source.agent_name,
      sessionId: targetSessionId,
      parentSessionId: sourceSessionId,
    });
    this.patchMeta(created.id, {
      title: newTitle ?? `${source.title} (副本)`,
      parent_session_id: sourceSessionId,
      prefix_ref: throughSeq > 0 ? { sessionId: sourceSessionId, throughSeq } : undefined,
      fork_boundary_id: leafId,
      leaf_id: leafId,
      leaf_seq: throughSeq || undefined,
      message_count: source.message_count ?? 0,
    });
    appendLedgerEvent(this.sessionDir, created.id, "session/fork", {
      sourceSessionId,
      throughSeq,
      boundaryId: leafId ?? null,
    });
    return this.load(created.id) ?? created;
  }

  forkFromEntry(
    sourceSessionId: string,
    entryId: string,
    opts?: { title?: string; targetSessionId?: string },
  ): SessionData {
    const source = this.readMeta(sourceSessionId);
    if (!source) throw new Error(`源会话不存在: ${sourceSessionId}`);
    const located = this.collectLocatedMessages(sourceSessionId);
    const hit = located.find((row) => row.message.id === entryId);
    if (!hit) throw new Error(`找不到分叉边界: ${entryId}`);
    const created = this.create({
      title: opts?.title ?? `${source.title} (fork)`,
      agentName: source.agent_name,
      sessionId: opts?.targetSessionId,
      parentSessionId: sourceSessionId,
    });
    this.patchMeta(created.id, {
      parent_session_id: sourceSessionId,
      prefix_ref: { sessionId: sourceSessionId, throughSeq: hit.seq },
      fork_boundary_id: entryId,
      leaf_id: entryId,
      leaf_seq: hit.absSeq,
      message_count: located.filter((row) => row.absSeq <= hit.absSeq).length,
    });
    appendLedgerEvent(this.sessionDir, created.id, "session/fork", {
      sourceSessionId,
      throughSeq: hit.seq,
      boundaryId: entryId,
    });
    return this.load(created.id) ?? created;
  }

  /** 清空 = 删除整卷 */
  clearSession(sessionId: string): DeleteResult {
    return this.deleteSession(sessionId);
  }

  delete(sessionId: string): boolean {
    return this.deleteSession(sessionId).deleted;
  }

  previewDelete(sessionId: string): DeletePreview {
    const dependents = this.listDependents(sessionId);
    return {
      sessionId,
      dependents,
      warning:
        dependents.length > 0
          ? `删除后会先把 ${dependents.length} 个子会话的共享前缀拷进它们自己的目录，再删除母会话。`
          : undefined,
    };
  }

  listDependents(sessionId: string): SessionListItem[] {
    return this.list().filter((item) => item.id !== sessionId && this.prefixChainIncludes(item.id, sessionId));
  }

  deleteSession(sessionId: string): DeleteResult {
    if (!this.exists(sessionId) && !existsSync(this.sessionRoot(sessionId))) {
      return { deleted: false, materialized: [] };
    }
    const dependents = this.listDependents(sessionId);
    const materialized: string[] = [];
    for (const dep of dependents) {
      this.materializePrefix(dep.id);
      materialized.push(dep.id);
    }
    const root = this.sessionRoot(sessionId);
    if (existsSync(root)) {
      rmSync(root, { recursive: true, force: true });
    }
    this.searchIndex.deleteSession(sessionId);
    this.agentNameCache.delete(sessionId);
    removeListCacheItem(this.sessionDir, sessionId);
    return { deleted: true, materialized };
  }

  materializePrefix(sessionId: string): void {
    const meta = this.readMeta(sessionId);
    if (!meta?.prefix_ref) return;
    const prefix = this.resolvePrefixEvents(meta.prefix_ref, new Set([sessionId]));
    const own = readLedgerRecords(this.sessionDir, sessionId);
    const merged = [...prefix, ...own];
    const lines: string[] = [];
    merged.forEach((ev, i) => {
      lines.push(JSON.stringify({ ...ev, seq: i + 1, sessionId }));
    });
    atomicWriteText(this.jsonlPath(sessionId), lines.length ? `${lines.join("\n")}\n` : "");
    rebuildOffsetSidecar(this.sessionRoot(sessionId), this.jsonlPath(sessionId));
    const last = merged[merged.length - 1];
    delete meta.prefix_ref;
    meta.leaf_seq = merged.length;
    if (last && typeof last.messageId === "string") meta.leaf_id = last.messageId;
    this.writeMeta(sessionId, meta);
    this.searchIndex.rebuildSession(sessionId, this.jsonlPath(sessionId), 0);
  }

  appendMessage(
    sessionId: string,
    role: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): SessionData {
    if (!this.exists(sessionId)) {
      const created = this.create({ sessionId });
      sessionId = created.id;
    }
    const item: Record<string, unknown> = this.stampTreeFields(sessionId, {
      role,
      content,
      createdAt: nowIso(),
      ...metadata,
    });
    const kind = resolveSessionEventKind(item);
    const type =
      typeof item.customType === "string" && item.customType
        ? "session/custom"
        : KIND_TO_LEDGER_TYPE[kind];
    const messageId = typeof item.id === "string" ? item.id : undefined;
    const wrote = appendLedgerEvent(this.sessionDir, sessionId, type, item, { messageId });
    if ("seq" in wrote && typeof item.id === "string") {
      this.patchMeta(sessionId, {
        leaf_id: String(item.id),
        leaf_seq: wrote.seq,
        message_count: (this.readMeta(sessionId)?.message_count ?? 0) + 1,
      });
    }
    if (kind === "assistant_turn" && Array.isArray(item.toolCalls)) {
      for (const raw of item.toolCalls) {
        if (!raw || typeof raw !== "object") continue;
        const tc = raw as Record<string, unknown>;
        if (typeof tc.name !== "string") continue;
        appendLedgerEvent(
          this.sessionDir,
          sessionId,
          "tool/call",
          { id: tc.id, name: tc.name, arguments: tc.arguments ?? tc.parameters },
          { messageId },
        );
      }
    }
    if (role === "user") this.maybeUpdateTitle(sessionId, content);
    this.flush(sessionId);
    return this.foldBranch(sessionId, { writeCache: false }) ?? this.create({ sessionId });
  }

  appendTrace(sessionId: string, item: Record<string, unknown>): void {
    if (!this.exists(sessionId)) this.create({ sessionId });
    appendLedgerEvent(this.sessionDir, sessionId, "session/trace", { data: item });
  }

  appendEvent(
    sessionId: string,
    eventType: string,
    data: Record<string, unknown>,
    opts?: { messageId?: string },
  ): { seq: number } | { error: string } {
    if (!this.exists(sessionId)) this.create({ sessionId });
    const wrote = appendLedgerEvent(this.sessionDir, sessionId, eventType, data, opts);
    this.flush(sessionId);
    return wrote;
  }

  setLastPrompt(sessionId: string, prompt: string): void {
    this.patchMeta(sessionId, { last_prompt: prompt });
  }

  readContextAssert(sessionId: string): ContextAssertRecord | null {
    const rec = this.readMeta(sessionId)?.context_assert;
    return rec && typeof rec.prefixHash === "string" ? rec : null;
  }

  writeContextAssert(sessionId: string, rec: ContextAssertRecord): void {
    this.patchMeta(sessionId, { context_assert: rec });
  }

  setLastRawResponse(sessionId: string, rawResponse: string): void {
    this.patchMeta(sessionId, { last_raw_response: rawResponse });
  }

  static readonly RAW_MAX_ENTRIES = 500;
  static readonly RAW_KEEP_AFTER_PURGE = 400;

  appendRawEntry(sessionId: string, entry: Record<string, unknown>): void {
    if (!this.exists(sessionId)) this.create({ sessionId });
    const typ = String(entry.type ?? entry.event ?? "");
    if (typ === "assistant_delta" || typ === "thinking_delta" || typ === "text_delta") return;
    const filePath = this.rawPath(sessionId);
    this.rotateRawLogIfNeeded(filePath);
    durableAppend(filePath, `${JSON.stringify(entry)}\n`);
    this.enforceRawEntryLimit(filePath);
  }

  private enforceRawEntryLimit(filePath: string): void {
    try {
      if (!existsSync(filePath)) return;
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim().length > 0);
      if (lines.length <= SessionStore.RAW_MAX_ENTRIES) return;
      const kept = lines.slice(lines.length - SessionStore.RAW_KEEP_AFTER_PURGE);
      writeFileSync(filePath, kept.join("\n") + "\n", "utf-8");
    } catch {
      /* 限制失败不挡主流程 */
    }
  }

  loadPostLogs(
    sessionId: string,
    filters?: { round?: number; since?: string; until?: string },
  ): Record<string, unknown>[] {
    const filePath = this.rawPath(sessionId);
    if (!existsSync(filePath)) return [];
    const results: Record<string, unknown>[] = [];
    for (const line of readFileSync(filePath, "utf-8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        if (entry.event !== "llm.post") continue;
        if (typeof filters?.round === "number" && entry.round !== filters.round) continue;
        if (filters?.since && typeof entry.created_at === "string" && entry.created_at < filters.since) continue;
        if (filters?.until && typeof entry.created_at === "string" && entry.created_at > filters.until) continue;
        results.push(entry);
      } catch {
        continue;
      }
    }
    return results;
  }

  getLatestPostLog(sessionId: string): Record<string, unknown> | null {
    const filePath = this.rawPath(sessionId);
    if (!existsSync(filePath)) return null;
    const lines = readFileSync(filePath, "utf-8").split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line?.trim()) continue;
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        if (entry.event === "llm.post") return entry;
      } catch {
        continue;
      }
    }
    return null;
  }

  purgeLegacyRawLogs(sessionId: string): { purged: number } {
    const filePath = this.rawPath(sessionId);
    if (!existsSync(filePath)) return { purged: 0 };
    const lines = readFileSync(filePath, "utf-8").split("\n");
    const kept: string[] = [];
    let purged = 0;
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        if ("event" in entry || "type" in entry) kept.push(JSON.stringify(entry));
        else purged++;
      } catch {
        purged++;
      }
    }
    if (purged === 0) return { purged: 0 };
    writeFileSync(filePath, kept.join("\n") + (kept.length ? "\n" : ""), "utf-8");
    return { purged };
  }

  loadRawByRound(sessionId: string, round: number): Record<string, unknown>[] {
    const path = this.rawPath(sessionId);
    if (!existsSync(path)) return [];
    const results: Record<string, unknown>[] = [];
    for (const line of readFileSync(path, "utf-8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.round === round) results.push(entry);
      } catch {
        continue;
      }
    }
    return results;
  }

  getRawData(sessionId: string): Record<string, unknown>[] {
    const path = this.rawPath(sessionId);
    if (!existsSync(path)) return [];
    const results: Record<string, unknown>[] = [];
    for (const line of readFileSync(path, "utf-8").split("\n")) {
      if (!line.trim()) continue;
      try {
        results.push(JSON.parse(line));
      } catch {
        continue;
      }
    }
    return results;
  }

  getTrace(sessionId: string): SessionTrace[] {
    return this.load(sessionId)?.trace ?? [];
  }

  injectHook(options: {
    sessionId: string;
    message: string;
    source?: string;
    metadata?: Record<string, unknown>;
  }): void {
    this.appendMessage(options.sessionId, "user", options.message, {
      source: options.source ?? "hook",
      ...options.metadata,
    });
  }

  getLatestUsage(sessionId: string): { usage: Record<string, number>; model: string } {
    const usage: Record<string, number> = {};
    let model = "";
    for (const ev of this.readEventChain(sessionId)) {
      if (ev.type === "session/trace") {
        const item = (ev.data?.data ?? ev.data) as Record<string, unknown>;
        const tt = String(item.type ?? "");
        if (tt === "model.usage") {
          const u = item.usage as Record<string, unknown> | undefined;
          if (u && typeof u === "object") {
            for (const [k, v] of Object.entries(u)) {
              if (typeof v === "number") usage[k] = v;
            }
          }
        }
        if (tt === "model.request" && !model) {
          const body = (item.request_body ?? item.payload ?? {}) as Record<string, unknown>;
          model = String(body.model ?? "");
        }
      }
      const u = ev.data?.usage as Record<string, unknown> | undefined;
      if (u && typeof u === "object") {
        for (const [k, v] of Object.entries(u)) {
          if (typeof v === "number") usage[k] = v;
        }
      }
    }
    return { usage, model };
  }

  injectPendingToolInterrupts(sessionId: string): boolean {
    return patchPendingToolInterrupts(this, sessionId) > 0;
  }

  readAllMessages(sessionId: string): SessionMessage[] {
    return this.collectLocatedMessages(sessionId).map((row) => row.message);
  }

  getLeafId(sessionId: string): string | undefined {
    const meta = this.readMeta(sessionId);
    if (typeof meta?.leaf_id === "string") return meta.leaf_id;
    return this.peekLastMessageId(sessionId);
  }

  getLlmHistoryMessages(sessionId: string): SessionMessage[] {
    const all = this.readAllMessages(sessionId);
    if (all.length === 0) return [];
    return filterLlmVisible(selectBranch(all, this.getLeafId(sessionId)));
  }

  foldBranch(sessionId: string, opts?: { writeCache?: boolean }): SessionData | null {
    const meta = this.readMeta(sessionId);
    if (!meta) return null;
    const writeCache = opts?.writeCache !== false;
    this.ensureSidecar(sessionId);
    const lastSeq = pendingLastSeq(this.sessionDir, sessionId) ?? lastOffsetRec(this.sessionRoot(sessionId))?.seq ?? 0;
    const tailFp = this.lastMessageFingerprint(sessionId);
    const gen = typeof meta.replace_generation === "number" ? meta.replace_generation : 0;
    const cached = readFoldCache(this.sessionRoot(sessionId));
    if (cached && foldCacheUsable(cached, lastSeq, tailFp, gen) && cached.lastSeq === lastSeq) {
      const cachedMsgs = cached.messages as SessionMessage[];
      const branch = selectBranch(cachedMsgs, meta.leaf_id);
      return this.sessionFromMeta(meta, branch, cached.traces as SessionTrace[]);
    }
    if (cached && foldCacheUsable(cached, lastSeq, tailFp, gen) && cached.lastSeq < lastSeq) {
      const extras = this.readEventsAfter(sessionId, cached.lastSeq);
      const all = cached.messages.map((m) => ({ ...m })) as SessionMessage[];
      const traces = [...(cached.traces as SessionTrace[])];
      for (const ev of extras) {
        if (ev.type === "session/trace") {
          traces.push((ev.data?.data ?? ev.data ?? {}) as SessionTrace);
        }
        if (ev.type === "message/pin" && typeof ev.data.entryId === "string") {
          const hit = all.find((m) => m.id === ev.data.entryId);
          if (hit) hit.pinned = true;
        }
        if (ev.type === "message/unpin" && typeof ev.data.entryId === "string") {
          const hit = all.find((m) => m.id === ev.data.entryId);
          if (hit) hit.pinned = false;
        }
        if (ev.type === "message/label" && typeof ev.data.entryId === "string") {
          const hit = all.find((m) => m.id === ev.data.entryId);
          if (hit) hit.label = typeof ev.data.label === "string" ? ev.data.label : undefined;
        }
        if (!isMessageEventType(ev.type)) continue;
        if (ev.type === "tool/call" && !ev.data.role && !ev.data.content) continue;
        const message = eventToMessage(ev);
        if (message) all.push(message);
      }
      if (writeCache) {
        try {
          writeFoldCache(this.sessionRoot(sessionId), {
            ver: 1,
            lastSeq,
            tailFingerprint: tailFp,
            replaceGeneration: gen,
            messages: all,
            traces,
          });
        } catch {
          /* 缓存失败不影响折叠 */
        }
      }
      return this.sessionFromMeta(meta, selectBranch(all, meta.leaf_id), traces);
    }
    const located = this.collectLocatedMessages(sessionId);
    const all = located.map((row) => row.message);
    const branch = selectBranch(all, meta.leaf_id);
    const traces: SessionTrace[] = [];
    for (const ev of this.readEventChain(sessionId)) {
      if (ev.type === "session/trace") {
        traces.push((ev.data?.data ?? ev.data ?? {}) as SessionTrace);
      }
    }
    if (writeCache) {
      try {
        writeFoldCache(this.sessionRoot(sessionId), {
          ver: 1,
          lastSeq,
          tailFingerprint: tailFp,
          replaceGeneration: gen,
          messages: all,
          traces,
        });
      } catch {
        /* 缓存失败不影响折叠 */
      }
    }
    return this.sessionFromMeta(meta, branch, traces);
  }

  loadRecent(
    sessionId: string,
    opts?: { limit?: number; beforeSeq?: number },
  ): LoadRecentPage | null {
    if (!this.exists(sessionId)) return null;
    const limit = Math.max(1, opts?.limit ?? DEFAULT_RECENT_LIMIT);
    const rollbackAbs = this.rollbackAbsSeq(sessionId);
    const cutoff = Math.min(
      opts?.beforeSeq ?? Number.POSITIVE_INFINITY,
      typeof rollbackAbs === "number" ? rollbackAbs + 1 : Number.POSITIVE_INFINITY,
    );
    const segs = this.fileSegments(sessionId);
    const overlays = this.collectOverlays(sessionId);
    const newestFirst: LocatedMessage[] = [];
    let hasMore = false;
    for (let i = segs.length - 1; i >= 0 && newestFirst.length < limit; i--) {
      const seg = segs[i]!;
      const beforeN = cutoff - seg.absSeqBase;
      const need = limit - newestFirst.length;
      const { recs, hasOlder } = scanMessageOffsetsReverse(seg.root, {
        maxSeq: seg.maxSeq,
        beforeN,
        limit: need,
        file: seg.offsetFile,
      });
      for (const rec of recs) {
        const absSeq = seg.absSeqBase + rec.n;
        const row = this.locatedFromOffset(seg, rec, absSeq, overlays);
        if (row) newestFirst.push(row);
      }
      if (newestFirst.length >= limit) {
        hasMore = hasOlder || this.olderSegsHaveMessages(segs, i, cutoff);
        break;
      }
      if (hasOlder) hasMore = true;
      else if (i > 0) hasMore = this.olderSegsHaveMessages(segs, i, cutoff);
    }
    const page = newestFirst.reverse();
    const leafId = this.getLeafId(sessionId);
    const branchIds = new Set(
      selectBranch(
        page.map((r) => r.message),
        leafId,
      ).map((m) => m.id),
    );
    const onBranch = page.filter((row) => !row.message.id || branchIds.has(row.message.id));
    return {
      sessionId,
      messages: onBranch.map((row) => ({ ...row.message, seq: row.absSeq })),
      oldestSeq: onBranch[0]?.absSeq ?? null,
      newestSeq: onBranch[onBranch.length - 1]?.absSeq ?? null,
      hasMore,
    };
  }

  loadOlder(sessionId: string, beforeSeq: number, limit = DEFAULT_RECENT_LIMIT): LoadRecentPage | null {
    return this.loadRecent(sessionId, { beforeSeq, limit });
  }

  branchTo(sessionId: string, entryId: string): boolean {
    const hit = this.collectLocatedMessages(sessionId).some((row) => row.message.id === entryId);
    if (!hit) return false;
    this.patchMeta(sessionId, { leaf_id: entryId });
    appendLedgerEvent(this.sessionDir, sessionId, "session/branch", { entryId });
    return true;
  }

  rollbackTo(sessionId: string, leafId: string, leafSeq?: number): boolean {
    const hit = this.collectLocatedMessages(sessionId).find((row) => row.message.id === leafId);
    if (!hit) return false;
    this.patchMeta(sessionId, { leaf_id: leafId, leaf_seq: leafSeq ?? hit.absSeq });
    appendLedgerEvent(this.sessionDir, sessionId, "session/rollback", {
      entryId: leafId,
      toSeq: leafSeq ?? hit.seq,
    });
    return true;
  }

  setEntryLabel(sessionId: string, entryId: string, label?: string): boolean {
    const hit = this.collectLocatedMessages(sessionId).some((row) => row.message.id === entryId);
    if (!hit) return false;
    appendLedgerEvent(this.sessionDir, sessionId, "message/label", { entryId, label: label ?? null }, {
      messageId: entryId,
    });
    return true;
  }

  appendCustomEntry(
    sessionId: string,
    customType: string,
    data?: unknown,
    opts?: { visibility?: SessionVisibility; content?: string },
  ): SessionData {
    return this.appendMessage(sessionId, "system", opts?.content ?? "", {
      kind: "custom",
      customType,
      visibility: opts?.visibility ?? "ui",
      details: data,
    });
  }

  pinMessage(sessionId: string, messageIndex: number): boolean {
    return this.pinByIndex(sessionId, messageIndex, true);
  }

  unpinMessage(sessionId: string, messageIndex: number): boolean {
    return this.pinByIndex(sessionId, messageIndex, false);
  }

  setPinned(sessionId: string, messageIndex: number, pinned: boolean): boolean {
    return this.pinByIndex(sessionId, messageIndex, pinned);
  }

  loadMaouMessages(sessionId: string): MaouMessage[] {
    const session = this.load(sessionId);
    if (!session) return [];
    if (session.maouMessages && session.maouMessages.length > 0) return session.maouMessages;
    return session.messages.map((m, idx) => sessionToMaouMessage(m, idx));
  }

  appendMaouMessage(
    sessionId: string,
    hmsg: MaouMessage,
    metadata?: Record<string, unknown>,
  ): SessionData {
    const sessionMsg = maouToSessionMessage(hmsg);
    if (metadata) Object.assign(sessionMsg, metadata);
    return this.appendMessage(sessionId, sessionMsg.role, sessionMsg.content, sessionMsg);
  }

  nextSeqId(sessionId: string): number {
    const hmsgs = this.loadMaouMessages(sessionId);
    if (hmsgs.length === 0) return 0;
    return Math.max(...hmsgs.map((m) => m.seqId)) + 1;
  }

  private pinByIndex(sessionId: string, messageIndex: number, pinned: boolean): boolean {
    const msgs = this.foldBranch(sessionId)?.messages ?? [];
    const target = msgs[messageIndex];
    if (!target?.id) return false;
    appendLedgerEvent(
      this.sessionDir,
      sessionId,
      pinned ? "message/pin" : "message/unpin",
      { entryId: target.id },
      { messageId: target.id },
    );
    return true;
  }

  private stampTreeFields(sessionId: string, item: Record<string, unknown>): Record<string, unknown> {
    const meta = this.readMeta(sessionId);
    const leafId = typeof meta?.leaf_id === "string" ? meta.leaf_id : undefined;
    if (!item.id) item.id = newEntryId();
    if (item.parentId === undefined && leafId) item.parentId = leafId;
    return item;
  }

  private maybeUpdateTitle(sessionId: string, content: string): void {
    const meta = this.readMeta(sessionId);
    if (!meta) return;
    if (meta.title_source === "user" || meta.title_source === "polished") return;
    if (meta.title_source === "draft" && meta.title && meta.title !== "新对话") return;
    const title = draftTitleFromText(content);
    if (!title) return;
    this.setTitle(sessionId, title, "draft");
  }

  private sessionDirIds(): Set<string> {
    const ids = new Set<string>();
    if (!existsSync(this.sessionDir)) return ids;
    for (const name of readdirSync(this.sessionDir)) {
      if (name === LIST_CACHE_FILE) continue;
      const root = join(this.sessionDir, name);
      try {
        if (!statSync(root).isDirectory()) continue;
      } catch {
        continue;
      }
      ids.add(name);
    }
    return ids;
  }

  private listCacheCovers(items: ListCacheItem[], ids: Set<string>): boolean {
    if (items.length !== ids.size) return false;
    return items.every((row) => ids.has(row.id));
  }

  private listItemFromMeta(sessionId: string): SessionListItem | null {
    const meta = this.readMetaSlim(sessionId);
    if (!meta) return null;
    return this.listItemFromParsed(meta);
  }

  private listItemFromParsed(meta: SessionMeta): SessionListItem {
    const parentSessionId = meta.parent_session_id;
    const agentName = meta.agent_name;
    const oneshot = meta.oneshot === true || agentName === "helper";
    return {
      id: meta.id,
      title: meta.title ?? "新对话",
      updatedAt: meta.updated_at,
      messageCount: typeof meta.message_count === "number" ? meta.message_count : 0,
      lastMsgAt: meta.updated_at || meta.created_at || "",
      ...(parentSessionId ? { parentSessionId } : {}),
      ...(agentName ? { agentName } : {}),
      ...(oneshot ? { oneshot: true } : {}),
      ...(typeof meta.leaf_seq === "number" ? { leafSeq: meta.leaf_seq } : {}),
    };
  }

  private touchListCache(sessionId: string, meta?: SessionMeta | null): void {
    const parsed = meta ?? this.readMetaSlim(sessionId);
    if (!parsed) return;
    upsertListCacheItem(this.sessionDir, this.listItemFromParsed(parsed));
  }

  private recoverColdTools(sessionId: string): void {
    if (this.isLive(sessionId) || !this.exists(sessionId)) return;
    const recovered = classifyUnclosedTools(readLedgerRecords(this.sessionDir, sessionId));
    if (recovered.length === 0) return;
    for (const row of recovered) {
      appendLedgerEvent(
        this.sessionDir,
        sessionId,
        "tool/result",
        {
          role: "tool",
          toolCallId: row.callId,
          tool_name: row.name,
          content: row.content,
          ok: false,
          code: row.code,
          recovered: true,
        },
        { messageId: row.callId },
      );
    }
    this.flush(sessionId);
  }

  private recoverColdTurn(sessionId: string): void {
    if (this.isLive(sessionId) || !this.exists(sessionId)) return;
    const open = classifyOpenTurn(readLedgerRecords(this.sessionDir, sessionId));
    if (!open.open) return;
    appendLedgerEvent(this.sessionDir, sessionId, "turn/end", {
      recovered: true,
      startSeq: open.startSeq ?? null,
    });
    this.flush(sessionId);
  }

  private mergeLiveSearch(
    page: SearchPage,
    opts: { query: string; limit?: number; sessionId?: string },
  ): SearchPage {
    const q = opts.query.trim().toLowerCase();
    if (!q) return page;
    const liveHits: SearchHit[] = [];
    const ids = opts.sessionId ? [opts.sessionId] : this.list().map((s) => s.id);
    for (const id of ids) {
      for (const item of peekPendingWrites(this.sessionDir, id)) {
        const text = `${item.rec.summary ?? ""} ${JSON.stringify(item.rec.data)}`.toLowerCase();
        if (!text.includes(q)) continue;
        const snippet = String(item.rec.summary ?? item.rec.data.content ?? "").slice(0, 240);
        liveHits.push({
          sessionId: id,
          seq: item.rec.seq,
          absSeq: this.prefixAbsBase(id) + item.n,
          type: item.rec.type,
          messageId: item.rec.messageId,
          snippet,
          rank: 1000,
          hitCount: snippet.toLowerCase().split(q).length - 1,
        });
      }
    }
    if (liveHits.length === 0) return page;
    const covered = new Set(liveHits.map((h) => `${h.sessionId}:${h.seq}`));
    const rest = page.items.filter((h) => !covered.has(`${h.sessionId}:${h.seq}`));
    const items = [...liveHits, ...rest].slice(0, opts.limit ?? 20);
    return { items, nextCursor: page.nextCursor };
  }

  private lastEventSeq(sessionId: string): number {
    this.ensureSidecar(sessionId);
    return lastOffsetRec(this.sessionRoot(sessionId))?.seq ?? 0;
  }

  private lastMessageFingerprint(sessionId: string): string {
    for (const item of peekPendingWrites(this.sessionDir, sessionId).slice().reverse()) {
      if (!isMessageEventType(item.rec.type)) continue;
      if (item.rec.type === "tool/call" && !item.rec.data.role && !item.rec.data.content) continue;
      return messageFingerprint(eventToMessage(item.rec) ?? {});
    }
    const { recs } = scanMessageOffsetsReverse(this.sessionRoot(sessionId), { limit: 1 });
    if (!recs[0]) return "";
    const line = readLineAt(this.jsonlPath(sessionId), recs[0].off);
    if (!line) return "";
    const ev = parseLedgerLine(line);
    return ev ? messageFingerprint(eventToMessage(ev) ?? {}) : "";
  }

  private readEventsAfter(sessionId: string, afterSeq: number): SessionLedgerEvent[] {
    const out: SessionLedgerEvent[] = [];
    const path = this.jsonlPath(sessionId);
    for (const rec of readOffsetRecs(this.sessionRoot(sessionId))) {
      if (rec.seq <= afterSeq) continue;
      const line = readLineAt(path, rec.off);
      if (!line || !lineCrcMatches(line, rec.crc)) continue;
      const ev = parseLedgerLine(line);
      if (ev) out.push(ev);
    }
    for (const item of peekPendingWrites(this.sessionDir, sessionId)) {
      if (item.rec.seq > afterSeq) out.push(item.rec);
    }
    return out;
  }

  private handleLedgerAppend(info: LedgerAppendInfo): void {
    const fields = extractIndexFields(info.rec);
    const absSeq = this.prefixAbsBase(info.sessionId) + info.n;
    this.searchIndex.recordAppend({
      sessionId: info.sessionId,
      seq: info.rec.seq,
      absSeq,
      byteOffset: info.byteOffset,
      type: info.rec.type,
      messageId: fields.messageId ?? info.rec.messageId,
      title: fields.title,
      text: fields.text,
      fileSize: info.fileSize,
    });
    this.bumpLifetime(info.sessionId, info.rec);
  }

  private bumpLifetime(sessionId: string, rec: SessionLedgerEvent): void {
    const meta = this.readMeta(sessionId);
    if (!meta) return;
    const life = { ...emptyLifetime(), ...(meta.lifetime ?? {}) };
    if (rec.type === "user/message") life.userTurns += 1;
    if (rec.type === "assistant/message") {
      life.assistantTurns += 1;
      const usage = rec.data.usage as Record<string, unknown> | undefined;
      if (usage) {
        if (typeof usage.input === "number") life.inputTokens += usage.input;
        if (typeof usage.prompt_tokens === "number") life.inputTokens += usage.prompt_tokens;
        if (typeof usage.output === "number") life.outputTokens += usage.output;
        if (typeof usage.completion_tokens === "number") life.outputTokens += usage.completion_tokens;
      }
      if (typeof rec.data.durationMs === "number") life.modelMs += rec.data.durationMs;
      if (typeof rec.data.ttftMs === "number" && life.ttftMs === 0) life.ttftMs = rec.data.ttftMs;
    }
    if (rec.type === "tool/call") life.toolCalls += 1;
    if (rec.type === "tool/result" && typeof rec.data.durationMs === "number") {
      life.toolMs += rec.data.durationMs;
    }
    this.patchMeta(sessionId, { lifetime: life });
  }

  private ensureSidecar(sessionId: string): void {
    catchUpOffsetSidecar(this.sessionRoot(sessionId), this.jsonlPath(sessionId));
  }

  private ensureIndexed(sessionId: string): void {
    for (const seg of this.fileSegments(sessionId, { catchUpSearch: true })) {
      void seg;
    }
  }

  private prefixAbsBase(sessionId: string): number {
    let base = 0;
    let cur = sessionId;
    const seen = new Set<string>();
    while (!seen.has(cur)) {
      seen.add(cur);
      const meta = this.readMeta(cur);
      const prefix = meta ? asPrefixRef(meta.prefix_ref) : undefined;
      if (!prefix) break;
      this.ensureSidecar(prefix.sessionId);
      base += offsetRecAtOrBefore(this.sessionRoot(prefix.sessionId), prefix.throughSeq)?.n ?? 0;
      cur = prefix.sessionId;
    }
    return base;
  }

  private fileSegments(sessionId: string, opts?: { catchUpSearch?: boolean }): FileSeg[] {
    const chain: { id: string; maxSeq?: number }[] = [];
    let cur: string | undefined = sessionId;
    let maxSeq: number | undefined;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      chain.unshift({ id: cur, maxSeq });
      const meta = this.readMeta(cur);
      const prefix = meta ? asPrefixRef(meta.prefix_ref) : undefined;
      if (!prefix) break;
      maxSeq = prefix.throughSeq;
      cur = prefix.sessionId;
    }
    let base = 0;
    const segs: FileSeg[] = [];
    for (const seg of chain) {
      this.ensureSidecar(seg.id);
      if (opts?.catchUpSearch) this.searchIndex.catchUp(seg.id, this.jsonlPath(seg.id), base);
      const root = this.sessionRoot(seg.id);
      for (const sealed of listSealedSegments(root)) {
        if (typeof seg.maxSeq === "number" && sealed.fromSeq > seg.maxSeq) continue;
        segs.push({
          sessionId: seg.id,
          root,
          eventsPath: join(root, sealed.file),
          offsetFile: join(root, sealed.idx),
          maxSeq: typeof seg.maxSeq === "number" ? Math.min(seg.maxSeq, sealed.toSeq) : sealed.toSeq,
          absSeqBase: base,
          sealed: { file: sealed.file, idx: sealed.idx },
        });
      }
      segs.push({
        sessionId: seg.id,
        root,
        eventsPath: this.jsonlPath(seg.id),
        maxSeq: seg.maxSeq,
        absSeqBase: base,
      });
      const through = seg.maxSeq ?? Number.MAX_SAFE_INTEGER;
      base += offsetRecAtOrBefore(this.sessionRoot(seg.id), through)?.n ?? 0;
    }
    return segs;
  }

  private olderSegsHaveMessages(segs: FileSeg[], currentIndex: number, cutoff: number): boolean {
    for (let i = currentIndex - 1; i >= 0; i--) {
      const seg = segs[i]!;
      const { recs } = scanMessageOffsetsReverse(seg.root, {
        maxSeq: seg.maxSeq,
        beforeN: cutoff - seg.absSeqBase,
        limit: 1,
        file: seg.offsetFile,
      });
      if (recs.length) return true;
    }
    return false;
  }

  /** 回滚后叶不是文件尾：用 leaf_id 找到 absSeq。fork / 正常追加不走这里。 */
  private rollbackAbsSeq(sessionId: string): number | undefined {
    const leafId = this.readMeta(sessionId)?.leaf_id;
    if (!leafId) return undefined;
    const lastId = this.peekLastMessageId(sessionId);
    if (!lastId || lastId === leafId) return undefined;
    if (this.searchIndex.available) {
      for (const seg of this.fileSegments(sessionId)) {
        const loc = this.searchIndex.locByMessageId(seg.sessionId, leafId);
        if (loc) return loc.absSeq;
      }
    }
    for (const seg of this.fileSegments(sessionId)) {
      const { recs } = scanMessageOffsetsReverse(seg.root, {
        maxSeq: seg.maxSeq,
        limit: 10_000,
        file: seg.offsetFile,
      });
      for (const rec of recs) {
        const line = readLineAt(seg.eventsPath, rec.off);
        const ev = line ? parseLedgerLine(line) : null;
        const id = ev?.messageId ?? (typeof ev?.data.id === "string" ? ev.data.id : undefined);
        if (id === leafId) return seg.absSeqBase + rec.n;
      }
    }
    return undefined;
  }

  private peekLastMessageId(sessionId: string): string | undefined {
    const segs = this.fileSegments(sessionId);
    if (this.searchIndex.available) {
      for (let i = segs.length - 1; i >= 0; i--) {
        const id = this.searchIndex.lastMessageId(segs[i]!.sessionId);
        if (id) return id;
      }
    }
    for (let i = segs.length - 1; i >= 0; i--) {
      const seg = segs[i]!;
      const { recs } = scanMessageOffsetsReverse(seg.root, {
        maxSeq: seg.maxSeq,
        limit: 1,
        file: seg.offsetFile,
      });
      if (!recs[0]) continue;
      const line = readLineAt(seg.eventsPath, recs[0].off);
      const ev = line ? parseLedgerLine(line) : null;
      return ev?.messageId ?? (typeof ev?.data.id === "string" ? ev.data.id : undefined);
    }
    return undefined;
  }

  private collectOverlays(sessionId: string): OverlayState {
    const overlays: OverlayState = {
      pin: new Set<string>(),
      unpin: new Set<string>(),
      labels: new Map<string, string | undefined>(),
    };
    for (const seg of this.fileSegments(sessionId)) {
      const locs = this.searchIndex.available
        ? this.searchIndex.overlayLocs(seg.sessionId).filter(
            (row) => typeof seg.maxSeq !== "number" || row.seq <= seg.maxSeq,
          )
        : readOffsetRecs(seg.root)
            .filter((rec) => isOverlayType(rec.t) && (typeof seg.maxSeq !== "number" || rec.seq <= seg.maxSeq))
            .map((rec) => ({ type: rec.t, messageId: undefined as string | undefined, byteOffset: rec.off }));
      for (const loc of locs) {
        const line = readLineAt(seg.eventsPath, loc.byteOffset);
        const ev = line ? parseLedgerLine(line) : null;
        if (!ev) continue;
        if (typeof seg.maxSeq === "number" && ev.seq > seg.maxSeq) continue;
        const id =
          loc.messageId ??
          ev.messageId ??
          (typeof ev.data.entryId === "string" ? ev.data.entryId : undefined);
        if (!id) continue;
        if (ev.type === "message/pin") overlays.pin.add(id);
        if (ev.type === "message/unpin") overlays.unpin.add(id);
        if (ev.type === "message/label") {
          overlays.labels.set(id, typeof ev.data.label === "string" ? ev.data.label : undefined);
        }
      }
    }
    return overlays;
  }

  private locatedFromOffset(
    seg: FileSeg,
    rec: { off: number; crc?: number },
    absSeq: number,
    overlays: OverlayState,
  ): LocatedMessage | null {
    const line = seg.sealed
      ? readSealedLine(seg.root, { file: seg.sealed.file, idx: seg.sealed.idx, fromSeq: 0, toSeq: 0, messageCount: 0 }, rec.off)
      : readLineAt(seg.eventsPath, rec.off);
    if (!line || !lineCrcMatches(line, rec.crc)) return null;
    const ev = parseLedgerLine(line);
    if (!ev) return null;
    const message = eventToMessage(ev);
    if (!message) return null;
    this.applyOverlay(message, overlays);
    return { absSeq, seq: ev.seq, sourceSessionId: seg.sessionId, message };
  }

  private applyOverlay(message: SessionMessage, overlays: OverlayState): void {
    const id = message.id;
    if (!id) return;
    if (overlays.pin.has(id)) message.pinned = true;
    if (overlays.unpin.has(id)) message.pinned = false;
    if (overlays.labels.has(id)) message.label = overlays.labels.get(id);
  }

  private prefixChainIncludes(sessionId: string, ancestorId: string): boolean {
    const seen = new Set<string>();
    let current = sessionId;
    while (current && !seen.has(current)) {
      seen.add(current);
      const meta = this.readMeta(current);
      const ref = meta?.prefix_ref;
      if (!ref) return false;
      if (ref.sessionId === ancestorId) return true;
      current = ref.sessionId;
    }
    return false;
  }

  private resolvePrefixEvents(ref: SessionPrefixRef, seen: Set<string>): SessionLedgerEvent[] {
    if (seen.has(ref.sessionId)) return [];
    seen.add(ref.sessionId);
    const parentMeta = this.readMeta(ref.sessionId);
    const parentPrefix = parentMeta?.prefix_ref
      ? this.resolvePrefixEvents(parentMeta.prefix_ref, seen)
      : [];
    const own = readLedgerRecords(this.sessionDir, ref.sessionId).filter((ev) => ev.seq <= ref.throughSeq);
    return [...parentPrefix, ...own];
  }

  private readEventChain(sessionId: string): SessionLedgerEvent[] {
    const meta = this.readMeta(sessionId);
    if (!meta) return [];
    const prefix = meta.prefix_ref
      ? this.resolvePrefixEvents(meta.prefix_ref, new Set([sessionId]))
      : [];
    return [...prefix, ...readLedgerRecords(this.sessionDir, sessionId)];
  }

  private collectLocatedMessages(sessionId: string): LocatedMessage[] {
    const overlays = { pin: new Set<string>(), unpin: new Set<string>(), labels: new Map<string, string | undefined>() };
    const rows: LocatedMessage[] = [];
    let absSeq = 0;
    for (const ev of this.readEventChain(sessionId)) {
      if (ev.type === "message/pin" && typeof ev.data.entryId === "string") overlays.pin.add(ev.data.entryId);
      if (ev.type === "message/unpin" && typeof ev.data.entryId === "string") overlays.unpin.add(ev.data.entryId);
      if (ev.type === "message/label" && typeof ev.data.entryId === "string") {
        overlays.labels.set(ev.data.entryId, typeof ev.data.label === "string" ? ev.data.label : undefined);
      }
      if (!isMessageEventType(ev.type)) continue;
      if (ev.type === "tool/call" && !ev.data.role && !ev.data.content) continue;
      const message = eventToMessage(ev);
      if (!message) continue;
      absSeq += 1;
      rows.push({ absSeq, seq: ev.seq, sourceSessionId: ev.sessionId, message });
    }
    for (const row of rows) {
      const id = row.message.id;
      if (!id) continue;
      if (overlays.pin.has(id)) row.message.pinned = true;
      if (overlays.unpin.has(id)) row.message.pinned = false;
      if (overlays.labels.has(id)) row.message.label = overlays.labels.get(id);
    }
    return rows;
  }

  private sessionFromMeta(
    meta: SessionMeta,
    messages: SessionMessage[],
    trace: SessionTrace[],
  ): SessionData {
    return {
      id: meta.id,
      title: meta.title || "新对话",
      agentName: meta.agent_name || "main",
      messages,
      trace,
      createdAt: meta.created_at || "",
      updatedAt: meta.updated_at || "",
      lastPrompt: typeof meta.last_prompt === "string" ? meta.last_prompt : "",
      lastRawResponse: typeof meta.last_raw_response === "string" ? meta.last_raw_response : "",
      parentSessionId: meta.parent_session_id,
      leafId: typeof meta.leaf_id === "string" ? meta.leaf_id : undefined,
      raw_data: { rounds: [] },
    };
  }

  private rotateRawLogIfNeeded(filePath: string): void {
    try {
      if (!existsSync(filePath)) return;
      const stat = statSync(filePath);
      if (stat.size / (1024 * 1024) < 20) return;
      const rotated = `${filePath}.${new Date().toISOString().replace(/[:.]/g, "-")}.bak`;
      renameSync(filePath, rotated);
      writeFileSync(filePath, "", "utf-8");
      this.cleanupOldBakFiles(filePath, 5);
    } catch {
      /* 轮转失败不挡主流程 */
    }
  }

  private cleanupOldBakFiles(baseFilePath: string, keepCount: number): void {
    try {
      const dir = dirname(baseFilePath);
      const baseName = basename(baseFilePath);
      const bakPattern = new RegExp(`^${escapeRegExp(baseName)}\\..+\\.bak$`);
      const bakFiles = readdirSync(dir)
        .filter((f) => bakPattern.test(f))
        .map((f) => ({ path: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      for (const old of bakFiles.slice(keepCount)) {
        try {
          unlinkSync(old.path);
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  }
}

interface FileSeg {
  sessionId: string;
  root: string;
  eventsPath: string;
  offsetFile?: string;
  maxSeq?: number;
  absSeqBase: number;
  sealed?: { file: string; idx: string };
}

interface OverlayState {
  pin: Set<string>;
  unpin: Set<string>;
  labels: Map<string, string | undefined>;
}

interface LocatedMessage {
  absSeq: number;
  seq: number;
  sourceSessionId: string;
  message: SessionMessage;
}

function eventToMessage(ev: SessionLedgerEvent): SessionMessage | null {
  const data = ev.data ?? {};
  const role = typeof data.role === "string" ? data.role : inferRole(ev.type);
  if (role == null && data.content == null) return null;
  const createdAt =
    typeof data.createdAt === "string"
      ? data.createdAt
      : typeof data.created_at === "string"
        ? data.created_at
        : ev.ts;
  const id = ev.messageId ?? (typeof data.id === "string" ? data.id : undefined);
  const msg: SessionMessage = {
    ...(data as SessionMessage),
    role: role ?? "user",
    content: typeof data.content === "string" ? data.content : "",
    createdAt,
    seq: ev.seq,
  };
  if (id) msg.id = id;
  return msg;
}

function inferRole(type: string): string | null {
  if (type.startsWith("user/") || type === "system/notice" || type === "runtime/control" || type === "agent/message") {
    return type === "system/notice" || type === "runtime/control" ? "system" : "user";
  }
  if (type === "assistant/message" || type === "tool/call") return "assistant";
  if (type.startsWith("tool/")) return "tool";
  if (type === "session/custom") return "system";
  return null;
}
