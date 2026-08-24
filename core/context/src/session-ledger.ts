/**
 * 会话事件源账本（Session Ledger）
 *
 * 事件词表可扩展 + 只追加；未知 type 拒写。
 * sidecar `<id>.ledger.jsonl`，
 * 不塞进主 jsonl（SessionStore.save() 会丢掉非 message/trace）。
 *
 * 新功能只需：
 *   registerLedgerEvent({ type: "域/动作", surface, description?, describe? })
 *   appendLedgerEvent(sessionDir, sessionId, type, data)
 * sidecar 落在 \`<sessionDir>/<id>.ledger.jsonl\`，用阅读工具即可查看。
 *
 * 自动接入（不必每个功能手写）：
 *   - SessionStore.appendMessage / appendTrace 镜像
 *   - ToolExecutor 每条执行记 tool/exec（surface=log）
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  SessionLedgerAppendOpts,
  SessionLedgerCatalogEntry,
  SessionLedgerEvent,
  SessionLedgerPort,
  SessionLedgerQuery,
  SessionLedgerSurface,
} from "@little-house-studio/types";
import {
  resolveSessionEventKind,
  type SessionEventKind,
} from "./session-event.js";

export const LEDGER_FILE_SUFFIX = ".ledger.jsonl";

export interface LedgerEventSpec {
  type: string;
  surface: SessionLedgerSurface;
  description?: string;
  /** 未识别读入时不炸；写仍须登记 */
  ignorable?: boolean;
  describe?: (data: Record<string, unknown>) => string;
}

const TYPE_RE = /^[a-z][a-z0-9_]*\/[a-z][a-z0-9_]*$/;
const catalog = new Map<string, LedgerEventSpec>();
const coreTypes = new Set<string>();
let coreInstalled = false;

export function ledgerPath(sessionDir: string, sessionId: string): string {
  return join(sessionDir, `${sessionId}${LEDGER_FILE_SUFFIX}`);
}

export function isLedgerEventType(type: string): boolean {
  return TYPE_RE.test(type);
}

export function registerLedgerEvent(spec: LedgerEventSpec): void {
  if (!isLedgerEventType(spec.type)) {
    throw new Error(`ledger event type 必须是 'domain/action'，收到: ${spec.type}`);
  }
  catalog.set(spec.type, { ...spec });
}

export function getLedgerEventSpec(type: string): LedgerEventSpec | undefined {
  installCoreLedgerCatalog();
  return catalog.get(type);
}

export function listLedgerCatalog(): SessionLedgerCatalogEntry[] {
  installCoreLedgerCatalog();
  return [...catalog.values()]
    .map((s) => ({
      type: s.type,
      surface: s.surface,
      description: s.description,
      ignorable: s.ignorable,
    }))
    .sort((a, b) => a.type.localeCompare(b.type));
}

/** 测试用：清掉非核心登记，避免用例互相污染 */
export function resetExtraLedgerCatalogForTests(): void {
  installCoreLedgerCatalog();
  for (const key of [...catalog.keys()]) {
    if (!coreTypes.has(key)) catalog.delete(key);
  }
}

function previewText(value: unknown, max = 2000): string {
  const text = typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…(+${text.length - max})`;
}

function defaultDescribe(type: string, data: Record<string, unknown>): string {
  const hint =
    (typeof data.name === "string" && data.name) ||
    (typeof data.stage === "string" && data.stage) ||
    (typeof data.title === "string" && data.title) ||
    "";
  const body = previewText(data.content ?? data.message ?? data.preview ?? data, 180);
  return hint ? `${type} ${hint} ${body}` : `${type} ${body}`;
}

function describeEvent(spec: LedgerEventSpec | undefined, type: string, data: Record<string, unknown>): string {
  try {
    if (spec?.describe) return spec.describe(data);
  } catch {
    /* describe 失败回退默认 */
  }
  return defaultDescribe(type, data);
}

export const KIND_TO_LEDGER_TYPE: Record<SessionEventKind, string> = {
  human_user: "user/message",
  queued_user: "user/queued",
  assistant_turn: "assistant/message",
  tool_call: "tool/call",
  tool_result: "tool/result",
  tool_async_notify: "tool/async",
  system_notice: "system/notice",
  runtime_control: "runtime/control",
  agent_message: "agent/message",
  compact: "compact/end",
  unknown: "session/unknown",
};

const CORE_SPECS: LedgerEventSpec[] = [
  { type: "session/created", surface: "log", description: "会话创建" },
  { type: "session/unknown", surface: "log", description: "未能归类的会话写入", ignorable: true },
  { type: "session/trace", surface: "log", description: "松散 trace", ignorable: true },
  { type: "session/custom", surface: "ui", description: "自定义 UI 条目" },
  { type: "user/message", surface: "model", description: "用户消息" },
  { type: "user/queued", surface: "model", description: "排队用户消息" },
  { type: "assistant/message", surface: "model", description: "助手回合" },
  { type: "tool/call", surface: "model", description: "工具调用（模型发出）" },
  { type: "tool/result", surface: "model", description: "工具结果（已落会话）" },
  { type: "tool/async", surface: "model", description: "工具异步通知" },
  {
    type: "tool/exec",
    surface: "log",
    description: "工具实际执行（ToolExecutor 自动记，新工具无需手写）",
    describe: (d) => `tool/exec ${d.name ?? "?"} ok=${d.ok} ${d.durationMs ?? "?"}ms`,
  },
  { type: "system/notice", surface: "model", description: "系统通知" },
  { type: "runtime/control", surface: "model", description: "运行时控制" },
  { type: "agent/message", surface: "model", description: "Agent 间消息" },
  { type: "compact/start", surface: "model", description: "压缩开始" },
  { type: "compact/end", surface: "model", description: "压缩结束" },
  { type: "hook/invoked", surface: "log", description: "钩子触发" },
  { type: "todo/write", surface: "model", description: "todo 清单变更" },
  {
    type: "goal/change",
    surface: "model",
    description: "/goal 生命周期（完整 snapshot 或 clear tombstone）",
    describe: (d) => `goal/change ${d.operation ?? "?"} ${typeof d.goal === "object" && d.goal && "id" in (d.goal as object) ? (d.goal as { id?: string }).id ?? "" : ""}`,
  },
  {
    type: "harness/change",
    surface: "model",
    description: "宿主编排 goal 的状态迁移",
    describe: (d) => `harness/change ${d.operation ?? "?"} ${d.id ?? ""} ${d.status ?? ""}`,
  },
  {
    type: "plan/change",
    surface: "model",
    description: "会话计划模式的状态迁移",
    describe: (d) => `plan/change ${d.operation ?? "?"} ${d.id ?? ""} ${d.status ?? ""}`,
  },
];

export function installCoreLedgerCatalog(): void {
  if (coreInstalled) return;
  coreInstalled = true;
  for (const spec of CORE_SPECS) {
    registerLedgerEvent(spec);
    coreTypes.add(spec.type);
  }
}

function nextLedgerSeq(filePath: string): number {
  if (!existsSync(filePath)) return 1;
  const raw = readFileSync(filePath, "utf-8");
  const lines = raw.trimEnd().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line?.trim()) continue;
    try {
      const rec = JSON.parse(line) as { seq?: unknown };
      if (typeof rec.seq === "number" && Number.isFinite(rec.seq)) {
        return rec.seq + 1;
      }
    } catch {
      continue;
    }
  }
  return 1;
}

export function readLedgerRecords(sessionDir: string, sessionId: string): SessionLedgerEvent[] {
  installCoreLedgerCatalog();
  const filePath = ledgerPath(sessionDir, sessionId);
  if (!existsSync(filePath)) return [];
  const out: SessionLedgerEvent[] = [];
  for (const line of readFileSync(filePath, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line) as SessionLedgerEvent;
      if (typeof rec.seq !== "number" || typeof rec.type !== "string") continue;
      out.push(rec);
    } catch {
      continue;
    }
  }
  return out;
}

export function appendLedgerEvent(
  sessionDir: string,
  sessionId: string,
  eventType: string,
  data: Record<string, unknown>,
  opts?: SessionLedgerAppendOpts,
): { seq: number } | { error: string } {
  installCoreLedgerCatalog();
  const spec = catalog.get(eventType);
  if (!spec) {
    return { error: `未登记的账本事件: ${eventType}（先 registerLedgerEvent）` };
  }
  const payload = sanitizeData(data);
  const seq = nextLedgerSeq(ledgerPath(sessionDir, sessionId));
  const rec: SessionLedgerEvent = {
    seq,
    type: eventType,
    ts: new Date().toISOString(),
    sessionId,
    surface: opts?.surface ?? spec.surface,
    data: payload,
    summary: describeEvent(spec, eventType, payload),
  };
  if (opts?.messageId) rec.messageId = opts.messageId;
  appendFileSync(ledgerPath(sessionDir, sessionId), `${JSON.stringify(rec)}\n`, "utf-8");
  return { seq };
}

function sanitizeData(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data ?? {})) {
    if (value == null) continue;
    if (typeof value === "string") {
      out[key] = previewText(value);
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    if (Array.isArray(value) || typeof value === "object") {
      try {
        const raw = JSON.stringify(value);
        out[key] = raw.length > 4000 ? previewText(raw, 4000) : (JSON.parse(raw) as unknown);
      } catch {
        out[key] = previewText(value, 400);
      }
      continue;
    }
  }
  return out;
}

export function queryLedgerEvents(
  sessionDir: string,
  sessionId: string,
  filter?: SessionLedgerQuery,
): { events: SessionLedgerEvent[]; total: number; catalog: SessionLedgerCatalogEntry[] } {
  const surface = filter?.surface ?? "all";
  const types = filter?.types?.length ? new Set(filter.types) : null;
  const q = filter?.q?.trim().toLowerCase() ?? "";
  const since = filter?.sinceSeq ?? 0;
  const until = filter?.untilSeq ?? Number.POSITIVE_INFINITY;
  const offset = Math.max(0, filter?.offset ?? 0);
  const limit = Math.min(Math.max(filter?.limit ?? 100, 1), 1000);

  const matched = readLedgerRecords(sessionDir, sessionId).filter((ev) => {
    if (types && !types.has(ev.type)) return false;
    if (surface !== "all" && ev.surface !== surface) return false;
    if (ev.seq < since || ev.seq > until) return false;
    if (q) {
      const hay = `${ev.type} ${ev.summary ?? ""} ${JSON.stringify(ev.data)}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return {
    events: matched.slice(offset, offset + limit),
    total: matched.length,
    catalog: listLedgerCatalog(),
  };
}

export function bindSessionLedgerPort(sessionDir: string, sessionId: string): SessionLedgerPort {
  installCoreLedgerCatalog();
  return {
    append(eventType, data, opts) {
      return appendLedgerEvent(sessionDir, sessionId, eventType, data, opts);
    },
    query(filter) {
      return queryLedgerEvents(sessionDir, sessionId, filter);
    },
    catalog() {
      return listLedgerCatalog();
    },
  };
}

/** 给持有 SessionStore 的调用方：不必再拆 sessionDir */
export function emitSessionLedger(
  store: { sessionDir: string },
  sessionId: string,
  eventType: string,
  data: Record<string, unknown>,
  opts?: SessionLedgerAppendOpts,
): { seq: number } | { error: string } {
  return appendLedgerEvent(store.sessionDir, sessionId, eventType, data, opts);
}

function compactMessageData(item: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {
    role: item.role,
    kind: item.kind,
    source: item.source,
    content: previewText(item.content, 2000),
  };
  if (typeof item.toolCallId === "string") data.toolCallId = item.toolCallId;
  if (typeof item.tool_name === "string") data.toolName = item.tool_name;
  if (typeof item.customType === "string") data.customType = item.customType;
  if (item.author && typeof item.author === "object") data.author = item.author;
  if (typeof item.round === "number") data.round = item.round;
  if (item.goalSource && typeof item.goalSource === "object") data.goalSource = item.goalSource;
  return data;
}

function asToolCall(raw: unknown): { id?: string; name?: string; arguments?: unknown } | null {
  if (!raw || typeof raw !== "object") return null;
  const tc = raw as Record<string, unknown>;
  const name = typeof tc.name === "string" ? tc.name : undefined;
  if (!name) return null;
  return {
    id: typeof tc.id === "string" ? tc.id : undefined,
    name,
    arguments: tc.arguments ?? tc.parameters,
  };
}

/**
 * 把一条会话消息镜像进账本。失败必须吞掉，不能打断 appendMessage。
 */
export function mirrorMessageToLedger(
  sessionDir: string,
  sessionId: string,
  item: Record<string, unknown>,
): void {
  try {
    installCoreLedgerCatalog();
    const messageId = typeof item.id === "string" && item.id ? item.id : undefined;
    if (typeof item.customType === "string" && item.customType) {
      appendLedgerEvent(sessionDir, sessionId, "session/custom", compactMessageData(item), { messageId });
      return;
    }
    const kind = resolveSessionEventKind(item);
    const type = KIND_TO_LEDGER_TYPE[kind];
    appendLedgerEvent(sessionDir, sessionId, type, compactMessageData(item), { messageId });

    if (kind === "assistant_turn" && Array.isArray(item.toolCalls)) {
      for (const raw of item.toolCalls) {
        const tc = asToolCall(raw);
        if (!tc) continue;
        appendLedgerEvent(
          sessionDir,
          sessionId,
          "tool/call",
          {
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
          },
          { messageId },
        );
      }
    }
  } catch {
    /* 账本失败不影响会话主路径 */
  }
}

export function mirrorTraceToLedger(
  sessionDir: string,
  sessionId: string,
  item: Record<string, unknown>,
): void {
  try {
    appendLedgerEvent(sessionDir, sessionId, "session/trace", { data: item });
  } catch {
    /* ignore */
  }
}

installCoreLedgerCatalog();
