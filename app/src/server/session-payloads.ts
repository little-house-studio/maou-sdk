/**
 * 会话落盘里的「这一轮发出去的 POST」与「这一轮收回来的内容」——调试面板的数据源。
 *
 * 只读 events.jsonl，不碰运行时。raw_request 的敏感 header 在 core/llm 侧
 * (`client.ts` isSensitiveHeader 过滤) 已经剔除，这里不再二次脱敏，只做整形。
 *
 * 索引（index）与明细（detail）分两次取：索引轻、每轮结束拉一次用于对齐 + 缓存率；
 * 明细重（整份 messages 数组），点开某一轮才拉。
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { normalizeCacheUsage } from "@little-house-studio/llm";
import { findSessionJsonl } from "./session-intents.js";

export type PayloadUsage = {
  /** 完整 prompt 量（含命中与写入）= 命中率分母 */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** usage 里是否出现过 cache 字段；false 时前端显示 “—” 而不是假 0% */
  reported: boolean;
};

/** 一条落盘消息的轻量索引项（user 与 assistant 各自成列）。 */
export type PayloadTurn = {
  kind: "user" | "assistant";
  /** 同类消息里的 0 基下标（全会话，不受分页影响） */
  index: number;
  /** 落盘 entry id；老会话可能为空字符串 */
  id: string;
  seq?: number;
  ts?: string;
  /** 运行时轮次：一次用户提问内 1..N */
  round?: number;
  model?: string;
  usage: PayloadUsage;
  toolCalls: number;
  hasRequest: boolean;
  hasResponse: boolean;
};

export type PayloadIndex = {
  ok: boolean;
  file: string | null;
  users: PayloadTurn[];
  turns: PayloadTurn[];
};

export type PayloadRequestView = {
  url?: string;
  method: "POST";
  headers?: Record<string, unknown>;
  body: unknown;
  bytes: number;
};

export type PayloadResponseView = {
  content: string;
  reasoning?: string;
  finishReason?: string;
  validationError?: string;
  toolCalls: Array<Record<string, unknown>>;
  usage?: Record<string, unknown>;
  bytes: number;
};

export type PayloadDetail = PayloadTurn & {
  request: PayloadRequestView | null;
  response: PayloadResponseView | null;
};

export type PayloadSelector = { id?: string; index?: number };

const MESSAGE_TYPES = new Set([
  "message",
  "user/message",
  "user/queued",
  "assistant/message",
]);

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function readUsage(raw: unknown): PayloadUsage {
  const rec = asRecord(raw);
  if (!rec) {
    return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reported: false };
  }
  const n = normalizeCacheUsage(rec);
  return {
    input: n.promptTotal,
    output: n.output,
    cacheRead: n.cacheRead,
    cacheWrite: n.cacheWrite,
    reported: n.reported,
  };
}

/** 账本形 `{seq,type,data}` 与老的扁平形 `{type:"message",role,...}` 都要认。 */
function unwrapMessage(
  ev: Record<string, unknown>,
): { data: Record<string, unknown>; type: string; seq?: number } | null {
  const type = String(ev.type ?? "");
  const data = asRecord(ev.data) ?? ev;
  const role = String(data.role ?? "");
  if (!MESSAGE_TYPES.has(type) && role !== "user" && role !== "assistant") {
    return null;
  }
  if (role !== "user" && role !== "assistant") return null;
  const seq = typeof ev.seq === "number" ? ev.seq : undefined;
  return { data, type, ...(seq != null ? { seq } : {}) };
}

/** 助手轮的 kind 白名单：只认真正的模型回合，不认注入的系统旁白。 */
function isModelTurn(data: Record<string, unknown>): boolean {
  const kind = String(data.kind ?? "");
  return kind === "" || kind === "assistant_turn";
}

function isHumanTurn(data: Record<string, unknown>): boolean {
  const kind = String(data.kind ?? "");
  return kind === "" || kind === "human_user" || kind === "queued_user";
}

function toolCallList(data: Record<string, unknown>): Array<Record<string, unknown>> {
  const raw = data.toolCalls ?? data.tool_calls ?? data.native_tool_calls;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is Record<string, unknown> => asRecord(x) != null);
}

function turnFrom(
  data: Record<string, unknown>,
  kind: "user" | "assistant",
  index: number,
  seq?: number,
): PayloadTurn {
  const req = asRecord(data.raw_request);
  const rawResponse = data.raw_response;
  return {
    kind,
    index,
    id: typeof data.id === "string" ? data.id : "",
    ...(seq != null ? { seq } : {}),
    ...(typeof data.createdAt === "string"
      ? { ts: data.createdAt }
      : typeof data.created_at === "string"
        ? { ts: data.created_at }
        : {}),
    ...(num(data.round) ? { round: num(data.round) } : {}),
    ...(req && typeof req.model === "string" ? { model: req.model } : {}),
    usage: readUsage(data.usage),
    toolCalls: toolCallList(data).length,
    hasRequest: req != null,
    hasResponse:
      (typeof rawResponse === "string" && rawResponse.length > 0) ||
      typeof data.content === "string",
  };
}

/** 逐行走一遍账本，把 user / assistant 消息按落盘顺序交给 visit。 */
function walkMessages(
  jsonl: string,
  visit: (
    data: Record<string, unknown>,
    kind: "user" | "assistant",
    index: number,
    seq?: number,
  ) => void,
): void {
  let userIdx = 0;
  let asstIdx = 0;
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const hit = unwrapMessage(ev);
    if (!hit) continue;
    const role = String(hit.data.role ?? "");
    if (role === "user") {
      if (!isHumanTurn(hit.data)) continue;
      visit(hit.data, "user", userIdx++, hit.seq);
    } else {
      if (!isModelTurn(hit.data)) continue;
      visit(hit.data, "assistant", asstIdx++, hit.seq);
    }
  }
}

export function parseSessionPayloadIndex(jsonl: string): {
  users: PayloadTurn[];
  turns: PayloadTurn[];
} {
  const users: PayloadTurn[] = [];
  const turns: PayloadTurn[] = [];
  walkMessages(jsonl, (data, kind, index, seq) => {
    const turn = turnFrom(data, kind, index, seq);
    (kind === "user" ? users : turns).push(turn);
  });
  return { users, turns };
}

function matches(turn: PayloadTurn, sel: PayloadSelector): boolean {
  if (sel.id) return turn.id === sel.id;
  if (sel.index != null) return turn.index === sel.index;
  return false;
}

function requestView(data: Record<string, unknown>): PayloadRequestView | null {
  const req = asRecord(data.raw_request);
  if (!req) return null;
  const { _url, _headers, ...body } = req;
  const bytes = Buffer.byteLength(JSON.stringify(body ?? {}), "utf8");
  return {
    ...(typeof _url === "string" ? { url: _url } : {}),
    method: "POST",
    ...(asRecord(_headers) ? { headers: asRecord(_headers)! } : {}),
    body,
    bytes,
  };
}

function responseView(data: Record<string, unknown>): PayloadResponseView | null {
  const rawResponse =
    typeof data.raw_response === "string"
      ? data.raw_response
      : typeof data.content === "string"
        ? data.content
        : null;
  const calls = toolCallList(data);
  if (rawResponse == null && calls.length === 0) return null;
  const reasoning =
    typeof data.reasoningContent === "string" && data.reasoningContent.trim()
      ? data.reasoningContent
      : undefined;
  const finishReason =
    typeof data.finish_reason === "string" && data.finish_reason
      ? data.finish_reason
      : undefined;
  const validationError =
    typeof data.validation_error === "string" && data.validation_error
      ? data.validation_error
      : undefined;
  const content = rawResponse ?? "";
  return {
    content,
    ...(reasoning ? { reasoning } : {}),
    ...(finishReason ? { finishReason } : {}),
    ...(validationError ? { validationError } : {}),
    toolCalls: calls,
    ...(asRecord(data.usage) ? { usage: asRecord(data.usage)! } : {}),
    bytes: Buffer.byteLength(
      content + (calls.length ? JSON.stringify(calls) : ""),
      "utf8",
    ),
  };
}

export function parseSessionPayloadDetail(
  jsonl: string,
  kind: "user" | "assistant",
  sel: PayloadSelector,
): PayloadDetail | null {
  let found: PayloadDetail | null = null;
  walkMessages(jsonl, (data, k, index, seq) => {
    if (found || k !== kind) return;
    const turn = turnFrom(data, k, index, seq);
    if (!matches(turn, sel)) return;
    found = {
      ...turn,
      request: requestView(data),
      response: responseView(data),
    };
  });
  return found;
}

type CacheEntry = { key: string; value: PayloadIndex };
let indexCache: CacheEntry | null = null;

function cacheKey(file: string): string {
  try {
    const s = statSync(file);
    return `${file}:${s.size}:${s.mtimeMs}`;
  } catch {
    return `${file}:0:0`;
  }
}

function emptyIndex(file: string | null): PayloadIndex {
  return { ok: false, file, users: [], turns: [] };
}

/** 每轮结束拉一次：按 (size, mtime) 缓存，长会话不重复解析。 */
export function loadSessionPayloadIndex(
  sessionId: string,
  projectRoot: string,
): PayloadIndex {
  const file = findSessionJsonl(sessionId, projectRoot);
  if (!file || !existsSync(file)) return emptyIndex(file);
  const key = cacheKey(file);
  if (indexCache?.key === key) return indexCache.value;
  try {
    const parsed = parseSessionPayloadIndex(readFileSync(file, "utf8"));
    const value: PayloadIndex = { ok: true, file, ...parsed };
    indexCache = { key, value };
    return value;
  } catch {
    return emptyIndex(file);
  }
}

export function loadSessionPayloadDetail(
  sessionId: string,
  projectRoot: string,
  kind: "user" | "assistant",
  sel: PayloadSelector,
): PayloadDetail | null {
  const file = findSessionJsonl(sessionId, projectRoot);
  if (!file || !existsSync(file)) return null;
  try {
    return parseSessionPayloadDetail(readFileSync(file, "utf8"), kind, sel);
  } catch {
    return null;
  }
}

/** 测试用：丢掉索引缓存 */
export function resetSessionPayloadCache(): void {
  indexCache = null;
}
