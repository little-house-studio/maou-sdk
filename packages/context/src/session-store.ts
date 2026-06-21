/**
 * 会话存储 —— 基于 JSONL 的会话持久化。
 * 对应 Python: core/agent/prompt/session/session_store.py
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  readdirSync,
  statSync,
  appendFileSync,
  renameSync,
} from "node:fs";
import { join, basename, dirname } from "node:path";
import type { HarnessMessage } from "./types/message.js";
import {
  harnessToSessionMessage,
  sessionToHarnessMessage,
} from "./types/message.js";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── 类型 ──────────────────────────────────────────────────────────────────

export interface SessionMeta {
  id: string;
  title: string;
  agent_name: string;
  created_at: string;
  updated_at: string;
  last_prompt: string;
  last_raw_response: string;
  parent_session_id?: string;
  [key: string]: unknown;
}

export interface SessionData {
  id: string;
  title: string;
  agentName: string;
  messages: SessionMessage[];
  /** Harness 层结构化消息（可选，与 messages 互斥或共存） */
  harnessMessages?: HarnessMessage[];
  trace: SessionTrace[];
  createdAt: string;
  updatedAt: string;
  lastPrompt: string;
  lastRawResponse: string;
  parentSessionId?: string;
  raw_data: { rounds: unknown[] };
}

/** 会话消息 - 存储层格式（向后兼容） */
export interface SessionMessage {
  role: string;
  content: string;
  created_at: string;
  /** 优先级 */
  priority?: string;
  /** 是否固定 */
  pinned?: boolean;
  /** 来源 */
  source?: string;
  /** 工具调用 ID */
  tool_call_id?: string;
  /** 原生工具调用（适配 OpenAI 格式） */
  native_tool_calls?: Array<{
    id: string;
    type: string;
    name: string;
    parameters: Record<string, unknown>;
  }>;
  /** 工具名称 */
  tool_name?: string;
  /** 图片数据 */
  images?: Array<{ mimeType: string; data: string }>;
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
}

// ─── 工具函数 ──────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

function atomicWriteJson(filePath: string, data: unknown): void {
  const dir = join(filePath, "..");
  mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  // Node.js rename 在同一文件系统上是原子操作
  renameSync(tmp, filePath);
}

function tryReadJson(filePath: string): unknown {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

// ─── SessionStore ─────────────────────────────────────────────────────────

export class SessionStore {
  readonly sessionDir: string;
  private agentNameCache = new Map<string, string>();

  constructor(sessionDir: string) {
    this.sessionDir = sessionDir;
    mkdirSync(sessionDir, { recursive: true });
  }

  // ── 路径计算 ──

  jsonlPath(sessionId: string): string {
    return join(this.sessionDir, `${sessionId}.jsonl`);
  }

  metaPath(sessionId: string): string {
    return join(this.sessionDir, `${sessionId}.meta.json`);
  }

  private legacyPath(sessionId: string): string {
    return join(this.sessionDir, `${sessionId}.json`);
  }

  private rawPath(sessionId: string): string {
    const agentName = this.getAgentName(sessionId);
    const rawDir = join(this.sessionDir, "..", "agents", agentName, "raw");
    mkdirSync(rawDir, { recursive: true });
    return join(rawDir, `${sessionId}.raw.jsonl`);
  }

  private rawDirForSession(sessionId: string): string {
    const agentName = this.getAgentName(sessionId);
    const rawDir = join(this.sessionDir, "..", "agents", agentName, "raw");
    mkdirSync(rawDir, { recursive: true });
    return rawDir;
  }

  private getAgentName(sessionId: string): string {
    const cached = this.agentNameCache.get(sessionId);
    if (cached !== undefined) return cached;
    try {
      const meta = tryReadJson(this.metaPath(sessionId)) as SessionMeta | null;
      const name = (meta?.agent_name as string) || "main";
      this.agentNameCache.set(sessionId, name);
      return name;
    } catch {
      return "main";
    }
  }

  // ── 核心操作 ──

  /**
   * 创建新会话（支持对象或位置参数）
   */
  create(titleOrOpts?: string | { title?: string; agentName?: string; sessionId?: string }, agentName?: string, sessionId?: string): SessionData {
    let title: string | undefined;
    if (typeof titleOrOpts === 'object' && titleOrOpts !== null) {
      title = titleOrOpts.title;
      agentName = titleOrOpts.agentName;
      sessionId = titleOrOpts.sessionId;
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
    const meta: SessionMeta = {
      id: sessionId,
      title: title ?? "新对话",
      agent_name: agentName ?? "main",
      created_at: ts,
      updated_at: ts,
      last_prompt: "",
      last_raw_response: "",
    };
    atomicWriteJson(this.metaPath(sessionId), meta);
    writeFileSync(this.jsonlPath(sessionId), "", "utf-8");
    return this.reconstructSession(meta, [], []);
  }

  /**
   * 确保会话存在（不存在则创建）
   */
  ensure(sessionId?: string | null): SessionData {
    if (sessionId) {
      const existing = this.load(sessionId);
      if (existing) return existing;
      // 不存在则用此 ID 创建
      return this.create({ sessionId });
    }
    return this.create();
  }

  /**
   * 加载会话
   */
  load(sessionId: string): SessionData | null {
    const jsonl = this.jsonlPath(sessionId);
    const metaFile = this.metaPath(sessionId);
    if (existsSync(jsonl) && existsSync(metaFile)) {
      return this.loadJsonl(sessionId);
    }
    const legacy = this.legacyPath(sessionId);
    if (existsSync(legacy)) {
      return this.loadLegacyJson(legacy);
    }
    return null;
  }

  /**
   * 列出所有会话摘要
   */
  list(): SessionListItem[] {
    const sessions: SessionListItem[] = [];
    const seen = new Set<string>();

    // JSONL 格式（新）
    const metaFiles = readdirSync(this.sessionDir)
      .filter((f) => f.endsWith(".meta.json"))
      .sort();

    for (const file of metaFiles) {
      const meta = tryReadJson(join(this.sessionDir, file)) as SessionMeta | null;
      if (!meta?.id) continue;
      const sessionId = meta.id;
      seen.add(sessionId);

      let messageCount = 0;
      let lastMsgTime = meta.created_at || "";
      const jsonl = this.jsonlPath(sessionId);
      if (existsSync(jsonl)) {
        const lines = readFileSync(jsonl, "utf-8").split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (event.type === "message") {
              messageCount++;
              if (event.role === "user") {
                lastMsgTime = event.created_at || lastMsgTime;
              }
            }
          } catch {
            continue;
          }
        }
      }
      if (!lastMsgTime || lastMsgTime === meta.created_at) {
        lastMsgTime = meta.updated_at || meta.created_at || "";
      }

      sessions.push({
        id: sessionId,
        title: meta.title ?? "新对话",
        updatedAt: meta.updated_at,
        messageCount,
        lastMsgAt: lastMsgTime,
      });
    }

    // Legacy JSON 格式（旧）
    const jsonFiles = readdirSync(this.sessionDir)
      .filter((f) => f.endsWith(".json") && !f.endsWith(".meta.json"))
      .sort();

    for (const file of jsonFiles) {
      const data = tryReadJson(join(this.sessionDir, file)) as Record<
        string,
        unknown
      > | null;
      if (!data?.id) continue;
      const sessionId = data.id as string;
      if (seen.has(sessionId)) continue;
      seen.add(sessionId);

      const msgs = (data.messages as SessionMessage[]) ?? [];
      let lastMsgTime = "";
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === "user") {
          lastMsgTime = msgs[i].created_at ?? "";
          break;
        }
      }
      if (!lastMsgTime) {
        lastMsgTime =
          msgs.length > 0
            ? msgs[msgs.length - 1].created_at ?? ""
            : (data.created_at as string) ?? "";
      }

      sessions.push({
        id: sessionId,
        title: (data.title as string) ?? "新对话",
        updatedAt: data.updated_at as string | undefined,
        messageCount: msgs.length,
        lastMsgAt: lastMsgTime,
      });
    }

    sessions.sort((a, b) => (b.lastMsgAt || "").localeCompare(a.lastMsgAt || ""));
    return sessions;
  }

  /**
   * 保存完整会话
   */
  save(session: SessionData): void {
    const sessionId = session.id;
    const meta: SessionMeta = {
      id: session.id,
      title: session.title,
      agent_name: session.agentName,
      created_at: session.createdAt,
      updated_at: nowIso(),
      last_prompt: session.lastPrompt,
      last_raw_response: session.lastRawResponse,
    };
    atomicWriteJson(this.metaPath(sessionId), meta);

    const lines: string[] = [];
    for (const msg of session.messages) {
      lines.push(JSON.stringify({ type: "message", ...msg }));
    }
    for (const t of session.trace) {
      lines.push(JSON.stringify({ type: "trace", data: t, created_at: nowIso() }));
    }
    writeFileSync(this.jsonlPath(sessionId), lines.join("\n") + "\n", "utf-8");
  }

  /**
   * Fork 会话：复制源会话的消息和元数据，创建新会话。
   * 新会话有独立的 ID，但包含源会话的完整消息历史。
   */
  forkSession(sourceSessionId: string, newTitle?: string): SessionData {
    const source = this.load(sourceSessionId);
    if (!source) {
      throw new Error(`源会话不存在: ${sourceSessionId}`);
    }

    const newSession = this.create({
      title: newTitle ?? `${source.title} (副本)`,
      agentName: source.agentName,
    });

    // 复制消息
    for (const msg of source.messages) {
      this.appendLine(newSession.id, {
        type: "message",
        ...msg,
      });
    }

    // 复制 trace
    for (const t of source.trace) {
      this.appendLine(newSession.id, {
        type: "trace",
        data: t,
        created_at: nowIso(),
      });
    }

    // 更新元数据：标题 + parent_session_id
    const meta = tryReadJson(this.metaPath(newSession.id)) as Record<string, unknown> | null;
    if (meta) {
      meta.title = newTitle ?? `${source.title} (副本)`;
      meta.parent_session_id = sourceSessionId;
      meta.updated_at = nowIso();
      atomicWriteJson(this.metaPath(newSession.id), meta);
    }

    return this.load(newSession.id) ?? newSession;
  }

  /**
   * 清空会话：删除所有消息，但保留元数据（标题、agent 等）。
   */
  clearSession(sessionId: string): SessionData {
    const meta = tryReadJson(this.metaPath(sessionId)) as SessionMeta | null;
    if (!meta) {
      throw new Error(`会话不存在: ${sessionId}`);
    }

    // 清空 JSONL 文件
    writeFileSync(this.jsonlPath(sessionId), "", "utf-8");

    // 更新元数据
    meta.updated_at = nowIso();
    atomicWriteJson(this.metaPath(sessionId), meta);

    return this.reconstructSession(meta, [], []);
  }

  /**
   * 删除会话
   */
  delete(sessionId: string): boolean {
    let deleted = false;
    for (const path of [
      this.jsonlPath(sessionId),
      this.metaPath(sessionId),
      this.legacyPath(sessionId),
      this.rawPath(sessionId),
    ]) {
      if (existsSync(path)) {
        unlinkSync(path);
        deleted = true;
      }
    }
    return deleted;
  }

  /**
   * 向会话追加消息
   */
  appendMessage(
    sessionId: string,
    role: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): SessionData {
    const jsonl = this.jsonlPath(sessionId);
    const metaFile = this.metaPath(sessionId);

    if (!existsSync(jsonl) || !existsSync(metaFile)) {
      const legacy = this.legacyPath(sessionId);
      if (existsSync(legacy)) {
        this.migrateLegacy(sessionId);
      } else {
        const session = this.create();
        sessionId = session.id;
      }
    }

    const item: Record<string, unknown> = {
      type: "message",
      role,
      content,
      created_at: nowIso(),
      priority: role === "system" ? "critical" : "normal",
      ...metadata,
    };
    this.appendLine(sessionId, item);

    if (role === "user") {
      this.maybeUpdateTitle(sessionId, content);
    }

    return this.load(sessionId) ?? this.create();
  }

  /**
   * 追加 trace 记录
   */
  appendTrace(sessionId: string, item: Record<string, unknown>): void {
    const jsonl = this.jsonlPath(sessionId);
    if (!existsSync(jsonl)) {
      const legacy = this.legacyPath(sessionId);
      if (existsSync(legacy)) {
        this.migrateLegacy(sessionId);
      } else {
        const session = this.create();
        sessionId = session.id;
      }
    }
    this.appendLine(sessionId, {
      type: "trace",
      data: item,
      created_at: nowIso(),
    });
  }

  /**
   * 设置最后的 prompt（用于调试）
   */
  setLastPrompt(sessionId: string, prompt: string): void {
    const metaFile = this.metaPath(sessionId);
    if (!existsSync(metaFile)) return;
    const meta = tryReadJson(metaFile) as Record<string, unknown> | null;
    if (!meta) return;
    meta.last_prompt = prompt;
    meta.updated_at = nowIso();
    atomicWriteJson(metaFile, meta);
  }

  /**
   * 设置最后的原始响应
   */
  setLastRawResponse(sessionId: string, rawResponse: string): void {
    const metaFile = this.metaPath(sessionId);
    if (!existsSync(metaFile)) return;
    const meta = tryReadJson(metaFile) as Record<string, unknown> | null;
    if (!meta) return;
    meta.last_raw_response = rawResponse;
    meta.updated_at = nowIso();
    atomicWriteJson(metaFile, meta);
  }

  // ── Raw 数据存储 ──

  /** Raw 条目数上限：超过则批量删最旧的（保留 400 条） */
  static readonly RAW_MAX_ENTRIES = 500;
  /** 触发清理后保留的条目数 */
  static readonly RAW_KEEP_AFTER_PURGE = 400;

  /**
   * 追加原始数据条目（通用入口，不绑死任何 schema）
   * 超过 RAW_MAX_ENTRIES（默认 500）时，批量删最旧的，保留 RAW_KEEP_AFTER_PURGE（默认 400）。
   */
  appendRawEntry(sessionId: string, entry: Record<string, unknown>): void {
    const filePath = this.rawPath(sessionId);
    this.rotateRawLogIfNeeded(filePath);
    appendFileSync(filePath, JSON.stringify(entry) + "\n", "utf-8");
    this.enforceRawEntryLimit(filePath);
  }

  /**
   * 限制 raw.jsonl 条目数。超过 RAW_MAX_ENTRIES 时，保留最近 RAW_KEEP_AFTER_PURGE 条。
   * 用批量删（500→400）而非逐条删，减少 I/O 写放大。
   */
  private enforceRawEntryLimit(filePath: string): void {
    try {
      if (!existsSync(filePath)) return;
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim().length > 0);
      if (lines.length <= SessionStore.RAW_MAX_ENTRIES) return;

      // 保留最近 N 条（按行序，旧→新）
      const kept = lines.slice(lines.length - SessionStore.RAW_KEEP_AFTER_PURGE);
      writeFileSync(filePath, kept.join("\n") + "\n", "utf-8");
    } catch {
      // 限制失败不应阻塞主流程
    }
  }

  loadPostLogs(
    sessionId: string,
    filters?: { round?: number; since?: string; until?: string },
  ): Record<string, unknown>[] {
    const filePath = this.rawPath(sessionId);
    if (!existsSync(filePath)) return [];

    const results: Record<string, unknown>[] = [];
    const lines = readFileSync(filePath, "utf-8").split("\n");

    for (const line of lines) {
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
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        if (entry.event === "llm.post") return entry;
      } catch {
        continue;
      }
    }

    return null;
  }

  /**
   * 清理无法识别的旧格式条目。
   *
   * 语义：保留所有结构化记录（带 `event` 或 `type` 字段的行），
   * 仅删除无法解析为 JSON、或既无 `event` 也无 `type` 的孤儿行。
   * 这样 llm.post / llm_request / llm_response / tool_call / tool_result
   * 等多种 schema 可安全共存，未来新增 schema 也不会被误删。
   */
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
        // 保留带 event 字段（如 llm.post）或 type 字段（如 llm_request/llm_response/tool_call/tool_result/llm_call）的记录
        if ("event" in entry || "type" in entry) {
          kept.push(JSON.stringify(entry));
        } else {
          purged++;
        }
      } catch {
        // 无法解析为 JSON 的脏数据
        purged++;
      }
    }

    if (purged === 0) return { purged: 0 };

    writeFileSync(filePath, kept.join("\n") + (kept.length ? "\n" : ""), "utf-8");
    return { purged };
  }

  /**
   * 按 round 加载原始数据
   */
  loadRawByRound(sessionId: string, round: number): Record<string, unknown>[] {
    const path = this.rawPath(sessionId);
    if (!existsSync(path)) return [];
    const results: Record<string, unknown>[] = [];
    const lines = readFileSync(path, "utf-8").split("\n");
    for (const line of lines) {
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

  /**
   * 加载全部原始数据条目。
   *
   * 注意：本方法返回**磁盘上的原始条目**，不解码压缩字段。
   * 压缩字段（body_compressed / payload_compressed）的透明解码由调用方负责，
   * 用 `core/llm/raw-codec.js` 的 transparentDecodeField / decodeRawBody。
   * 这样 context 层保持 schema-agnostic，不依赖 llm 层。
   */
  getRawData(sessionId: string): Record<string, unknown>[] {
    const path = this.rawPath(sessionId);
    if (!existsSync(path)) return [];
    const results: Record<string, unknown>[] = [];
    const lines = readFileSync(path, "utf-8").split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        results.push(JSON.parse(line));
      } catch {
        continue;
      }
    }
    return results;
  }

  /**
   * 获取会话 trace 列表
   */
  getTrace(sessionId: string): SessionTrace[] {
    const session = this.load(sessionId);
    return session?.trace ?? [];
  }

  /**
   * 注入 hook 消息到会话
   */
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

  // ── 内部方法 ──

  private rotateRawLogIfNeeded(filePath: string): void {
    try {
      if (!existsSync(filePath)) return;

      const stat = statSync(filePath);
      const sizeMb = stat.size / (1024 * 1024);

      if (sizeMb < 20) return;

      const rotated = `${filePath}.${new Date().toISOString().replace(/[:.]/g, "-")}.bak`;
      renameSync(filePath, rotated);
      writeFileSync(filePath, "", "utf-8");

      this.cleanupOldBakFiles(filePath, 5);
    } catch {
      // 轮转失败不应阻塞主流程
    }
  }

  private cleanupOldBakFiles(baseFilePath: string, keepCount: number): void {
    try {
      const dir = dirname(baseFilePath);
      const baseName = basename(baseFilePath);
      const bakPattern = new RegExp(`^${escapeRegExp(baseName)}\\..+\\.bak$`);

      const bakFiles = readdirSync(dir)
        .filter((f) => bakPattern.test(f))
        .map((f) => ({ name: f, path: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);

      for (const old of bakFiles.slice(keepCount)) {
        try { unlinkSync(old.path); } catch { /* ignore */ }
      }
    } catch {
      // 清理失败不应阻塞主流程
    }
  }

  private loadJsonl(sessionId: string): SessionData {
    const metaFile = this.metaPath(sessionId);
    const meta = JSON.parse(readFileSync(metaFile, "utf-8")) as SessionMeta;
    const messages: SessionMessage[] = [];
    const trace: SessionTrace[] = [];

    const jsonl = this.jsonlPath(sessionId);
    const lines = readFileSync(jsonl, "utf-8").split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (event.type === "message") {
          const { type: _, ...msg } = event;
          messages.push(msg);
        } else if (event.type === "trace") {
          trace.push(event.data ?? {});
        } else if (event.type === "meta_update") {
          const field = event.field;
          const value = event.value;
          if (field) (meta as Record<string, unknown>)[field] = value;
        }
      } catch {
        continue;
      }
    }

    return this.reconstructSession(meta, messages, trace);
  }

  private loadLegacyJson(filePath: string): SessionData {
    const session = JSON.parse(readFileSync(filePath, "utf-8"));
    const messages: SessionMessage[] = session.messages ?? [];
    const meta: SessionMeta = {
      id: session.id ?? "",
      title: session.title ?? "新对话",
      agent_name: session.agent_name ?? "main",
      created_at: session.created_at ?? "",
      updated_at: session.updated_at ?? "",
      last_prompt: session.last_prompt ?? "",
      last_raw_response: session.last_raw_response ?? "",
    };
    return this.reconstructSession(meta, messages, session.trace ?? []);
  }

  private reconstructSession(
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
      lastPrompt: meta.last_prompt || "",
      lastRawResponse: meta.last_raw_response || "",
      parentSessionId: meta.parent_session_id,
      raw_data: { rounds: [] },
    };
  }

  private appendLine(sessionId: string, item: Record<string, unknown>): void {
    appendFileSync(
      this.jsonlPath(sessionId),
      JSON.stringify(item) + "\n",
      "utf-8",
    );
  }

  private migrateLegacy(sessionId: string): void {
    const legacy = this.legacyPath(sessionId);
    if (!existsSync(legacy)) return;
    const session = JSON.parse(readFileSync(legacy, "utf-8"));
    const messages: SessionMessage[] = session.messages ?? [];
    const meta: SessionMeta = {
      id: session.id ?? sessionId,
      title: session.title ?? "新对话",
      agent_name: session.agent_name ?? "main",
      created_at: session.created_at ?? "",
      updated_at: session.updated_at ?? nowIso(),
      last_prompt: session.last_prompt ?? "",
      last_raw_response: session.last_raw_response ?? "",
    };
    atomicWriteJson(this.metaPath(sessionId), meta);
    const lines: string[] = [];
    for (const msg of messages) {
      lines.push(JSON.stringify({ type: "message", ...msg }));
    }
    writeFileSync(this.jsonlPath(sessionId), lines.join("\n") + "\n", "utf-8");
  }

  private maybeUpdateTitle(sessionId: string, content: string): void {
    const metaFile = this.metaPath(sessionId);
    if (!existsSync(metaFile)) return;
    const meta = tryReadJson(metaFile) as Record<string, unknown> | null;
    if (!meta || meta.title !== "新对话") return;
    const title = content.length > 30 ? content.slice(0, 30) + "..." : content;
    meta.title = title;
    meta.updated_at = nowIso();
    atomicWriteJson(metaFile, meta);
  }

  // ─── 优先级操作 ────────────────────────────────────────────────────────────

  /**
   * Pin 一条消息（压缩时永不丢弃）
   */
  pinMessage(sessionId: string, messageIndex: number): boolean {
    return this._updateMessageField(sessionId, messageIndex, { pinned: true });
  }

  /**
   * Unpin 一条消息
   */
  unpinMessage(sessionId: string, messageIndex: number): boolean {
    return this._updateMessageField(sessionId, messageIndex, { pinned: false });
  }

  /**
   * 设置消息优先级
   */
  setPriority(sessionId: string, messageIndex: number, priority: string): boolean {
    return this._updateMessageField(sessionId, messageIndex, { priority });
  }

  // ─── HarnessMessage 支持 ───────────────────────────────────────────────────

  /**
   * 加载会话的 HarnessMessage 格式消息
   * 自动从 SessionMessage 转换，支持 seq_id 追踪
   */
  loadHarnessMessages(sessionId: string): HarnessMessage[] {
    const session = this.load(sessionId);
    if (!session) return [];

    // 如果会话已有 harnessMessages，直接返回
    if (session.harnessMessages && session.harnessMessages.length > 0) {
      return session.harnessMessages;
    }

    // 否则从 messages 转换
    return session.messages.map((m, idx) => sessionToHarnessMessage(m, idx));
  }

  /**
   * 以 HarnessMessage 格式追加消息
   * 自动转换为 SessionMessage 存储，同时保留 Harness 层元数据
   */
  appendHarnessMessage(
    sessionId: string,
    hmsg: HarnessMessage,
    metadata?: Record<string, unknown>,
  ): SessionData {
    // 将 HarnessMessage 转换为 SessionMessage 进行存储
    const sessionMsg = harnessToSessionMessage(hmsg);

    // 合并额外 metadata
    if (metadata) {
      Object.assign(sessionMsg, metadata);
    }

    // 使用现有 appendMessage 逻辑存储
    const jsonl = this.jsonlPath(sessionId);
    const metaFile = this.metaPath(sessionId);

    if (!existsSync(jsonl) || !existsSync(metaFile)) {
      const legacy = this.legacyPath(sessionId);
      if (existsSync(legacy)) {
        this.migrateLegacy(sessionId);
      } else {
        const session = this.create();
        sessionId = session.id;
      }
    }

    this.appendLine(sessionId, { type: "message", ...sessionMsg });

    if (hmsg.category === "user") {
      this.maybeUpdateTitle(sessionId, hmsg.content.text_content);
    }

    return this.load(sessionId) ?? this.create();
  }

  /**
   * 保存 HarnessMessage 数组到会话
   * 将 Harness 层消息持久化为 SessionMessage 格式
   */
  saveHarnessMessages(sessionId: string, hmsgs: HarnessMessage[]): void {
    const session = this.load(sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }

    // 清空现有 JSONL
    writeFileSync(this.jsonlPath(sessionId), "", "utf-8");

    // 将 HarnessMessage 转换为 SessionMessage 写入
    for (const hmsg of hmsgs) {
      const sessionMsg = harnessToSessionMessage(hmsg);
      this.appendLine(sessionId, { type: "message", ...sessionMsg });
    }

    // 更新 meta
    const meta = tryReadJson(this.metaPath(sessionId)) as Record<string, unknown> | null;
    if (meta) {
      meta.updated_at = nowIso();
      atomicWriteJson(this.metaPath(sessionId), meta);
    }
  }

  /**
   * 获取下一个可用的 seq_id
   */
  nextSeqId(sessionId: string): number {
    const hmsgs = this.loadHarnessMessages(sessionId);
    if (hmsgs.length === 0) return 0;
    return Math.max(...hmsgs.map(m => m.seq_id)) + 1;
  }

  // ─── 内部方法 ──────────────────────────────────────────────────────────────

  private _updateMessageField(
    sessionId: string,
    messageIndex: number,
    fields: Record<string, unknown>,
  ): boolean {
    const session = this.load(sessionId);
    if (!session || messageIndex < 0 || messageIndex >= session.messages.length) {
      return false;
    }

    // 更新目标消息
    Object.assign(session.messages[messageIndex], fields);

    // 重写 JSONL
    const lines: string[] = [];
    for (const msg of session.messages) {
      lines.push(JSON.stringify({ type: "message", ...msg }));
    }
    // 保留 trace
    for (const t of session.trace) {
      lines.push(JSON.stringify({ type: "trace", data: t, created_at: nowIso() }));
    }
    writeFileSync(this.jsonlPath(sessionId), lines.join("\n") + "\n", "utf-8");

    // 更新 meta 的 updated_at
    const meta = tryReadJson(this.metaPath(sessionId)) as Record<string, unknown> | null;
    if (meta) {
      meta.updated_at = nowIso();
      atomicWriteJson(this.metaPath(sessionId), meta);
    }

    return true;
  }
}
